import { test, type Frame, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { findElement, type DomAddress } from '@mes-ui/config-enumerator/discovery';
import type { MesWorkflowCase } from './cases';
import { plannedExecution, executionView, type MesExecution, type MesState, type MesStepRecord } from './execution-model';

export type EvidenceTarget = { name: string; address: DomAddress };
export type ExecutionContext = { frame: Frame; framePath: DomAddress[] };
const errorInfo = (error: unknown) => ({ message: error instanceof Error ? error.message : String(error), ...(error instanceof Error ? { stack: error.stack } : {}) });

async function capture(page: Page, context: ExecutionContext, targets: EvidenceTarget[]): Promise<MesState> {
  const state: MesState = { capturedAt: new Date().toISOString(), pageUrl: page.url(), frameUrl: context.frame.url(),
    framePath: structuredClone(context.framePath), status: 'observed', targets: [] };
  try {
    if (page.isClosed() || context.frame.isDetached()) throw new Error('页面已关闭或 Frame 已脱离');
    // 同时检查跨源 Frame 的入口可见性；空目标也要确认文档可以读取。
    const body = await findElement(context.frame, { selector: 'body' });
    if (!body) throw new Error('文档 body 或外层 Frame 尚不可观察');
    await body.dispose();
    for (const target of targets) {
      let handle: Awaited<ReturnType<typeof findElement>> = null;
      try {
        handle = await findElement(context.frame, target.address);
        if (!handle) { state.targets.push({ ...target, state: 'not-visible-or-absent' }); continue; }
        const value = await handle.evaluate(el => {
          let truncated = false;
          const text = (s: string | null) => { const value = (s ?? '').replace(/\s+/g, ' ').trim(); truncated ||= value.length > 500; return value.slice(0, 500); };
          const input = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ? el : null;
          const sensitive = input?.getAttribute('type') === 'password' || /^(current-password|new-password|one-time-code)$/.test(input?.getAttribute('autocomplete') ?? '');
          const choice = input instanceof HTMLInputElement && ['checkbox', 'radio'].includes(input.type);
          // iView 的内部 label 不一定透传为原生 value；不能把浏览器默认 on 当业务值。
          const inputValue = input && !sensitive && (!choice || input.hasAttribute('value')) ? input.value : null;
          const label = el.getAttribute('aria-label') || el.getAttribute('title') || (input?.labels?.length ? [...input.labels].map(l => l.textContent).join(' ') : null);
          return { tag: el.tagName.toLowerCase(), testId: el.getAttribute('data-testid'), role: el.getAttribute('role'),
            label: text(label), text: input ? null : text(el instanceof HTMLElement ? el.innerText : el.textContent),
            value: inputValue?.slice(0, 500) ?? null, valueKnown: inputValue !== null && inputValue.length <= 500,
            checked: input instanceof HTMLInputElement && ['checkbox', 'radio'].includes(input.type) ? input.checked : null,
            disabled: el.matches(':disabled,[aria-disabled="true"]'), readOnly: input?.hasAttribute('readonly') ?? null,
            workflowNode: el.getAttribute('data-workflow-node-id'), redacted: sensitive, truncated: truncated || inputValue !== null && inputValue.length > 500 };
        });
        state.targets.push({ ...target, state: 'observed', value });
      } catch (error) { state.targets.push({ ...target, state: 'unavailable', error: errorInfo(error).message }); }
      finally { await handle?.dispose().catch(() => {}); }
    }
  } catch (error) { state.status = 'unavailable'; state.error = errorInfo(error).message; }
  return state;
}

/** 一个执行实例一份文件；每步开始和结束落盘，不把未执行计划当实际路径。 */
export class MesExecutionRecorder {
  readonly record: MesExecution;
  readonly path: string;
  constructor(readonly page: Page, readonly scenario: MesWorkflowCase, readonly info: TestInfo, readonly context: () => ExecutionContext) {
    this.record = plannedExecution(scenario, info.testId);
    this.record.executionId = randomUUID(); this.record.startedAt = new Date().toISOString(); this.record.status = 'running';
    this.path = info.outputPath(`mes-execution-${this.record.executionId}.json`);
    mkdirSync(dirname(this.path), { recursive: true });
    info.annotations.push({ type: 'mes-execution-file', description: this.path });
    this.save();
  }
  save() {
    const temp = this.path + '.tmp';
    writeFileSync(temp, JSON.stringify(executionView(this.record), null, 2)); renameSync(temp, this.path);
  }
  async run<T>(id: string, targets: EvidenceTarget[], operation: (step: MesStepRecord) => Promise<T>): Promise<T> {
    const step = this.record.steps.find(s => s.id === id);
    const next = this.record.steps.find(s => s.status !== 'passed');
    if (!step || step !== next || step.status !== 'not-run') throw new Error(`MES 步骤顺序错误或重复执行：${id}`);
    return test.step(`[${this.scenario.id}/${step.id}] ${step.title}`, async () => {
      step.status = 'running'; step.startedAt = new Date().toISOString(); const start = performance.now();
      this.save();
      step.before = await capture(this.page, this.context(), targets); this.save();
      try {
        const result = await operation(step);
        step.status = 'passed'; return result;
      } catch (error) { step.status = 'failed'; step.error = errorInfo(error); throw error; }
      finally {
        step.after = await capture(this.page, this.context(), targets);
        step.finishedAt = new Date().toISOString(); step.durationMs = Math.round(performance.now() - start);
        try { this.save(); } catch (error) {
          this.record.issues.push(`步骤记录写入失败：${errorInfo(error).message}`);
          if (step.status === 'passed') throw error;
        }
      }
    });
  }
  /** 业务动作发出/完成分别落盘；点击完成但等待失败时不可重复提交。 */
  markAction(step: MesStepRecord, completed = false) {
    step.actionAttempted = true; step.actionCompleted ||= completed; this.save();
  }
  async finish(error?: unknown) {
    this.record.finishedAt = new Date().toISOString();
    this.record.status = error !== undefined || this.record.steps.some(s => s.status !== 'passed') ? 'failed' : 'passed';
    if (error !== undefined && !this.record.steps.some(s => s.error)) this.record.issues.push(errorInfo(error).message);
    this.save();
    await this.info.attach('MES 每步执行记录', { path: this.path, contentType: 'application/json' });
  }
}
