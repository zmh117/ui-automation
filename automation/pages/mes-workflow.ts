import type { Frame, Page, TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';
import {
  enterFrames, findElement, waitElement, readWorkflow, resolveWorkflowNode,
  type DomAddress, type WorkflowNodeQuery,
} from '@mes-ui/config-enumerator/discovery';
import { parseMesCases, type MesCheck, type MesWorkflowCase } from '../mes/cases';
import { MesExecutionRecorder, type EvidenceTarget } from '../mes/execution';
import type { MesStepRecord } from '../mes/execution-model';

const timeoutMs = 5000;
async function attach(info: TestInfo, name: string, value: unknown) {
  try { await info.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' }); }
  catch (error) { info.annotations.push({ type: 'mes-evidence-error', description: `${name}：${String(error)}` }); }
}

/** 每次只读断言都重新找当前唯一可见元素；不缓存句柄或用观察值生成预期。 */
async function readCheck(frame: Frame, panel: DomAddress, check: MesCheck) {
  const root = await findElement(frame, panel);
  if (!root) return { state: '面板尚不可见' };
  try {
    const element = await findElement(frame, check.target);
    if (!element) return { state: '断言控件尚不可见' };
    try {
      return await element.evaluate((el, { root, kind }) => {
        let inside = false;
        for (let n: Element | null = el; n; n = n.assignedSlot ?? n.parentElement ?? ((n.getRootNode() as ShadowRoot).host || null)) {
          if (n === root) { inside = true; break; }
        }
        if (!inside) throw new Error('断言控件不属于预期面板，不能验证其他组件的值');
        if (kind === 'value') {
          if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) throw new Error('value 断言必须指向真实 input/textarea/select');
          if (el.getAttribute('type') === 'password' || /^(current-password|new-password|one-time-code)$/.test(el.getAttribute('autocomplete') ?? '')) throw new Error('敏感输入不能记录为断言实际值');
          return { state: 'observed', value: el.value };
        }
        if (kind === 'checked') {
          if (!(el instanceof HTMLInputElement) || !['checkbox', 'radio'].includes(el.type)) throw new Error('checked 断言必须指向真实 checkbox/radio');
          return { state: 'observed', value: el.checked };
        }
        return { state: 'observed', value: (el instanceof HTMLElement ? el.innerText : el.textContent ?? '').replace(/\s+/g, ' ').trim() };
      }, { root, kind: check.kind });
    } finally { await element.dispose(); }
  } finally { await root.dispose(); }
}

/** 当前 JSON → 唯一业务匹配 → 正常点击一次 → 独立预期断言。 */
export async function openMesWorkflowNode(
  frame: Frame,
  workflow: DomAddress,
  query: WorkflowNodeQuery,
  expectedPanel: DomAddress,
  checks: MesCheck[],
  info: TestInfo,
  recorder?: MesExecutionRecorder,
) {
  if (!checks.length) throw new Error('必须提供独立预期 checks，不能仅以点击成功作为通过');
  let phase = '定位';
  let result: Awaited<ReturnType<typeof resolveWorkflowNode>> | undefined;
  const run = <T>(id: string, targets: EvidenceTarget[], operation: (step?: MesStepRecord) => Promise<T>): Promise<T> =>
    recorder ? recorder.run(id, targets, operation) : operation();
  try {
    result = await run('$workflow.resolve', [{ name: '工作流画布', address: workflow }], async step => {
      const resolved = await resolveWorkflowNode(frame, workflow, query);
      if (step) step.actual = { query, matchedNode: resolved.node, workflow: resolved.reading };
      return resolved;
    });
    await attach(info, '工作流节点当前定位证据', { query, matchedNode: result.node, workflow: result.reading });
    phase = '点击';
    await run('$workflow.click', [{ name: '工作流画布', address: workflow }, { name: '配置面板', address: expectedPanel }], async step => {
      // 记录前状态可能跨过一次重绘；点击前重新验证整图，不能操作旧句柄。
      const current = await resolveWorkflowNode(frame, workflow, query);
      if (JSON.stringify(current.reading) !== JSON.stringify(result!.reading)) {
        await current.element.dispose(); throw new Error('工作流在记录状态期间已变化，未点击；请重新确认业务目标');
      }
      await result!.element.dispose(); result = current;
      if (step) { step.actual = { matchedNode: result!.node, clickCompleted: false }; recorder!.markAction(step); }
      await result!.element.click({ timeout: timeoutMs });
      if (step) { step.actual = { matchedNode: result!.node, clickCompleted: true }; recorder!.markAction(step, true); }
    });
    phase = '断言';
    await run('$panel.ready', [{ name: '配置面板', address: expectedPanel }], async step => {
      const panel = await waitElement(frame, expectedPanel, timeoutMs);
      await panel.dispose();
      if (step) step.actual = { visible: true };
    });
    for (const check of checks) {
      await run(check.id, [{ name: '配置面板', address: expectedPanel }, { name: check.title, address: check.target }], async step => {
        let actual: unknown;
        try {
          const expected = check.kind === 'text' ? check.expected.replace(/\s+/g, ' ').trim() : check.expected;
          await expect.poll(async () => {
            actual = await readCheck(frame, expectedPanel, check);
            if (step) { step.actual = actual; step.observations++; recorder!.save(); }
            return actual;
          }, { timeout: timeoutMs, message: `检查 ${check.target.selector} 的 ${check.kind}` }).toEqual({ state: 'observed', value: expected });
        } finally {
          await attach(info, '面板独立预期与实际值', { check, actual: actual ?? null });
        }
      });
    }
    return { reading: result.reading, node: result.node };
  } catch (error) {
    let afterFailure: unknown;
    try { afterFailure = await readWorkflow(frame, workflow); }
    catch (captureError) { afterFailure = { error: String(captureError) }; }
    await attach(info, '工作流失败现场', {
      phase, error: String(error), query, url: frame.url(), afterFailure,
      note: '此 JSON 在失败后读取，仅作现场证据，不能代替点击前的定位快照。',
    });
    throw error;
  } finally { await result?.element.dispose().catch(() => {}); }
}

export async function executeMesWorkflowCase(page: Page, scenario: MesWorkflowCase, info: TestInfo) {
  parseMesCases({ schemaVersion: 2, cases: [scenario] });
  let frame = page.mainFrame(); const framePath: DomAddress[] = [];
  const recorder = new MesExecutionRecorder(page, scenario, info, () => ({ frame, framePath }));
  let failure: unknown;
  try {
    await attach(info, 'MES 用例及独立预期', scenario);
    await recorder.run('$navigate', [], async step => {
      recorder.markAction(step);
      await page.goto(scenario.url, { waitUntil: 'domcontentloaded' });
      step.actual = { url: page.url(), loadState: 'domcontentloaded' }; recorder.markAction(step, true);
    });
    for (const [i, address] of (scenario.framePath ?? []).entries()) {
      await recorder.run(`$frame.${i + 1}`, [], async step => {
        frame = await enterFrames(frame, [address], timeoutMs); framePath.push(address);
        step.actual = { frameAvailable: true, frameUrl: frame.url(), framePath: structuredClone(framePath) };
      });
    }
    for (const entry of scenario.open ?? []) {
      await recorder.run(entry.id, [{ name: entry.title, address: entry.target }, { name: '预期区域', address: entry.expected }], async step => {
        const target = await waitElement(frame, entry.target, timeoutMs);
        try {
          step.actual = { targetResolved: true, clickCompleted: false, expectedVisible: null };
          recorder.markAction(step); await target.click({ timeout: timeoutMs });
          step.actual = { targetResolved: true, clickCompleted: true, expectedVisible: null }; recorder.markAction(step, true);
        } finally { await target.dispose(); }
        const expected = await waitElement(frame, entry.expected, timeoutMs);
        await expected.dispose(); step.actual = { targetResolved: true, clickCompleted: true, expectedVisible: true };
      });
    }
    await recorder.run('$workflow.ready', [{ name: '工作流画布', address: scenario.workflow }], async step => {
      const ready = await waitElement(frame, scenario.workflow, timeoutMs);
      await ready.dispose(); step.actual = { visible: true };
    });
    return await openMesWorkflowNode(frame, scenario.workflow, scenario.node, scenario.expectedPanel, scenario.checks, info, recorder);
  } catch (error) { failure = error ?? new Error('用例执行失败'); throw error; }
  finally {
    try { await recorder.finish(failure); }
    catch (error) {
      info.annotations.push({ type: 'mes-evidence-error', description: String(error) });
      if (failure === undefined) throw error;
    }
  }
}
