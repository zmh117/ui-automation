import type { Frame, Page, TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';
import {
  enterFrames, findElement, waitElement, readWorkflow, resolveWorkflowNode,
  type DomAddress, type WorkflowNodeQuery,
} from '@mes-ui/config-enumerator/discovery';
import type { MesCheck, MesWorkflowCase } from '../mes/cases';

const timeoutMs = 5000;
async function attach(info: TestInfo, name: string, value: unknown) {
  await info.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' });
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
) {
  if (!checks.length) throw new Error('必须提供独立预期 checks，不能仅以点击成功作为通过');
  let phase = '定位';
  try {
    const result = await resolveWorkflowNode(frame, workflow, query);
    try {
      phase = '点击';
      await result.element.click({ timeout: timeoutMs });
    } finally {
      await result.element.dispose();
      await attach(info, '工作流节点当前定位证据', { query, matchedNode: result.node, workflow: result.reading });
    }
    phase = '断言';
    const panel = await waitElement(frame, expectedPanel, timeoutMs);
    await panel.dispose();
    for (const check of checks) {
      let actual: unknown;
      try {
        const expected = check.kind === 'text' ? check.expected.replace(/\s+/g, ' ').trim() : check.expected;
        await expect.poll(async () => {
          actual = await readCheck(frame, expectedPanel, check);
          return actual;
        }, { timeout: timeoutMs, message: `检查 ${check.target.selector} 的 ${check.kind}` }).toEqual({ state: 'observed', value: expected });
      } finally {
        await attach(info, '面板独立预期与实际值', { check, actual: actual ?? null });
      }
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
  }
}

export async function executeMesWorkflowCase(page: Page, scenario: MesWorkflowCase, info: TestInfo) {
  await attach(info, 'MES 用例及独立预期', scenario);
  await page.goto(scenario.url, { waitUntil: 'domcontentloaded' });
  const frame = await enterFrames(page.mainFrame(), scenario.framePath ?? [], timeoutMs);
  for (const step of scenario.open ?? []) {
    const target = await waitElement(frame, step.target, timeoutMs);
    try { await target.click({ timeout: timeoutMs }); }
    finally { await target.dispose(); }
    const expected = await waitElement(frame, step.expected, timeoutMs);
    await expected.dispose();
  }
  const ready = await waitElement(frame, scenario.workflow, timeoutMs);
  await ready.dispose();
  return openMesWorkflowNode(frame, scenario.workflow, scenario.node, scenario.expectedPanel, scenario.checks, info);
}
