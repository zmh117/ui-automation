import test, { before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { scanDocument, createUiElementModel, findUiRelations, fingerprintReport, discoverPage } from '../../dist/discovery/index.js';

let browser, context, page;
before(async () => { browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'chrome', headless: true }); });
after(async () => { await browser?.close(); });
beforeEach(async () => { context = await browser.newContext(); page = await context.newPage(); });
afterEach(async () => { await context.close(); });
const settings = { scopes: [{ selector: 'body' }], framePath: [], maxCells: 200, maxShadowDepth: 8, maxControls: 200, maxOptions: 30, maxTextLength: 500, includeRegions: true };
const address = id => ({ selector: `[data-testid="${id}"]` });
const scan = () => page.evaluate(scanDocument, settings);
async function modelOf(observations) {
  const snapshots = observations.map((o, i) => ({ ...o, id: `mes:${i}`, sceneId: 'mes', afterStep: i, documents: [{ context: { url: o.url, framePath: [] }, status: 'scanned' }], associations: [] }));
  const report = { schemaVersion: 3, artifactType: 'page-discovery', reportId: '', plan: { schemaVersion: 3, id: 'mes', scenes: [{ id: 'mes', url: page.url(), ready: { selector: 'body' }, steps: [] }] },
    startedAt: '', finishedAt: '', status: 'completed', scope: 'specified-scenes-and-openers', snapshots, scenes: [], limitations: [] };
  report.reportId = await fingerprintReport(report); return createUiElementModel(report);
}

test('真实 DOM 表单/表格/业务行关系：排序后操作身份保持且不使用行号', async () => {
  await page.setContent(`<form data-testid="filter"><input data-testid="filter-code" aria-label="编码"></form>
    <div class="ivu-table-wrapper" data-testid="table"><table><thead><tr><th>编号</th><th>操作</th></tr></thead><tbody>
    <tr data-testid="table-row-COR-A-01"><td data-testid="table-td-code">COR-A-01</td><td><button data-testid="detail">详情</button></td></tr>
    <tr data-testid="table-row-COR-B-01"><td data-testid="table-td-code">COR-B-01</td><td><button data-testid="detail">详情</button></td></tr>
    </tbody></table></div>`);
  const before = await scan();
  await page.locator('tbody').evaluate(el => el.prepend(el.lastElementChild));
  const after = await scan(), model = await modelOf([before, after]);
  const rows = model.elements.filter(n => n.kinds.includes('row') && n.locator?.selector.includes('table-row-'));
  assert.equal(rows.length, 2);
  for (const row of rows) {
    const children = findUiRelations(model, row.id, { direction: 'outgoing', kind: 'contains' }).map(edge => model.elements.find(n => n.id === edge.to));
    assert.equal(children.filter(n => n.kinds.includes('action')).length, 1);
    const action = children.find(n => n.kinds.includes('action'));
    assert.equal(action.observations.length, 2); assert.equal(action.locatable, true);
  }
  const form = model.elements.find(n => n.kinds.includes('form'));
  assert.ok(findUiRelations(model, form.id, { kind: 'contains', direction: 'outgoing' }).some(e => model.elements.find(n => n.id === e.to).kinds.includes('field')));
  assert.equal(before.cells.find(c => c.displayText === 'COR-A-01').columnLabel, '编号');
  assert.ok(rows.every(n => n.identityBasis === 'locator'));
});

const dropdown = (id, value) => `<div class="md-select"><input data-testid="${id}" readonly><i data-testid="${id}-trigger">∨</i></div>
  <div class="ivu-select-dropdown" data-testid="${id}-panel"><ul class="md-down-ul"><li data-testid="${id}-option-${value}" data-value="${value}">选项${value}</li></ul></div>`;

test('依据真实 test-id 约定关联两个 transfer 浮层，保持选项所属关系', async () => {
  await page.setContent(dropdown('first', 0) + dropdown('second', 2));
  const observed = await scan();
  const fields = observed.controls.filter(c => c.kind === 'combobox');
  assert.equal(fields.length, 2);
  for (const c of fields) {
    assert.equal(c.popups.length, 1); assert.equal(c.popups[0].basis, 'test-id-contract');
    assert.equal(c.options.length, 1);
    assert.equal(c.popups[0].locator.selector, address(c.attributes['data-testid'] + '-panel').selector);
    assert.ok(c.targets.some(t => t.selector === address(c.attributes['data-testid']).selector));
  }
  const model = await modelOf([observed]);
  assert.equal(model.relations.filter(e => e.kind === 'has-popup').length, 2);
  assert.equal(model.relations.filter(e => e.kind === 'has-option').length, 2);
  assert.equal(model.relations.filter(e => e.kind === 'opens').length, 0, '归属关系不是已点击证据');
});

test('同名重复浮层或隐藏浮层不被猜测关联，未知选项不能进入正式值域', async () => {
  await page.setContent(dropdown('first', 0) + '<div data-testid="first-panel">重复浮层</div>' + dropdown('second', 1));
  await page.getByTestId('second-panel').evaluate(el => { el.hidden = true; });
  const observed = await scan();
  assert.ok(observed.controls.filter(c => c.kind === 'combobox').every(c => c.popups.length === 0 && c.options.length === 0));
  const model = await modelOf([observed]);
  assert.equal(model.relations.filter(e => e.kind === 'has-popup').length, 0);
  assert.equal(model.status, 'partial');
});

test('指定入口建立嵌套弹框打开关系，保存按钮仅被记录且未点击', async () => {
  const origin = 'http://ui-relations.invalid/';
  await context.route(origin, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<button id="open" onclick="document.querySelector('#outer').hidden=false">打开配置</button>
    <section id="outer" hidden role="dialog" aria-label="外层"><input aria-label="名称"><button id="inner-open" onclick="document.querySelector('#inner').hidden=false">打开选择</button></section>
    <section id="inner" hidden role="dialog" aria-label="内层"><input aria-label="变量"><button onclick="localStorage.setItem('saved','1')">保存</button></section>` }));
  const report = await discoverPage(page, { schemaVersion: 3, id: 'nested', scenes: [{ id: 'nested', url: origin, ready: { selector: '#open' }, steps: [
    { kind: 'open-dialog', target: { selector: '#open' }, expected: { selector: '#outer' } },
    { kind: 'open-dialog', target: { selector: '#inner-open' }, expected: { selector: '#inner' } },
  ] }] });
  assert.equal(report.status, 'completed', JSON.stringify(report.scenes));
  const model = await createUiElementModel(report), edges = model.relations.filter(e => e.kind === 'opens');
  assert.equal(edges.length, 2, JSON.stringify(model.limitations));
  assert.ok(edges.every(e => e.evidence.every(x => x.basis === 'verified-transition')));
  assert.ok(model.relations.some(e => e.evidence.some(x => x.detail === 'parent-dialog')));
  assert.equal(await page.evaluate(() => localStorage.getItem('saved')), null);
});

test('自动探索只为成功路径建立关系，失败或跳过入口不伪造目标', async () => {
  const origin = 'http://ui-relations.invalid/';
  await context.route(origin, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<main id="ready"><button id="add" onclick="document.querySelector('#editor').hidden=false">新增</button>
    <button id="view">详情</button><section role="dialog" aria-label="编辑" id="editor" hidden><input aria-label="编码"><button>保存</button></section></main>` }));
  const report = await discoverPage(page, { schemaVersion: 3, id: 'auto', scenes: [{ id: 'auto', url: origin, ready: { selector: '#ready' }, steps: [] }], exploration: { maxDepth: 1, maxActions: 4, settleMs: 100 }, limits: { timeoutMs: 300 } });
  const model = await createUiElementModel(report), edges = model.relations.filter(e => e.kind === 'opens');
  assert.equal(edges.length, 1, JSON.stringify(model.limitations));
  const target = model.elements.find(n => n.id === edges[0].to);
  assert.ok(target.kinds.includes('dialog'));
  assert.equal(model.elements.find(n => n.id === edges[0].from).locator.selector, '[id="add"]');
});

test('Frame 内导航关联目标文档，保留外层页面而不误记为整个页面跳转', async () => {
  const origin = 'http://ui-relations.invalid/';
  await context.route(origin + '**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body:
    new URL(route.request().url()).pathname === '/frame' ? '<a id="view" href="/details">详情</a>' :
      new URL(route.request().url()).pathname === '/details' ? '<section role="region" aria-label="详情"><input aria-label="编号" value="A" readonly></section>' :
        '<main id="ready"><iframe id="child" src="/frame"></iframe></main>' }));
  const report = await discoverPage(page, { schemaVersion: 3, id: 'frame', scenes: [{ id: 'frame', url: origin, ready: { selector: '#child' }, steps: [] }], exploration: { maxDepth: 1, maxActions: 2, settleMs: 100 }, limits: { timeoutMs: 2000 } });
  const model = await createUiElementModel(report), opens = model.relations.filter(r => r.kind === 'opens');
  assert.equal(opens.length, 1, JSON.stringify(report.exploration));
  const target = model.elements.find(n => n.id === opens[0].to);
  assert.ok(target.kinds.includes('document'));
  assert.equal(target.context.url, origin + 'details');
  assert.equal(target.context.framePath.length, 1);
  assert.equal(target.pageUrl, origin);
});
