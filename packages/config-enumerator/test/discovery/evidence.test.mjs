import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { discoverPage, createDiscoveryDraft, createReviewTemplate, compileReviewedModel, parseDiscoveryPlan, renderDiscoveryReport, enterFrames, findElement } from '../../dist/discovery/index.js';
import { scanDocument } from '../../dist/discovery/scan.js';

const plan = JSON.parse(readFileSync(new URL('../../examples/discovery-evidence.json', import.meta.url)));
const origin = process.env.PLAYGROUND_URL ?? 'http://127.0.0.1:5173/';
plan.scenes.forEach(scene => { scene.url = new URL('#/discovery', origin).href; });
const address = id => ({ selector: `[data-testid="${id}"]` });
const settings = { scopes: [address('discovery-editor')], framePath: [], maxControls: 300, maxOptions: 100, maxCells: 300, maxTextLength: 500, maxShadowDepth: 8 };
let browser, context, page, report, draft, storageBefore, storageAfter;
const writes = [];
const snapshot = id => { const s = report.snapshots.find(s => s.id === id); assert.ok(s, `${id}: ${JSON.stringify(report.scenes)}`); return s; };
const control = (id, field) => { const c = snapshot(id).controls.find(c => c.locator.selector === address(field).selector); assert.ok(c, `${id}/${field}`); return c; };
const oneScene = (id, overrides = {}, limits = {}) => ({ ...plan, limits: { ...plan.limits, ...limits }, scenes: [{ ...plan.scenes.find(s => s.id === id), ...overrides }] });

before(async () => {
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'chrome', headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.method() + ' ' + request.url()); });
  await page.goto(plan.scenes[0].url); await page.getByTestId('discovery-ready').waitFor();
  storageBefore = await context.storageState();
  report = await discoverPage(page, plan);
  storageAfter = await context.storageState();
  draft = await createDiscoveryDraft(report);
});
after(async () => { await browser?.close(); });

test('真实 Vue 验证页：10 入口、21 快照均完成，过程中没有业务写入', () => {
  assert.equal(report.status, 'completed', JSON.stringify(report.scenes));
  assert.equal(report.snapshots.length, 21);
  assert.ok(report.scenes.every(s => s.status === 'completed'));
  assert.deepEqual(storageAfter, storageBefore);
  assert.deepEqual(writes, []);
  assert.ok(report.snapshots.every(s => !s.truncated && s.documents.every(d => d.status === 'scanned')));
});

test('两层 Teleport 弹框按入口关联并补入范围，同名无关弹框不混入', () => {
  const baseline = snapshot('teleport:0'), first = snapshot('teleport:1'), second = snapshot('teleport:2');
  assert.equal(baseline.dialogs.length, 0);
  assert.ok(!baseline.controls.some(c => c.locator.selector === address('outer-name').selector));
  assert.ok(first.controls.some(c => c.locator.selector === address('outer-name').selector));
  assert.ok(!first.controls.some(c => c.locator.selector === address('shared-field').selector), '弹框令编辑器 inert 后仍采集可见关联弹框');
  assert.ok(second.controls.some(c => c.locator.selector === address('inner-search').selector));
  assert.ok(!second.controls.some(c => c.locator.selector === address('unrelated-field').selector));
  assert.deepEqual(second.dialogs.map(d => d.label), ['变量配置', '变量选择']);
  assert.equal(second.associations.length, 2);
  assert.deepEqual(second.associations[0].parentDialog, null);
  assert.deepEqual(second.associations[1].parentDialog, address('evidence-dialog'));
  assert.deepEqual(second.associations[1].opener, address('open-inner-evidence'));
  assert.ok(second.associations.every(a => a.transition === 'hidden-to-visible'));
});

test('原生集合、自定义完整、分页、虚拟、未知和远程加载各有独立完整性证据', () => {
  const cases = [
    ['teleport:0', 'native-options', 'complete', 3, 3],
    ['complete:1', 'complete-opener', 'complete', 5, 5],
    ['paged:1', 'paged-opener', 'partial', 2, 5],
    ['virtual:1', 'virtual-opener', 'partial', 3, 100],
    ['unknown:1', 'unknown-opener', 'unknown', 2, null],
    ['remote-ready:1', 'remote-opener', 'complete', 5, 5],
  ];
  for (const [id, field, status, observedCount, totalCount] of cases) {
    const evidence = control(id, field).optionCoverage;
    assert.deepEqual([evidence.status, evidence.observedCount, evidence.totalCount], [status, observedCount, totalCount], id);
  }
  const candidate = draft.fields.find(f => f.locator.selector === address('remote-opener').selector);
  assert.ok(candidate.observations.some(o => o.optionCoverage.status === 'unknown'));
  assert.ok(candidate.observations.some(o => o.optionCoverage.status === 'complete'));
});

test('远程请求未完成时保持部分发现，不因加载时间快慢误判完整', async () => {
  const pending = [];
  const hold = route => { pending.push(route); };
  await page.route('**/discovery-options.json', hold);
  try {
    const loading = await discoverPage(page, oneScene('remote'));
    assert.equal(loading.scenes[0].status, 'completed');
    const c = loading.snapshots.at(-1).controls.find(c => c.kind === 'combobox');
    assert.deepEqual([c.optionCoverage.status, c.optionCoverage.observedCount, c.optionCoverage.totalCount], ['partial', 0, null]);
    assert.match(c.optionCoverage.reasons.join(' '), /加载/);
    const loadingDraft = await createDiscoveryDraft(loading);
    assert.ok(loadingDraft.fields[0].observations.some(o => o.optionCoverage.status === 'partial'));
  } finally {
    await page.unroute('**/discovery-options.json', hold);
    await Promise.all(pending.map(route => route.continue().catch(() => {})));
  }
});

test('同 URL Frame、二层 Frame、跨源 Frame 与开放 Shadow 根保留独立身份', () => {
  const s = snapshot('teleport:0');
  assert.equal(s.documents.length, 7);
  assert.ok(s.documents.some(d => new URL(d.context.url).hostname !== new URL(origin).hostname));
  assert.ok(s.documents.some(d => d.context.framePath.length === 2));
  assert.ok(s.documents.some(d => d.context.framePath.some(a => a.shadowPath?.length)));
  const fields = s.controls.filter(c => c.locator.selector === address('shared-field').selector);
  assert.equal(fields.length, 13);
  assert.equal(new Set(fields.map(c => c.key)).size, fields.length);
  assert.ok(fields.some(c => c.context.framePath.length && c.locator.shadowPath.length === 2));
  assert.ok(!s.controls.some(c => c.locator.shadowPath.some(a => a.includes('closed-shadow'))));
  assert.match(report.limitations.join(' '), /闭合 Shadow/);
  const shared = draft.fields.filter(f => f.locator.selector === address('shared-field').selector);
  assert.equal(shared.length, fields.length);
  assert.equal(new Set(shared.map(f => f.sourceId)).size, fields.length);
});

test('Frame 和 Shadow 内指定入口只打开目标，正式模型映射保留完整地址', async () => {
  const shadow = snapshot('shadow-dialog:1');
  assert.deepEqual(shadow.associations[0].dialog.shadowPath, [address('open-shadow').selector]);
  assert.equal(shadow.controls.filter(c => c.locator.selector === address('shadow-note').selector).length, 1);
  const framed = snapshot('frame-dialog:1');
  assert.equal(framed.associations[0].context.framePath.length, 1);
  assert.ok(framed.controls.some(c => c.locator.selector === address('frame-note').selector));
  const mixed = control('frame-shadow:1', 'shadow-note');
  assert.equal(mixed.context.framePath.length, 1);
  assert.deepEqual(mixed.locator.shadowPath, [address('frame-shadow').selector]);
  const source = draft.fields.find(f => f.locator.selector === mixed.locator.selector && f.locator.shadowPath[0] === address('frame-shadow').selector);
  const review = createReviewTemplate(draft);
  review.confirmed = { scope: true, domains: true, businessRules: true };
  review.modelId = 'frame-shadow-model';
  review.fields = [{ sourceId: source.sourceId, include: true, id: 'remark', values: ['测试值'] }];
  const { mapping } = await compileReviewedModel(report, review);
  assert.equal(mapping.schemaVersion, 3);
  assert.deepEqual(mapping.fields[0].context, source.context);
  assert.deepEqual(mapping.fields[0].locator, source.locator);
});

test('显示文本与业务值分别采集，隐藏旧值不混入，单元格不自动成为因子', () => {
  const cells = snapshot('teleport:0').cells;
  const weight = cells.find(c => c.locator.selector === address('weight-cell').selector);
  assert.equal(weight.displayText, '12.30 kg'); assert.equal(weight.businessValue, 12.3);
  assert.equal(weight.valueKnown, true); assert.equal(weight.valueSource, 'explicit-dom-json');
  assert.equal(weight.rowKey, 'weight-1'); assert.equal(weight.columnKey, 'weight'); assert.equal(weight.columnLabel, '重量'); assert.equal(weight.columnIndex, 2);
  assert.equal(weight.displayTruncated, false);
  assert.ok(!JSON.stringify(cells).includes('999'));
  const name = cells.find(c => c.columnKey === 'name');
  assert.equal(name.displayText, '目标重量'); assert.equal(name.valueKnown, false); assert.equal(name.businessValue, null);
  const temperature = cells.find(c => c.locator.selector === address('temperature-cell').selector);
  assert.equal(temperature.displayText, '20.0 °C'); assert.equal(temperature.businessValue, 20); assert.equal(temperature.rowIndex, 2);
  assert.ok(cells.some(c => c.context.framePath.length === 2 && c.displayText === '2.50 kg'));
  assert.ok(!draft.fields.some(f => f.locator.selector === weight.locator.selector));
  const md = renderDiscoveryReport(report, draft);
  for (const text of ['12.30 kg', '选项完整性', 'Frame', '分页选项', '变量配置']) assert.ok(md.includes(text), text);
});

test('记录的根内定位可以重新访问全部字段、弹框和单元格，拒绝序号兜底', async () => {
  const current = await discoverPage(page, oneScene('teleport'));
  const s = current.snapshots.at(-1);
  const sources = [...s.controls, ...s.cells, ...s.dialogs];
  for (const item of sources) {
    const frame = await enterFrames(page.mainFrame(), item.context.framePath, 5000);
    const el = await findElement(frame, item.locator);
    assert.ok(el, JSON.stringify(item.locator));
    try {
      assert.equal(await el.isVisible(), true);
      if (item.locator.selector === address('shared-field').selector) assert.equal(await el.inputValue(), item.currentValue);
      if ('displayText' in item) assert.equal((await el.innerText()).replace(/\s+/g, ' ').trim(), item.displayText);
    } finally { await el.dispose(); }
  }
});

test('错误关联、歧义定位和非弹框目标不能冒充已发现', async () => {
  const base = plan.scenes[0].steps[0];
  const already = await discoverPage(page, oneScene('teleport', { steps: [{ ...base, expected: address('unrelated-dialog') }] }));
  assert.equal(already.scenes[0].status, 'blocked'); assert.match(already.scenes[0].reason, /已可见/);
  assert.equal(await page.getByTestId('evidence-dialog').count(), 0);
  const ambiguous = await discoverPage(page, oneScene('teleport', { steps: [base, { ...base, target: address('open-inner-evidence'), expected: { selector: '[role=dialog]' } }] }));
  assert.equal(ambiguous.scenes[0].status, 'failed'); assert.match(ambiguous.scenes[0].reason, /不唯一/);
  assert.equal(ambiguous.snapshots.at(-1).associations.length, 1);
  const invalid = await discoverPage(page, oneScene('teleport', { steps: [{ ...base, expected: address('outer-name') }] }));
  assert.equal(invalid.scenes[0].status, 'blocked'); assert.match(invalid.scenes[0].reason, /弹框根/);
  assert.equal(invalid.snapshots.length, 1);
});

test('Frame、Shadow、单元格与选项预算不足均显式标记，旧版计划和报告被拒绝', async () => {
  const limited = await discoverPage(page, oneScene('teleport', { steps: [] }, { maxFrames: 1, maxShadowDepth: 1, maxCells: 1 }));
  assert.equal(limited.status, 'partial'); assert.equal(limited.snapshots[0].truncated, true);
  assert.ok(limited.snapshots[0].documents.some(d => d.status === 'limited'));
  assert.match(limited.snapshots[0].warnings.join(' '), /Shadow 深度/);
  const deep = await discoverPage(page, oneScene('teleport', { scope: { ...address('shared-field'), shadowPath: [address('open-shadow').selector, address('nested-shadow').selector] }, steps: [] }, { maxShadowDepth: 1 }));
  assert.equal(deep.status, 'partial'); assert.equal(deep.scenes[0].status, 'blocked'); assert.match(deep.scenes[0].reason, /Shadow 路径超过深度预算/);
  const options = await discoverPage(page, oneScene('complete', {}, { maxOptions: 1 }));
  assert.equal(options.status, 'partial');
  const c = options.snapshots.at(-1).controls.find(c => c.kind === 'combobox');
  assert.equal(c.optionCoverage.status, 'partial'); assert.equal(c.optionCoverage.observedCount, 1); assert.equal(c.optionCoverage.totalCount, 5);
  const unavailable = await discoverPage(page, oneScene('frame-dialog', { scope: { selector: '#missing-frame-scope' }, steps: [] }));
  assert.equal(unavailable.status, 'partial');
  assert.equal(unavailable.snapshots[0].documents[0].status, 'unavailable');
  assert.match(unavailable.snapshots[0].documents[0].reason, /扫描区域不存在/);
  assert.throws(() => parseDiscoveryPlan({ ...plan, schemaVersion: 1 }), /schemaVersion=3/);
  await assert.rejects(createDiscoveryDraft({ ...report, schemaVersion: 1 }), /格式|指纹/);
});

test('补充 DOM 边界：ARIA 矛盾、原生加载中、隐藏 Shadow 宿主及显示截断', async () => {
  const fixture = await context.newPage();
  try {
    await fixture.setContent(`<div id="fixture"><select aria-busy="true"><option value="a">A</option></select>
      <button type="button" role="combobox" aria-controls="list">选择</button><div id="list" role="listbox"><div role="option" aria-setsize="2" aria-posinset="1">A</div><div role="option" aria-setsize="3" aria-posinset="2">B</div></div>
      <div id="hidden" hidden></div><table><tr><td data-discovery-value="NaN">123456</td></tr></table></div>`);
    await fixture.evaluate(() => document.querySelector('#hidden').attachShadow({ mode: 'open' }).innerHTML = '<input value="hidden-shadow-value">');
    const result = await fixture.evaluate(scanDocument, { ...settings, scopes: [{ selector: '#fixture' }] });
    assert.equal(result.controls.find(c => c.kind === 'select').optionCoverage.status, 'partial');
    assert.equal(result.controls.find(c => c.kind === 'combobox').optionCoverage.status, 'unknown');
    assert.ok(!JSON.stringify(result).includes('hidden-shadow-value'));
    const short = await fixture.evaluate(scanDocument, { ...settings, scopes: [{ selector: '#fixture' }], maxTextLength: 3 });
    assert.equal(short.cells[0].displayText, '123'); assert.equal(short.cells[0].displayTruncated, true); assert.equal(short.cells[0].valueKnown, false);
    await assert.rejects(fixture.evaluate(scanDocument, { ...settings, scopes: [{ selector: '#hidden' }] }), /不可见/);
  } finally { await fixture.close(); }
});

test('往返发现验证页保留原配置草稿，并清理验证页弹框', async () => {
  await page.goto(new URL('#/inputs', origin).href);
  await page.getByTestId('free-text').fill('往返验证页的未保存草稿');
  await page.getByTestId('nav-discovery').click();
  await page.getByTestId('open-evidence-dialog').click();
  await page.getByTestId('evidence-dialog').waitFor();
  await page.getByTestId('nav-inputs').click();
  await page.getByTestId('free-text').waitFor();
  assert.equal(await page.getByTestId('free-text').inputValue(), '往返验证页的未保存草稿');
  assert.equal(await page.getByTestId('evidence-dialog').count(), 0);
  assert.equal(await page.getByTestId('unrelated-dialog').count(), 0);
  assert.deepEqual(await context.storageState(), storageBefore);
});
