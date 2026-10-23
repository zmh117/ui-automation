import test, { before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { readHandsontable, requireHandsontableCell, discoverPage, createHandsontableReport, createUiElementModel, fingerprintReport, scanDocument } from '../../dist/discovery/index.js';

const assets = resolve('node_modules/handsontable-pro/dist');
const js = readFileSync(join(assets, 'handsontable.full.min.js'), 'utf8');
const css = readFileSync(join(assets, 'handsontable.full.min.css'), 'utf8');
const url = 'http://handsontable.test/';
const address = { selector: '[data-testid="record-sheet"]' };
const settings = { scopes: [{ selector: 'body' }], framePath: [], maxCells: 300, maxShadowDepth: 8, maxControls: 300, maxOptions: 30, maxTextLength: 500, includeRegions: true };
let server, browser, context, page, owned = [];
const processList = () => execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).trim().split('\n').map(line => {
  const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/); return m ? { pid: Number(m[1]), ppid: Number(m[2]), command: m[3] } : null;
}).filter(Boolean);
function rememberProcesses() {
  const all = processList(), ids = new Set([server.process().pid]);
  let n; do { n = ids.size; for (const p of all) if (ids.has(p.ppid)) ids.add(p.pid); } while (n !== ids.size);
  for (const p of all.filter(p => ids.has(p.pid))) if (!owned.some(o => o.pid === p.pid && o.command === p.command)) owned.push(p);
}
before(async () => {
  server = await chromium.launchServer({ channel: process.env.BROWSER_CHANNEL ?? 'chrome', headless: true });
  browser = await chromium.connect(server.wsEndpoint()); rememberProcesses();
});
after(async () => {
  if (!server) return;
  rememberProcesses(); await browser?.close(); await server.close();
  const all = processList(); const remaining = owned.filter(p => all.some(live => live.pid === p.pid && live.command === p.command));
  writeFileSync(process.env.HOT_PROCESS_LOG ?? '/tmp/mes-hot-browser-processes.json', JSON.stringify({ owned, remaining }, null, 2));
  assert.deepEqual(remaining, [], '本次浏览器进程应全部退出');
});

const boot = `
const data = Array.from({length:80}, (_,r) => Array.from({length:12}, (_,c) => r + ':' + c));
data[0][0] = '批记录'; data[1][1] = 36.5; data[2][2] = '合并区域';
window.changes = 0;
window.hot = new Handsontable(document.querySelector('[data-testid="record-sheet"]'), {
 data, rowHeaders:true, colHeaders:true, width:550, height:240, colWidths:90, rowHeights:30,
 fixedRowsTop:1, fixedColumnsLeft:1, mergeCells:[{row:2,col:2,rowspan:2,colspan:2}],
 afterChange: () => window.changes++,
 cells(row,col) { return { renderer(instance,td,r,c,prop,value) {
   Handsontable.renderers.TextRenderer.apply(this,arguments);
   if (r===1 && c===1) { td.innerHTML = '温度 <span class="control-text" style="color:rgb(255, 0, 0);font-weight:bold">36.50</span> ℃'; td.style.backgroundColor='rgb(240, 240, 0)'; td.style.textAlign='right'; }
   if (r===1 && c===2) { td.innerHTML = '<input readonly value="0012"><input type="checkbox" checked><input type="password" value="SECRET"><span hidden>HIDDEN</span>'; }
 }}; }
});`;
const html = `<meta charset="utf-8"><link rel="stylesheet" href="/hot.css"><section aria-label="批记录"><div data-testid="record-sheet"></div></section><script src="/hot.js"></script><script>${boot}</script>`;
beforeEach(async () => {
  context = await browser.newContext({ viewport: { width: 900, height: 700 } });
  await context.route(url + '**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ contentType: path === '/hot.js' ? 'application/javascript' : path === '/hot.css' ? 'text/css' : 'text/html; charset=utf-8', body: path === '/hot.js' ? js : path === '/hot.css' ? css : html });
  });
  page = await context.newPage(); await page.goto(url); await page.locator('.ht_master tbody td').first().waitFor(); rememberProcesses();
});
afterEach(async () => { await context?.close(); });
const read = options => readHandsontable(page.mainFrame(), address, options);
const state = () => page.evaluate(() => ({ data: hot.getData(), changes, html: document.querySelector('[data-testid="record-sheet"]').innerHTML, scroll: [...document.querySelectorAll('.wtHolder')].map(el => [el.scrollTop, el.scrollLeft]) }));

test('真实 Handsontable 6.2.3：读取显示值、格式、合并和嵌入控件，全程无修改', async () => {
  const before = await state(), result = await read();
  assert.deepEqual(await state(), before);
  const temperature = requireHandsontableCell(result, { rowHeader: '2', columnHeader: 'B' });
  assert.equal(temperature.displayText, '温度 36.50 ℃');
  assert.equal(temperature.format['background-color'], 'rgb(240, 240, 0)');
  assert.equal(temperature.parts[0].format.color, 'rgb(255, 0, 0)');
  assert.equal(temperature.valueKnown, false); assert.equal(temperature.businessValue, null);
  const merged = requireHandsontableCell(result, { rowHeader: '3', columnHeader: 'C' });
  assert.deepEqual(merged.merge, { rowSpan: 2, colSpan: 2 });
  const controls = requireHandsontableCell(result, { rowHeader: '2', columnHeader: 'C' });
  assert.equal(controls.parts[0].value, '0012'); assert.equal(controls.parts[0].readOnly, true);
  assert.equal(controls.parts[1].checked, true); assert.equal(controls.parts[2].valueKnown, false);
  assert.ok(!JSON.stringify(result).includes('SECRET')); assert.ok(!JSON.stringify(result).includes('HIDDEN'));
  assert.equal(result.coverage.totalCells, null); assert.equal(result.coverage.allDataCovered, false);
  assert.equal(await page.locator('td[data-testid]').count(), 0);
});

test('固定区域副本由标题和内容证明关联，冲突拒绝自动选取', async () => {
  const result = await read();
  assert.ok(result.cells.some(c => c.duplicateOf), JSON.stringify(result.cells.map(c => [c.pane,c.headers])));
  const cell = requireHandsontableCell(result, { rowHeader: '1', columnHeader: 'A' });
  assert.equal(cell.displayText, '批记录');
  await page.locator('.ht_clone_top_left_corner tbody td').first().evaluate(el => { el.textContent = '冲突'; });
  const conflict = await read();
  assert.throws(() => requireHandsontableCell(conflict, { rowHeader: '1', columnHeader: 'A' }), /歧义/);
});

test('虚拟滚动仅观察当前区域，读取不移动视口，屏幕位置不充当跨快照身份', async () => {
  const first = await read();
  await page.locator('.ht_master .wtHolder').evaluate(el => { el.scrollTop = 1500; el.scrollLeft = 350; });
  await page.waitForFunction(() => [...document.querySelectorAll('.ht_clone_left tbody th')].some(el => Number(el.innerText) > 40));
  const before = await state(), second = await read();
  assert.deepEqual(await state(), before);
  assert.ok(second.cells.some(c => Number(c.headers.row) > 40));
  assert.ok(first.cells.some(c => c.headers.row === '2'));
  assert.equal(second.coverage.allDataCovered, false);
  assert.ok(second.cells.every(c => c.identityBasis === 'snapshot-only'));
});

test('预算、文本截断、重复/缺失标题及关闭格式采集', async () => {
  const limited = await read({ maxCells: 2, maxTextLength: 2 });
  assert.equal(limited.cells.length, 2); assert.equal(limited.status, 'limited');
  const empty = await read({ maxCells: 0 }); assert.equal(empty.status, 'limited');
  assert.ok((await read({ includeStyles: false })).cells.every(c => c.format === null));
  await page.evaluate(() => hot.updateSettings({ rowHeaders: false, colHeaders: ['重复','重复'] }));
  const missing = await read(); assert.ok(missing.cells.every(c => !c.headers.uniqueInPane));
  assert.throws(() => requireHandsontableCell(missing, { rowHeader: '1', columnHeader: '重复' }));
  await assert.rejects(read({ maxCells: -1 }), /预算/);
});

test('重复标题即使落在预算外也不冒充唯一，块级换行及敏感输入明确处理', async () => {
  await page.evaluate(() => hot.updateSettings({ colHeaders: Array.from({length:12}, () => '重复') }));
  const repeated = await read({ maxCells: 1 });
  assert.equal(repeated.cells[0].headers.uniqueInPane, false);
  assert.throws(() => requireHandsontableCell(repeated, { rowHeader:'1', columnHeader:'重复' }));
  await page.evaluate(() => hot.updateSettings({ colHeaders: true }));
  await page.locator('.ht_master tbody tr').nth(1).locator('td').nth(1).evaluate(el => {
    el.innerHTML = '<div>第一行</div><div>第二行<br>第三行</div><span style="opacity:0">secret-text</span><input autocomplete="one-time-code" value="secret-code">';
  });
  const result = await read();
  const cell = requireHandsontableCell(result, { rowHeader:'2', columnHeader:'B' });
  assert.equal(cell.displayText, '第一行\n第二行\n第三行');
  assert.equal(cell.parts[0].valueKnown, false);
  assert.ok(!JSON.stringify(result).includes('secret-'));
});

test('隐藏祖先、重复外层、未知组件均不绕过定位，普通扫描不重复记录 HOT 数据格', async () => {
  const scan = await page.evaluate(scanDocument, settings);
  assert.equal(scan.handsontableTargets.length, 1); assert.equal(scan.cells.length, 0);
  await page.locator('section').evaluate(el => { el.style.opacity = '0'; });
  await assert.rejects(read(), /不可见/);
  assert.equal((await page.evaluate(scanDocument, settings)).handsontableTargets.length, 0);
  await page.locator('section').evaluate(el => { el.style.opacity = '1'; el.append(el.firstElementChild.cloneNode(true)); });
  await assert.rejects(read(), /不唯一/);
  await assert.rejects(readHandsontable(page.mainFrame(), { selector: 'body' }), /根节点/);
});

test('发现、JSON 和关系模型贯通，输出证据且拒绝报告篡改', async () => {
  const report = await discoverPage(page, { schemaVersion: 3, id: 'hot', scenes: [{ id: 'record', url, ready: address, steps: [] }] });
  assert.equal(report.snapshots[0].handsontables.length, 1);
  const output = await createHandsontableReport(report), model = await createUiElementModel(report);
  assert.equal(output.reportId, report.reportId); assert.equal(output.expectedValues, 'not-inferred');
  assert.ok(model.relations.some(r => r.kind === 'mirrors'));
  assert.ok(model.elements.some(e => e.kinds.includes('cell') && e.identityBasis === 'snapshot-only'));
  assert.ok(model.relations.some(r => r.kind === 'contains' && r.evidence.some(e => e.basis === 'handsontable-dom')));
  const second = structuredClone(report.snapshots[0]); second.id = 'record:1'; second.afterStep = 1;
  report.snapshots.push(second); report.reportId = await fingerprintReport(report);
  const repeated = await createUiElementModel(report);
  assert.equal(repeated.elements.filter(e => e.kinds.includes('cell')).length, model.elements.filter(e => e.kinds.includes('cell')).length * 2);
  if (process.env.HOT_TEST_OUTPUT) {
    mkdirSync(process.env.HOT_TEST_OUTPUT, { recursive: true });
    writeFileSync(join(process.env.HOT_TEST_OUTPUT, 'handsontable.json'), JSON.stringify(output, null, 2));
    writeFileSync(join(process.env.HOT_TEST_OUTPUT, 'ui-model.json'), JSON.stringify(model, null, 2));
  }
  report.snapshots[0].handsontables[0].cells[0].displayText = 'tampered';
  await assert.rejects(createHandsontableReport(report), /指纹/);
});

test('Frame 与开放 Shadow 的入口和关系保持上下文，隐藏宿主被排除', async () => {
  await context.route(url + 'frames', route => route.fulfill({ contentType: 'text/html', body: '<main id="ready"><iframe id="child" src="/"></iframe></main>' }));
  const report = await discoverPage(page, { schemaVersion: 3, id: 'frame', scenes: [{ id: 'f', url: url+'frames', ready: {selector:'#ready'}, steps:[] }] });
  const table = report.snapshots[0].handsontables[0];
  assert.equal(table.context.framePath.length, 1);
  await page.goto(url);
  await page.evaluate(({ css, boot }) => {
    hot.destroy(); document.body.innerHTML = '<div id="host"></div>';
    const shadow = document.querySelector('#host').attachShadow({mode:'open'});
    shadow.innerHTML = '<style>'+css+'</style><div data-testid="record-sheet"></div>';
    // Fixture initialization is separate from the reader under test.
    new Handsontable(shadow.querySelector('div'), {data:[['shadow']],rowHeaders:true,colHeaders:true});
  }, { css, boot });
  const shadowReading = await readHandsontable(page.mainFrame(), { ...address, shadowPath: ['#host'] });
  assert.equal(requireHandsontableCell(shadowReading, { rowHeader:'1',columnHeader:'A' }).displayText,'shadow');
  const scan = await page.evaluate(scanDocument, settings); assert.deepEqual(scan.handsontableTargets[0].locator.shadowPath, ['[id="host"]']);
  await page.locator('#host').evaluate(el => el.hidden = true);
  await assert.rejects(readHandsontable(page.mainFrame(), { ...address, shadowPath: ['#host'] }), /不可见/);
});
