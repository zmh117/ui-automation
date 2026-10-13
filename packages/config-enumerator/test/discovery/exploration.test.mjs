import test, { before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { discoverPage, parseDiscoveryPlan, createDiscoveryDraft, renderDiscoveryReport, scanDocument, findElement } from '../../dist/discovery/index.js';

let browser, context, page;
before(async () => { browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'chrome', headless: true }); });
after(async () => { await browser?.close(); });
beforeEach(async () => { context = await browser.newContext(); page = await context.newPage(); });
afterEach(async () => { await context.close(); });
const origin = 'http://exploration.invalid';
const plan = (exploration = {}, limits = {}) => ({ schemaVersion: 3, id: 'auto', scenes: [{ id: 'root', url: origin + '/', ready: { selector: '#home' }, steps: [] }], exploration: { maxDepth: 3, maxActions: 100, settleMs: 100, ...exploration }, limits: { timeoutMs: 2000, maxSnapshots: 30, ...limits } });
const wrap = html => `<main id="home">${html}</main><script>const hit=()=>localStorage.setItem('writes',String(Number(localStorage.getItem('writes')||0)+1));</script>`;
async function fixture(html, routes = {}) {
  await context.route(origin + '/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: routes[new URL(route.request().url()).pathname] ?? html }));
}
const success = report => report.exploration.results.filter(r => r.status === 'explored');
const labels = report => success(report).map(r => r.path.map(h => h.label).join('/'));

// 此文件使用真实 Chrome + 隔离 HTTP 页面，副作用用 localStorage 独立计数。
test('BFS 探索新增、详情、两行业务键修改，嵌套弹框并保存可重放路径', async () => {
  await fixture(wrap(`<button type="button" onclick="document.querySelector('#editor').hidden=false">新增</button>
    <table aria-label="物料"><tbody><tr data-row-key="A"><td>A</td><td><a href="/edit?id=A">修改</a></td></tr><tr data-row-key="B"><td>B</td><td><a href="/edit?id=B">修改</a></td></tr></tbody></table>
    <button type="button" onclick="document.querySelector('#detail').hidden=false">详情</button>
    <section id="detail" hidden role="region" aria-label="只读详情">展示文字，没有输入框。</section>
    <section hidden role="dialog" aria-label="配置" id="editor"><input aria-label="名称"><button type="button" onclick="document.querySelector('#inner').hidden=false">高级配置</button><button type="button" onclick="hit()">保存</button></section>
    <section hidden role="dialog" aria-label="内层" id="inner"><input aria-label="精度"><button onclick="hit()" type="button">确定</button></section>`), { '/edit': wrap('<h2>修改页面</h2><label>说明<input name="description"></label>') });
  const report = await discoverPage(page, plan());
  assert.equal(report.status, 'completed', JSON.stringify(report.exploration.results.filter(r => ['failed','blocked'].includes(r.status))));
  assert.ok(labels(report).includes('新增/高级配置'), JSON.stringify(report.exploration.results));
  assert.ok(labels(report).includes('详情'));
  const edit = success(report).filter(r => r.path.at(-1).label === '修改');
  assert.deepEqual(edit.map(r => new URL(r.path.at(-1).destination.url).search).sort(), ['?id=A','?id=B']);
  assert.ok(success(report).filter(r => r.depth > 1).every(r => report.snapshots.find(s => s.id === r.snapshotId).path.length === r.depth));
  assert.ok(report.snapshots.some(s => s.controls.some(c => c.label === '精度')));
  assert.equal(await page.evaluate(() => localStorage.getItem('writes')), null);
  const depths = success(report).map(r => r.depth); assert.deepEqual(depths, [...depths].sort((a,b)=>a-b));
  assert.ok(!JSON.stringify(edit.map(r => r.path)).includes('nth-'));
  const md = renderDiscoveryReport(report, await createDiscoveryDraft(report));
  assert.match(md, /自动探索路径/); assert.match(md, /新增 → 高级配置/);
});

test('新窗口归属当前动作，扫描后关闭，不关闭调用方原有窗口', async () => {
  await fixture(wrap('<button type="button" onclick="window.open(\'/new\',\'_blank\')">查看新窗口</button>'), { '/new': wrap('<label>窗口字段<input name="window-field"></label>') });
  const other = await context.newPage();
  const report = await discoverPage(page, plan());
  assert.equal(report.status, 'completed');
  assert.equal(success(report)[0].path[0].destination.kind, 'popup');
  assert.ok(report.snapshots.some(s=>s.controls.some(c=>c.label === '窗口字段')));
  assert.deepEqual(new Set(context.pages()), new Set([page, other]));
});

test('删除仅明确配置的确认弹框可打开，确认是终点，其他写按钮和主配方跳过', async () => {
  await fixture(wrap(`<button id="remove" type="button" onclick="document.querySelector('#confirm').hidden=false">删除</button>
    <button type="button" onclick="hit()">删除全部</button><button type="button" onclick="hit()">提交</button><button type="button" onclick="hit()">新增主配方</button>
    <section role="alertdialog" aria-label="删除确认" id="confirm" hidden><p>确认删除？</p><button type="button" onclick="hit()">确认删除</button><button type="button" onclick="hit()">查看危险后续</button></section>`));
  const report = await discoverPage(page, plan({ confirmationEntries: [{ target: { selector: '#remove' }, expected: { selector: '#confirm' } }] }));
  assert.deepEqual(labels(report), ['删除']);
  assert.equal(success(report)[0].path[0].kind, 'open-confirmation');
  assert.equal(await page.evaluate(() => localStorage.getItem('writes')), null);
  assert.ok(report.exploration.results.some(r => r.reason?.includes('排除名称')));
  assert.ok(report.exploration.results.some(r => r.reason?.includes('未配置预期')));
});

test('主配方起始页和目标 URL 排除，不采集其字段', async () => {
  await fixture(wrap('<h1>主配方配置</h1><input aria-label="不采集"><button type="button" onclick="hit()">新增</button>'));
  let report = await discoverPage(page, plan());
  assert.equal(report.snapshots.length, 0); assert.equal(report.scenes[0].status, 'blocked');
  await context.unrouteAll();
  await fixture(wrap('<a href="/recipe?id=1">详情</a>'), { '/recipe': wrap('<input aria-label="不采集">') });
  report = await discoverPage(page, plan({ excludeUrlIncludes: ['/recipe'] }));
  assert.equal(success(report).length, 0); assert.equal(report.exploration.actions, 0);
});

test('深度与动作预算明确报告；没有无限循环或位置回退', async () => {
  await fixture(wrap('<button type="button" onclick="document.querySelector(\'#one\').hidden=false">新增</button><section id="one" hidden role="dialog" aria-label="一层"><button type="button" onclick="document.querySelector(\'#two\').hidden=false">高级配置</button></section><section id="two" hidden role="dialog" aria-label="二层"><input aria-label="二层字段"></section>'));
  let report = await discoverPage(page, plan({ maxDepth: 1 }));
  assert.deepEqual(labels(report), ['新增']); assert.equal(report.status, 'partial');
  assert.ok(report.exploration.results.some(r=>r.reason?.includes('深度上限')));
  report = await discoverPage(page, plan({ maxActions: 1 }));
  assert.equal(report.exploration.actions, 1); assert.equal(report.status, 'partial');
  assert.ok(report.exploration.results.some(r=>r.status === 'limited'));
});

test('隐藏入口和祖先被排除，无唯一锚点的重复按钮不点击', async () => {
  await fixture(wrap('<div hidden><button onclick="hit()">新增</button></div><div style="opacity:0"><button onclick="hit()">查看</button></div><button type="button" onclick="hit()">修改</button><button type="button" onclick="hit()">修改</button>'));
  const report = await discoverPage(page, plan());
  assert.equal(report.exploration.actions, 0); assert.equal(report.status, 'partial');
  assert.equal(report.snapshots[0].controls.length, 2);
  assert.ok(report.snapshots[0].controls.every(c => !c.locator.unique));
  assert.equal(await page.evaluate(() => localStorage.getItem('writes')), null);
});

test('iframe 和开放 Shadow 入口保留路径，扫描新的表单', async () => {
  await fixture(wrap('<iframe title="子配置" src="/frame"></iframe><div id="host"></div><script>document.querySelector("#host").attachShadow({mode:"open"}).innerHTML=`<button type="button" onclick="this.getRootNode().querySelector(\'section\').hidden=false">新增</button><section role="region" aria-label="影子表单" hidden><input aria-label="影子字段"></section>`;</script>'), { '/frame': wrap('<button type="button" onclick="document.querySelector(\'#form\').hidden=false">修改</button><section id="form" hidden role="region" aria-label="Frame 配置"><input aria-label="Frame 字段"></section>') });
  const report = await discoverPage(page, plan({ maxDepth: 1 }));
  assert.ok(report.snapshots.some(s=>s.controls.some(c=>c.label === 'Frame 字段')));
  assert.ok(report.snapshots.some(s=>s.controls.some(c=>c.label === '影子字段')));
  assert.ok(success(report).some(r=>r.path[0].source.framePath.length === 1));
  assert.ok(success(report).some(r=>r.path[0].target.shadowPath.length === 1));
});

test('纯图标识别与外层按钮去重，行排序变化仍回查原业务行', async () => {
  await page.setContent('<table aria-label="列表"><tbody><tr data-row-key="A"><td><button type="button" title="修改"><i class="icon_edit"></i></button></td></tr><tr data-row-key="B"><td><button type="button" title="修改"><i class="icon_edit"></i></button></td></tr></tbody></table>');
  const observation = await page.evaluate(scanDocument, { scopes: [{ selector: 'body' }], framePath: [], maxCells: 20, maxShadowDepth: 8, maxControls: 50, maxOptions: 20, maxTextLength: 300 });
  assert.equal(observation.controls.length, 2); assert.ok(observation.controls.every(c=>c.entry.allowed));
  const a = observation.controls.find(c=>c.row.key === 'A');
  await page.locator('tbody').evaluate(el=>el.prepend(el.lastElementChild));
  const target = await findElement(page.mainFrame(), a.locator);
  try { assert.equal(await target.evaluate(el=>el.closest('tr').dataset.rowKey), 'A'); } finally { await target.dispose(); }
});

test('未配置导航来源、多个弹框及无变化按钮明确阻止', async () => {
  await fixture(wrap('<a href="http://other.invalid/">详情外部</a><button type="button" onclick="document.querySelectorAll(\'[role=dialog]\').forEach(d=>d.hidden=false)">新增</button><section hidden role="dialog" aria-label="一"><input aria-label="一字段"></section><section hidden role="dialog" aria-label="二"><input aria-label="二字段"></section><button type="button">查看无变化</button>'));
  const report = await discoverPage(page, plan({}, { timeoutMs: 800 }));
  assert.equal(success(report).length, 0); assert.equal(report.status, 'partial');
  assert.ok(report.exploration.results.some(r=>r.reason?.includes('同来源')));
  assert.ok(report.exploration.results.some(r=>r.reason?.includes('多个弹框')));
  assert.ok(report.exploration.results.some(r=>r.reason?.includes('超时')));
});

test('探索格式拒绝无界深度、无效预算和确认定位缺失', () => {
  for (const exploration of [{maxDepth:0},{maxDepth:17},{maxActions:0},{settleMs:0},{confirmationEntries:[{target:{selector:'#delete'}}]}]) assert.throws(()=>parseDiscoveryPlan(plan(exploration)));
});

test('实际 Vue 项目入口页：同名行编辑、详情、新窗口和删除终点，不执行业务动作', async () => {
  const input = JSON.parse(readFileSync(new URL('../../examples/entry-exploration.json', import.meta.url)));
  input.exploration.maxDepth = 3; input.exploration.settleMs = 100;
  const storageBefore = await context.storageState();
  const report = await discoverPage(page, input);
  assert.deepEqual(await context.storageState(), storageBefore);
  assert.ok(!report.exploration.results.some(r => ['failed', 'blocked'].includes(r.status)), JSON.stringify(report.exploration.results.filter(r => ['failed', 'blocked'].includes(r.status))));
  const paths = labels(report);
  assert.ok(paths.includes('新增/高级配置'), JSON.stringify(report.exploration.results.filter(r=>r.status==='failed'||r.status==='blocked')));
  for (const label of ['新增','新建页面','查看新窗口','展示统计','修改','详情','删除物料 A']) assert.ok(paths.includes(label), label);
  assert.equal(success(report).filter(r=>r.path.length===1 && r.path[0].label==='修改').length, 2);
  assert.ok(!success(report).some(r=>r.path.some(h=>h.label.includes('主配方'))));
  assert.ok(!success(report).some(r=>r.path.length>1 && r.path[0].label==='删除物料 A'));
  assert.deepEqual(context.pages(), [page]);
  await page.goto(input.scenes[0].url);
  assert.equal(await page.getByRole('status').textContent(), '业务操作计数：0');
});

test('主配方 iframe 排除，其他文档继续扫描；URL 参数中的业务 ID 不合并', async () => {
  await fixture(wrap('<iframe title="主配方" src="/frame"></iframe><input aria-label="正常字段">'), { '/frame': wrap('<h1>主配方配置</h1><input aria-label="配方内部"><button type="button" onclick="hit()">新增</button>') });
  const report = await discoverPage(page, plan());
  assert.ok(report.snapshots[0].documents.some(d=>d.status==='excluded'));
  assert.ok(report.snapshots[0].controls.some(c=>c.label==='正常字段'));
  assert.ok(!report.snapshots.some(s=>s.controls.some(c=>c.label==='配方内部')));
  assert.equal(report.exploration.actions, 0);
});

test('异步展示等待稳定；确认契约错误不进入任何后续动作', async () => {
  await fixture(wrap('<button type="button" onclick="setTimeout(()=>document.querySelector(\'#form\').hidden=false,150)">新增</button><section id="form" hidden role="region" aria-label="异步表单"><input aria-label="异步字段"></section><button id="del" type="button" onclick="document.querySelector(\'#actual\').hidden=false">删除</button><section role="dialog" aria-label="错误弹框" id="actual" hidden><button type="button" onclick="hit()">查看后续</button></section>'));
  const report = await discoverPage(page, plan({ confirmationEntries:[{target:{selector:'#del'},expected:{selector:'#expected'}}] }));
  assert.ok(labels(report).includes('新增'));
  assert.ok(report.exploration.results.some(r=>r.reason?.includes('不是配置的确认弹框')));
  assert.ok(!labels(report).some(l=>l.includes('查看后续')));
  assert.equal(await page.evaluate(()=>localStorage.getItem('writes')), null);
});

test('命令入口支持自动探索参数；没有开启自动探索时不接受深度覆盖', async () => {
  const { spawnSync } = await import('node:child_process');
  const help = spawnSync(process.execPath, ['bin/discover.mjs','--help'], {cwd:new URL('../../',import.meta.url), encoding:'utf8'});
  assert.equal(help.status,0); assert.match(help.stdout,/--auto-explore/);
  const bad = spawnSync(process.execPath, ['bin/discover.mjs','--plan','examples/playground-discovery.json','--out','output/unused-cli-test','--max-depth','3'], {cwd:new URL('../../',import.meta.url), encoding:'utf8'});
  assert.equal(bad.status,1); assert.match(bad.stderr,/必须配合/);
});
