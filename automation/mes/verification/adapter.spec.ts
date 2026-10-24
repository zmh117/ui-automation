import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { parseMesCases, type MesWorkflowCase } from '../cases';
import { executeMesWorkflowCase, openMesWorkflowNode } from '../../pages/mes-workflow';
import { MesExecutionRecorder } from '../execution';
import { plannedExecution, finalizeRecordedExecution, executionView } from '../execution-model';
import MesReporter from '../reporter';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '../..');
const scenario = JSON.parse(readFileSync(resolve(import.meta.dirname, '../cases.example.json'), 'utf8')).cases[0] as MesWorkflowCase;
const sample = (url = 'http://mes-fixture.test/', node = scenario.node): MesWorkflowCase => ({ ...structuredClone(scenario), url, node });
const plan = (c: MesWorkflowCase) => ({ schemaVersion: 2, cases: [c] });

function html(offset = 0, extra = '', missingId = false) {
  const node = (id: number, name: string, type: string, next: number[]) =>
    `<button data-workflow-node-id="${missingId && id === 1 ? '' : id + offset}" data-workflow-node-name="${name}" data-workflow-node-type="${type}" data-workflow-next='${JSON.stringify(next.map(n => String(n + offset)))}' data-testid="ebr-pi-workflow-node-${id + offset}">${name}</button>`;
  return `<meta charset="utf-8"><button data-testid="show-workflow">打开工作流</button>
    <main data-testid="ebr-pi-workflow-canvas" data-workflow="mes" hidden>
    ${node(0, '投料', '3', [1])}${node(1, '称量检查', '8', [3])}${node(2, '称量检查', '8', [3])}${node(3, '结束', '2', [])}</main>
    <section data-testid="ebr-pi-workflow-config" hidden>
      <input data-testid="ebr-pi-workflow-config-form-desc-form-input-desc">
      <span data-testid="result-label"> 已打开  配置 </span><input data-testid="enabled" type="checkbox" checked>
    </section>${extra}<script>
    window.clicked = []; const canvas = document.querySelector('main'), panel = document.querySelector('section');
    document.querySelector('[data-testid="show-workflow"]').onclick = () => canvas.hidden = false;
    for (const n of canvas.children) n.onclick = () => {
      window.clicked.push(n.dataset.workflowNodeId); panel.hidden = false;
      panel.querySelector('input').value = n.dataset.workflowNodeName;
      fetch('/clicked?id=' + n.dataset.workflowNodeId).catch(() => {});
    };
    </script>`;
}
function withOpen(c: MesWorkflowCase): MesWorkflowCase {
  return { ...c, open: [{ id: 'open-workflow', title: '打开工作流', target: { selector: '[data-testid="show-workflow"]' }, expected: c.workflow }] };
}
function evidence(info: { attachments: { name: string; body?: Buffer; path?: string }[] }, name: string) {
  const a = [...info.attachments].reverse().find(a => a.name === name)!;
  return JSON.parse(a.body?.toString('utf8') ?? readFileSync(a.path!, 'utf8'));
}

test('用例校验拒绝动态 ID、空预期、重复用例及未知字段', async ({}, info) => {
  expect(parseMesCases(plan(sample())).cases).toHaveLength(1);
  const wrong: unknown[] = [
    plan({ ...sample(), node: { id: '852391081129734' } } as unknown as MesWorkflowCase),
    plan({ ...sample(), node: { name: '称量检查', predecessor: { id: '1' } } } as unknown as MesWorkflowCase),
    plan({ ...sample(), checks: [] }),
    plan({ ...sample(), checks: [{ target: scenario.expectedPanel, kind: 'value', expected: true }] } as unknown as MesWorkflowCase),
    { schemaVersion: 2, cases: [sample(), sample()] },
    { schemaVersion: 2, cases: [{ ...sample(), save: true }] },
    plan({ ...sample(), url: 'file:///etc/passwd' }),
    { schemaVersion: 1, cases: [sample()] },
    plan({ ...sample(), requirements: [] }),
    plan({ ...sample(), requirements: [scenario.requirements[0], scenario.requirements[0]] }),
    plan({ ...sample(), checks: [{ ...scenario.checks[0], requirementIds: ['MISSING'] }] }),
    plan({ ...sample(), checks: [{ ...scenario.checks[0], requirementIds: [] }] }),
    plan({ ...sample(), checks: [{ ...scenario.checks[0], id: '$navigate' }] }),
    plan({ ...sample(), checks: [scenario.checks[0], scenario.checks[0]] }),
    { schemaVersion: 2, cases: [sample(), { ...sample(), id: 'second', requirements: [{ ...scenario.requirements[0], text: '冲突需求' }] }] },
  ];
  for (const value of wrong) expect(() => parseMesCases(value)).toThrow();
  await expect(openMesWorkflowNode(null as never, scenario.workflow, scenario.node, scenario.expectedPanel, [], info)).rejects.toThrow(/独立预期/);
  await expect(exec(process.execPath, ['scripts/run.mjs', '--suite', 'mes', '--cases', 'mes/cases.example.json', '--workers', '1', '--workers', '2'], { cwd: root })).rejects.toThrow(/固定单 worker/);
});

test('真实执行适配器两次采集不同 ID，按前后关系消歧且验证三类独立预期', async ({ page }, info) => {
  let offset = 0;
  await page.route('http://mes-fixture.test/**', r => r.fulfill({ contentType: 'text/html', body: html(offset) }));
  const c = withOpen(sample());
  c.checks.push(
    { id: 'check-label', title: '核对配置提示', requirementIds: [c.requirements[0].id], target: { selector: '[data-testid="result-label"]' }, kind: 'text', expected: '已打开 配置' },
    { id: 'check-enabled', title: '核对选中状态', requirementIds: [c.requirements[0].id], target: { selector: '[data-testid="enabled"]' }, kind: 'checked', expected: true },
  );
  const first = await executeMesWorkflowCase(page, c, info);
  const firstExecution = evidence(info, 'MES 每步执行记录');
  offset = 1000;
  const second = await executeMesWorkflowCase(page, c, info);
  expect(first.node.id).toBe('1'); expect(second.node.id).toBe('1001');
  expect(await page.evaluate(() => (window as any).clicked)).toEqual(['1001']);
  expect(evidence(info, '工作流节点当前定位证据').matchedNode.id).toBe('1001');
  const execution = evidence(info, 'MES 每步执行记录');
  expect(execution.executionId).not.toBe(firstExecution.executionId);
  expect(execution.caseId).toBe(c.id); expect(execution.requirements).toEqual(c.requirements);
  expect(execution.status).toBe('passed'); expect(execution.evidenceComplete).toBe(true);
  expect(execution.operationPath.map((s: any) => s.stepId)).toEqual(execution.steps.map((s: any) => s.id));
  expect(execution.steps.every((s: any, i: number) => s.status === 'passed' && s.sequence === i + 1 && s.startedAt && s.finishedAt && s.before && s.after)).toBe(true);
  const entry = execution.steps.find((s: any) => s.id === 'open-workflow');
  expect(entry.before.targets[1].state).toBe('not-visible-or-absent'); expect(entry.after.targets[1].state).toBe('observed');
  const check = execution.steps.find((s: any) => s.id === 'check-description');
  expect(check.requirementIds).toEqual(c.checks[0].requirementIds); expect(check.expected.value).toBe('称量检查');
  expect(check.actual).toEqual({ state: 'observed', value: '称量检查' }); expect(check.observations).toBeGreaterThan(0);
});

test('同名歧义和缺失节点 ID 不执行点击，并附失败后的完整现场', async ({ page }, info) => {
  let missing = false;
  await page.route('http://mes-fixture.test/**', r => r.fulfill({ contentType: 'text/html', body: html(0, '', missing) }));
  await expect(executeMesWorkflowCase(page, withOpen(sample(undefined, { name: '称量检查' })), info)).rejects.toThrow(/歧义/);
  expect(await page.evaluate(() => (window as any).clicked)).toEqual([]);
  expect(evidence(info, '工作流失败现场').afterFailure.nodes).toHaveLength(4);
  missing = true;
  await expect(executeMesWorkflowCase(page, withOpen(sample()), info)).rejects.toThrow(/不完整/);
  expect(await page.evaluate(() => (window as any).clicked)).toEqual([]);
  expect(evidence(info, '工作流失败现场').phase).toBe('定位');
});

test('错误预期使断言失败，不重试点击，也不将错误结果当作预期', async ({ page }, info) => {
  await page.route('http://mes-fixture.test/**', r => r.fulfill({ contentType: 'text/html', body: html() }));
  const c = withOpen(sample()); c.checks[0] = { ...c.checks[0]!, kind: 'value', expected: '另一节点' };
  c.checks.push({ ...c.checks[0], id: 'unreached-check', expected: '称量检查' });
  await expect(executeMesWorkflowCase(page, c, info)).rejects.toThrow(/另一节点/);
  expect(await page.evaluate(() => (window as any).clicked)).toEqual(['1']);
  expect(evidence(info, '工作流失败现场').phase).toBe('断言');
  expect(evidence(info, '面板独立预期与实际值').actual.value).toBe('称量检查');
  const execution = evidence(info, 'MES 每步执行记录');
  expect(execution.status).toBe('failed');
  expect(execution.steps.find((s: any) => s.id === '$workflow.click')).toMatchObject({ status: 'passed', actionAttempted: true, actionCompleted: true });
  expect(execution.steps.find((s: any) => s.id === 'check-description')).toMatchObject({ status: 'failed', actual: { value: '称量检查' }, expected: { value: '另一节点' } });
  expect(execution.steps.at(-1)).toMatchObject({ status: 'not-run', before: null, after: null, actual: null });
  expect(execution.operationPath.some((s: any) => s.stepId === 'unreached-check')).toBe(false);
});

test('相同短名按当前可见实例唯一定位，真实重复拒绝点击', async ({ page }, info) => {
  await page.route('http://mes-fixture.test/**', r => r.fulfill({ contentType: 'text/html', body: html(0, '<button hidden data-testid="show-workflow">隐藏旧实例</button>') }));
  await executeMesWorkflowCase(page, withOpen(sample()), info);
  await page.unrouteAll();
  await page.route('http://mes-fixture.test/**', r => r.fulfill({ contentType: 'text/html', body: html(0, '<button data-testid="show-workflow">另一实例</button>') }));
  await expect(executeMesWorkflowCase(page, withOpen(sample()), info)).rejects.toThrow(/不唯一/);
  expect(await page.evaluate(() => (window as any).clicked)).toEqual([]);
  const execution = evidence(info, 'MES 每步执行记录');
  expect(execution.steps.find((s: any) => s.id === 'open-workflow')).toMatchObject({ status: 'failed', actionAttempted: false, actionCompleted: false });
  expect(execution.steps.find((s: any) => s.id === '$workflow.resolve').status).toBe('not-run');
  expect(execution.evidenceComplete).toBe(false);
});

test('Frame 与 Shadow 中可定位；断言不能借用面板外的同值控件', async ({ page }, info) => {
  await page.route('http://mes-fixture.test/**', r => r.fulfill({ contentType: 'text/html', body: r.request().url().endsWith('/frame') ? html() : '<iframe data-testid="app-frame" src="/frame"></iframe>' }));
  await page.goto('http://mes-fixture.test/');
  const c = withOpen(sample()); c.framePath = [{ selector: '[data-testid="app-frame"]' }];
  // 首次导航后、每次 iframe 加载时，将 fixture 的界面移入开放 Shadow；仅用于构造测试页。
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      if (!document.querySelector('main')) return;
      const host = document.createElement('div'); host.id = 'app-shadow';
      const shadow = host.attachShadow({ mode: 'open' });
      for (const e of [...document.body.children]) if (e.tagName !== 'SCRIPT') shadow.append(e);
      document.body.append(host);
    });
  });
  const shadow = (a: { selector: string }) => ({ ...a, shadowPath: ['#app-shadow'] });
  c.workflow = shadow(c.workflow); c.expectedPanel = shadow(c.expectedPanel);
  c.open = c.open!.map(s => ({ ...s, target: shadow(s.target), expected: shadow(s.expected) }));
  c.checks = c.checks.map(s => ({ ...s, target: shadow(s.target) }));
  expect((await executeMesWorkflowCase(page, c, info)).node.id).toBe('1');
  const execution = evidence(info, 'MES 每步执行记录');
  expect(execution.steps.find((s: any) => s.id === '$frame.1').actual.framePath).toEqual(c.framePath);
  expect(execution.steps.at(-1).after.framePath).toEqual(c.framePath);
  expect(execution.steps.at(-1).after.targets[1].address.shadowPath).toEqual(['#app-shadow']);
  await page.unrouteAll();
  await page.route('http://mes-fixture.test/**', r => r.fulfill({ contentType: 'text/html', body: html(0, '<input data-testid="outside" value="称量检查">') }));
  const outside = withOpen(sample());
  outside.workflow = shadow(outside.workflow); outside.expectedPanel = shadow(outside.expectedPanel);
  outside.open = outside.open!.map(s => ({ ...s, target: shadow(s.target), expected: shadow(s.expected) }));
  outside.checks = [{ ...outside.checks[0], target: shadow({ selector: '[data-testid="outside"]' }), kind: 'value', expected: '称量检查' }];
  await expect(executeMesWorkflowCase(page, outside, info)).rejects.toThrow(/不属于预期面板/);
});

test('正式 runner 计划、通过、断言失败、无效用例均输出正确结果', async ({}, info) => {
  const clicks: string[] = [];
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/clicked')) { clicks.push(req.url); res.end('ok'); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html(200));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try {
    const port = (server.address() as { port: number }).port;
    const cases = info.outputPath('cases.json');
    const c = withOpen(sample(`http://127.0.0.1:${port}/`));
    const invoke = async (...args: string[]) => {
      const env = { ...process.env }; delete env.MES_RUN_DIR; delete env.MES_STORAGE_STATE; delete env.MES_CASES_FILE;
      let output = '', code = 0;
      try { output = (await exec(process.execPath, ['scripts/run.mjs', '--suite', 'mes', '--cases', cases, ...args], { cwd: root, env, timeout: 60000 })).stdout; }
      catch (error: any) { code = error.code; output = (error.stdout ?? '') + (error.stderr ?? ''); }
      const dir = output.match(/本次报告目录：(.+)/)?.[1]?.trim();
      expect(dir, output).toBeTruthy();
      await info.attach('正式入口输出', { body: output, contentType: 'text/plain' });
      return { code, dir: dir!, summary: JSON.parse(readFileSync(resolve(dir!, 'summary.json'), 'utf8')) };
    };
    writeFileSync(cases, JSON.stringify(plan(c)));
    const planned = await invoke('--list');
    expect(planned.code).toBe(0); expect(planned.summary).toMatchObject({ mode: 'plan', planned: 1, attempted: 0, allPassed: false });
    const plannedEvidence = JSON.parse(readFileSync(resolve(planned.dir, 'execution.json'), 'utf8'));
    expect(plannedEvidence.cases[0].execution.status).toBe('not-run');
    expect(plannedEvidence.cases[0].execution.operationPath).toEqual([]);
    expect(clicks).toEqual([]);
    const passed = await invoke();
    expect(passed.code).toBe(0); expect(passed.summary).toMatchObject({ planned: 1, passed: 1, allPassed: true, scope: 'specified-mes-cases' });
    const record = JSON.parse(readFileSync(resolve(passed.dir, 'results.jsonl'), 'utf8'));
    const nodeEvidence = record.attachments.find((a: { name: string }) => a.name === '工作流节点当前定位证据');
    expect(JSON.parse(nodeEvidence.body ?? readFileSync(nodeEvidence.path, 'utf8')).matchedNode.id).toBe('201');
    expect(record.caseId).toBe(c.id); expect(record.execution.status).toBe('passed');
    expect(record.execution.evidenceComplete).toBe(true); expect(record.steps.length).toBeGreaterThan(0);
    expect(record.execution.steps.at(-1).requirementIds).toEqual(c.checks[0].requirementIds);
    for (const name of ['trace', 'screenshot', 'MES 每步执行记录']) {
      const attachment = record.attachments.find((a: any) => a.name === name);
      expect(attachment, name).toBeTruthy(); expect(existsSync(resolve(passed.dir, attachment.path))).toBe(true);
    }
    expect(JSON.parse(readFileSync(resolve(passed.dir, 'execution.json'), 'utf8')).cases[0].execution.operationPath.length).toBe(record.execution.steps.length);
    c.checks[0] = { ...c.checks[0]!, kind: 'value', expected: '错误名称' };
    writeFileSync(cases, JSON.stringify(plan(c)));
    const failed = await invoke();
    expect(failed.code).not.toBe(0); expect(failed.summary).toMatchObject({ planned: 1, failed: 1, allPassed: false });
    const failure = JSON.parse(readFileSync(resolve(failed.dir, 'results.jsonl'), 'utf8'));
    expect(failure.attachments.some((a: { name: string }) => a.name === '工作流失败现场')).toBe(true);
    expect(failure.attachments.some((a: { name: string }) => a.name === 'trace')).toBe(true);
    expect(failure.attachments.some((a: { name: string }) => a.name === 'screenshot')).toBe(true);
    expect(failure.execution.steps.at(-1)).toMatchObject({ status: 'failed', actual: { value: '称量检查' }, expected: { value: '错误名称' } });
    await info.attach('成功执行报告目录', { body: passed.dir, contentType: 'text/plain' });
    await info.attach('失败执行报告目录', { body: failed.dir, contentType: 'text/plain' });
    expect(clicks).toHaveLength(2);
    const invalid = { ...c, node: { id: '201' } };
    writeFileSync(cases, JSON.stringify({ schemaVersion: 2, cases: [invalid] }));
    const rejected = await invoke();
    expect(rejected.code).not.toBe(0); expect(rejected.summary.planned).toBe(0);
    expect(rejected.summary.errors.join(' ')).toContain('动态 ID'); expect(clicks).toHaveLength(2);
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});

test('导航失败也保留失败步骤、真实路径与所有未执行计划', async ({ page }, info) => {
  await page.route('http://mes-fixture.test/**', route => route.abort('failed'));
  const c = withOpen(sample());
  await expect(executeMesWorkflowCase(page, c, info)).rejects.toThrow();
  const execution = evidence(info, 'MES 每步执行记录');
  expect(execution.status).toBe('failed');
  expect(execution.steps[0]).toMatchObject({ id: '$navigate', status: 'failed', actionAttempted: true, actionCompleted: false });
  expect(execution.steps[0].error.message).toContain('page.goto');
  expect(execution.steps.slice(1).every((s: any) => s.status === 'not-run' && s.startedAt === null && s.actual === null)).toBe(true);
  expect(execution.operationPath.map((s: any) => s.stepId)).toEqual(['$navigate']);
});

test('记录器保留敏感值脱敏、输入原文、采集失败及原始操作错误', async ({ page }, info) => {
  await page.setContent('<input id="secret" type="password" value="secret-value"><input id="value" value=" 0012 "><input id="radio" type="radio" checked>');
  const recorder = new MesExecutionRecorder(page, sample(), info, () => ({ frame: page.mainFrame(), framePath: [] }));
  await expect(recorder.run('$navigate', [{ name: '敏感输入', address: { selector: '#secret' } }, { name: '原文', address: { selector: '#value' } }, { name: '无内部值单选', address: { selector: '#radio' } }], async () => {
    await page.close(); throw new Error('原始操作失败');
  })).rejects.toThrow('原始操作失败');
  await recorder.finish(new Error('原始操作失败'));
  const record = evidence(info, 'MES 每步执行记录');
  expect(record.steps[0].before.targets[0].value).toMatchObject({ value: null, valueKnown: false, redacted: true });
  expect(record.steps[0].before.targets[1].value.value).toBe(' 0012 ');
  expect(record.steps[0].before.targets[2].value).toMatchObject({ value: null, valueKnown: false, checked: true });
  expect(record.steps[0].after.status).toBe('unavailable');
  expect(record.steps[0].error.message).toBe('原始操作失败');
  expect(record.evidenceComplete).toBe(false);
  expect(JSON.stringify(record)).not.toContain('secret-value');
});

test('进程中断记录不冒充完成，缺失或不匹配记录明确不可用', async ({}, info) => {
  const c = sample(), original = plannedExecution(c, info.testId);
  original.executionId = 'fixture'; original.status = 'running';
  original.steps[0].status = 'running'; original.steps[0].startedAt = new Date().toISOString();
  const path = info.outputPath('interrupted-record.json'); writeFileSync(path, JSON.stringify(original));
  const recorded = finalizeRecordedExecution(JSON.parse(readFileSync(path, 'utf8')), c, info.testId);
  expect(recorded.status).toBe('interrupted'); expect(recorded.steps[0].status).toBe('interrupted');
  expect(recorded.steps[0].finishedAt).toBeNull(); expect(recorded.steps[1].status).toBe('not-run');
  expect(executionView(recorded).evidenceComplete).toBe(false);
  expect(() => finalizeRecordedExecution(original, { ...c, id: 'different-case' }, info.testId)).toThrow(/不匹配/);
  const changed = structuredClone(original); changed.steps.at(-1)!.expected = { value: '篡改预期' };
  expect(() => finalizeRecordedExecution(changed, c, info.testId)).toThrow(/不匹配/);
  const reporter = new MesReporter(); reporter.dir = info.outputDir;
  const fakeTest = { id: info.testId, title: c.title, annotations: [{ type: 'mes-case', description: JSON.stringify(c) }] } as any;
  const fakeResult = { status: 'interrupted', startTime: new Date(), duration: 0, errors: [], attachments: [], steps: [] } as any;
  expect(reporter.resultRecord(fakeTest, fakeResult).execution.status).toBe('unavailable');
  fakeTest.annotations.push({ type: 'mes-execution-file', description: path });
  expect(reporter.resultRecord(fakeTest, fakeResult).execution.status).toBe('interrupted');
  expect(reporter.resultRecord(fakeTest).execution.operationPath).toEqual([]);
});

test('附件写入失败不覆盖原始断言失败，报告单独标注证据缺口', async ({ page }, info) => {
  await page.route('http://mes-fixture.test/**', r => r.fulfill({ contentType: 'text/html', body: html() }));
  const c = withOpen(sample()); c.checks[0] = { ...c.checks[0], kind: 'value', expected: '独立预期不匹配' };
  const failingInfo = { testId: info.testId, annotations: info.annotations, outputPath: info.outputPath.bind(info),
    attach: async () => { throw new Error('模拟附件写入失败'); } } as unknown as typeof info;
  await expect(executeMesWorkflowCase(page, c, failingInfo)).rejects.toThrow(/独立预期不匹配/);
  const path = failingInfo.annotations.find(a => a.type === 'mes-execution-file')!.description!;
  const record = JSON.parse(readFileSync(path, 'utf8'));
  expect(record.status).toBe('failed'); expect(record.steps.at(-1).actual.value).toBe('称量检查');
  expect(record.steps.at(-1).error.message).toContain('独立预期不匹配');
  expect(failingInfo.annotations.some(a => a.type === 'mes-evidence-error')).toBe(true);
});
