import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { parseMesCases, type MesWorkflowCase } from '../cases';
import { executeMesWorkflowCase, openMesWorkflowNode } from '../../pages/mes-workflow';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '../..');
const scenario = JSON.parse(readFileSync(resolve(import.meta.dirname, '../cases.example.json'), 'utf8')).cases[0] as MesWorkflowCase;
const sample = (url = 'http://mes-fixture.test/', node = scenario.node): MesWorkflowCase => ({ ...structuredClone(scenario), url, node });
const plan = (c: MesWorkflowCase) => ({ schemaVersion: 1, cases: [c] });

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
  return { ...c, open: [{ target: { selector: '[data-testid="show-workflow"]' }, expected: c.workflow }] };
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
    { schemaVersion: 1, cases: [sample(), sample()] },
    { schemaVersion: 1, cases: [{ ...sample(), save: true }] },
    plan({ ...sample(), url: 'file:///etc/passwd' }),
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
    { target: { selector: '[data-testid="result-label"]' }, kind: 'text', expected: '已打开 配置' },
    { target: { selector: '[data-testid="enabled"]' }, kind: 'checked', expected: true },
  );
  const first = await executeMesWorkflowCase(page, c, info);
  offset = 1000;
  const second = await executeMesWorkflowCase(page, c, info);
  expect(first.node.id).toBe('1'); expect(second.node.id).toBe('1001');
  expect(await page.evaluate(() => (window as any).clicked)).toEqual(['1001']);
  expect(evidence(info, '工作流节点当前定位证据').matchedNode.id).toBe('1001');
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
  await expect(executeMesWorkflowCase(page, c, info)).rejects.toThrow(/另一节点/);
  expect(await page.evaluate(() => (window as any).clicked)).toEqual(['1']);
  expect(evidence(info, '工作流失败现场').phase).toBe('断言');
  expect(evidence(info, '面板独立预期与实际值').actual.value).toBe('称量检查');
});

test('相同短名按当前可见实例唯一定位，真实重复拒绝点击', async ({ page }, info) => {
  await page.route('http://mes-fixture.test/**', r => r.fulfill({ contentType: 'text/html', body: html(0, '<button hidden data-testid="show-workflow">隐藏旧实例</button>') }));
  await executeMesWorkflowCase(page, withOpen(sample()), info);
  await page.unrouteAll();
  await page.route('http://mes-fixture.test/**', r => r.fulfill({ contentType: 'text/html', body: html(0, '<button data-testid="show-workflow">另一实例</button>') }));
  await expect(executeMesWorkflowCase(page, withOpen(sample()), info)).rejects.toThrow(/不唯一/);
  expect(await page.evaluate(() => (window as any).clicked)).toEqual([]);
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
  c.open = c.open!.map(s => ({ target: shadow(s.target), expected: shadow(s.expected) }));
  c.checks = c.checks.map(s => ({ ...s, target: shadow(s.target) }));
  expect((await executeMesWorkflowCase(page, c, info)).node.id).toBe('1');
  await page.unrouteAll();
  await page.route('http://mes-fixture.test/**', r => r.fulfill({ contentType: 'text/html', body: html(0, '<input data-testid="outside" value="称量检查">') }));
  const outside = withOpen(sample());
  outside.workflow = shadow(outside.workflow); outside.expectedPanel = shadow(outside.expectedPanel);
  outside.open = outside.open!.map(s => ({ target: shadow(s.target), expected: shadow(s.expected) }));
  outside.checks = [{ target: shadow({ selector: '[data-testid="outside"]' }), kind: 'value', expected: '称量检查' }];
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
    expect(clicks).toEqual([]);
    const passed = await invoke();
    expect(passed.code).toBe(0); expect(passed.summary).toMatchObject({ planned: 1, passed: 1, allPassed: true, scope: 'specified-mes-cases' });
    const record = JSON.parse(readFileSync(resolve(passed.dir, 'results.jsonl'), 'utf8'));
    const nodeEvidence = record.attachments.find((a: { name: string }) => a.name === '工作流节点当前定位证据');
    expect(JSON.parse(nodeEvidence.body ?? readFileSync(nodeEvidence.path, 'utf8')).matchedNode.id).toBe('201');
    c.checks[0] = { ...c.checks[0]!, kind: 'value', expected: '错误名称' };
    writeFileSync(cases, JSON.stringify(plan(c)));
    const failed = await invoke();
    expect(failed.code).not.toBe(0); expect(failed.summary).toMatchObject({ planned: 1, failed: 1, allPassed: false });
    const failure = JSON.parse(readFileSync(resolve(failed.dir, 'results.jsonl'), 'utf8'));
    expect(failure.attachments.some((a: { name: string }) => a.name === '工作流失败现场')).toBe(true);
    expect(failure.attachments.some((a: { name: string }) => a.name === 'trace')).toBe(true);
    expect(clicks).toHaveLength(2);
    const invalid = { ...c, node: { id: '201' } };
    writeFileSync(cases, JSON.stringify({ schemaVersion: 1, cases: [invalid] }));
    const rejected = await invoke();
    expect(rejected.code).not.toBe(0); expect(rejected.summary.planned).toBe(0);
    expect(rejected.summary.errors.join(' ')).toContain('动态 ID'); expect(clicks).toHaveLength(2);
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});
