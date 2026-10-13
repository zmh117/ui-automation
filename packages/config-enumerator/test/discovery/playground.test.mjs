import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { discoverPage, parseDiscoveryPlan, createDiscoveryDraft, createReviewTemplate, compileReviewedModel } from '../../dist/discovery/index.js';
import { scanDocument } from '../../dist/discovery/scan.js';
import { createEnumeration, parseModel } from '../../dist/index.js';

const plan = JSON.parse(readFileSync(new URL('../../examples/playground-discovery.json', import.meta.url)));
const abcd = JSON.parse(readFileSync(new URL('../../examples/abcd.json', import.meta.url)));
const origin = process.env.PLAYGROUND_URL ?? 'http://127.0.0.1:5173/';
for (const scene of plan.scenes) scene.url = new URL(new URL(scene.url).hash, origin).href;
const settings = { scopes: [{ selector: 'body' }], framePath: [], maxCells: 300, maxShadowDepth: 8, maxControls: 300, maxOptions: 100, maxTextLength: 500 };
let browser, context, page, report, draft, review, storageBefore, storageAfter;
const writeRequests = [];
const snapshot = (id) => report.snapshots.find(s => s.id === id);
const field = (id, testId) => snapshot(id).controls.find(c => c.locator.selector === `[data-testid="${testId}"]`);

before(async () => {
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'chrome', headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writeRequests.push(request.method() + ' ' + request.url()); });
  await page.goto(plan.scenes[0].url);
  await page.locator(plan.scenes[0].ready.selector).waitFor();
  storageBefore = await context.storageState();
  report = await discoverPage(page, plan);
  storageAfter = await context.storageState();
  draft = await createDiscoveryDraft(report);
  review = createReviewTemplate(draft);
  review.confirmed = { scope: true, domains: true, businessRules: true };
  review.modelId = 'discovered-checkbox-linkage';
  review.fields = ['A', 'B', 'C', 'D'].map(id => {
    const source = draft.fields.find(f => f.url.endsWith('/#/linkage') && f.locator.selector === `[data-testid="checkbox-${id.toLowerCase()}"]`);
    assert.ok(source, `实际页面须发现 ${id}`);
    return { sourceId: source.sourceId, include: true, id, values: [false, true] };
  });
  // 已由用户确认的规则明确输入，不能从某次默认禁用状态推导。
  review.rules = abcd.rules;
});
after(async () => { await browser?.close(); });

test('实际项目六页、12 入口得到 20 快照，仅禁用的内层变量入口未探索', () => {
  assert.equal(report.status, 'partial');
  assert.equal(report.snapshots.length, 20);
  assert.equal(report.scenes.filter(s => s.status === 'completed').length, 11);
  assert.deepEqual(report.scenes.filter(s => s.status !== 'completed').map(s => [s.id, s.status, s.completedSteps]), [['dialog-variable-entry', 'blocked', 1]]);
  assert.match(report.scenes.find(s => s.id === 'dialog-variable-entry').reason, /禁用/);
  for (const id of ['inputs', 'linkage', 'extended', 'table', 'all']) assert.ok(snapshot(`${id}:0`));
  assert.equal(snapshot('all:0').controls.filter(c => c.category === 'field').length, 36);
  assert.ok(report.snapshots.every(s => !s.truncated));
});

test('扫描未保存：实际 localStorage、业务取值及非读取请求均无变化', () => {
  assert.deepEqual(storageAfter, storageBefore);
  assert.deepEqual(writeRequests, []);
  for (const name of ['a', 'b', 'c', 'd']) {
    assert.equal(field('linkage:0', `checkbox-${name}`).currentValue, false);
    assert.equal(field('all:0', `checkbox-${name}`).currentValue, false);
  }
  const baseline = snapshot('extended:0').controls.filter(c => c.category === 'field');
  for (const id of ['priority-options:1', 'tag-options:1', 'workshop-options:1', 'datetime-panel:1']) {
    for (const before of baseline) {
      const after = snapshot(id).controls.find(c => c.key === before.key);
      assert.deepEqual(after?.currentValue, before.currentValue, `${id} ${before.label}`);
    }
  }
});

test('原生字段、DOM 约束、单选组和禁用输入正确观察', () => {
  // 本站按 Unicode 码点在 input 事件中限长，实际 DOM 没有 maxlength。
  assert.equal(field('inputs:0', 'limited-note').attributes.maxlength, undefined);
  assert.match(field('inputs:0', 'limited-note').attributes.placeholder, /100/);
  assert.equal(field('inputs:0', 'readonly-code').readOnly, true);
  assert.equal(field('inputs:0', 'disabled-device').disabled, true);
  assert.equal(field('linkage:0', 'manual-value').disabled, true);
  const radio = snapshot('linkage:0').controls.find(c => c.kind === 'radio-group');
  assert.deepEqual(radio.options.map(x => x.value), ['system', 'manual']);
  assert.equal(radio.currentValue, 'system');
  assert.ok(radio.options.every(x => x.valueKnown));
});

test('真实 Element Plus 下拉采集选项，标签不冒充业务值，多选语义按 DOM 证据观察', () => {
  const priority = field('priority-options:1', 'priority-select');
  assert.deepEqual(priority.options.map(o => o.label), ['常规处理', '优先处理', '紧急处理']);
  assert.equal(priority.valueKnown, false);
  assert.equal(priority.multiple, false);
  assert.ok(priority.options.every(o => o.value === null && !o.valueKnown));
  const tags = field('tag-options:1', 'feature-tags');
  assert.deepEqual(tags.options.map(o => o.label), ['称重', '复核', '记录', '签名']);
  assert.equal(tags.multiple, true);
  assert.equal(field('extended:0', 'feature-tags').multiple, null);
  const candidate = draft.fields.find(f => f.url.endsWith('/#/extended') && f.locator.selector.includes('feature-tags'));
  assert.deepEqual(candidate.suggestedValues, []);
  assert.ok(candidate.needsReview.some(x => x.includes('多选')));
  const cascader = snapshot('workshop-options:1').controls.find(c => c.kind === 'cascader');
  assert.deepEqual(cascader.options.map(o => o.label), ['一号车间', '二号车间']);
});

test('日期时间、区间、滑块、文件识别；滑块与数字输入合并为一个因子', () => {
  const controls = snapshot('extended:0').controls.filter(c => c.category === 'field');
  for (const kind of ['datetime', 'time', 'date-range', 'color', 'slider', 'file']) assert.equal(controls.filter(c => c.kind === kind).length, 1);
  assert.equal(controls.length, 10);
  assert.equal(controls.find(c => c.kind === 'slider').currentValue, 60);
  assert.equal(controls.find(c => c.kind === 'datetime').locator.basis, 'relation');
  assert.ok(controls.find(c => c.kind === 'datetime').locator.unique);
  assert.equal(controls.find(c => c.kind === 'file').currentValue, null);
});

test('每个场景重建文档，弹框/标签路径有证据，未切换到变量模式', () => {
  for (const id of ['dialog-basic:0', 'dialog-display:0', 'dialog-variable-entry:0']) assert.deepEqual(snapshot(id).dialogs.map(d => d.label), []);
  assert.deepEqual(snapshot('dialog-basic:1').dialogs.map(d => d.label), ['控件设置']);
  assert.ok(field('dialog-display:2', 'display-precision'));
  assert.equal(snapshot('dialog-variable-entry:1').controls.find(c => c.kind === 'radio-group').currentValue, 'fixed');
  assert.ok(!report.snapshots.some(s => s.dialogs.map(d => d.label).includes('选择数值变量')));
});

test('页面来源 + 已确认规则生成完整 16/9/7；正式模型保留来源映射', async () => {
  const { model, mapping } = await compileReviewedModel(report, review);
  const run = createEnumeration(model);
  const rows = [...run.cases];
  assert.equal(rows.length, 16);
  for (const row of rows) {
    const { A, B, C, D } = row.values;
    assert.equal(row.classification === 'valid', !(A && B) && (!C || D));
  }
  assert.equal(run.getSummary().valid, '9');
  assert.equal(run.getSummary().invalid, '7');
  assert.equal(mapping.fields.length, 4);
  assert.ok(mapping.fields.every(f => f.url.endsWith('/#/linkage') && f.observedIn.includes('linkage:0')));
});

test('未确认草稿、跨报告确认、未知来源、空值域与篡改报告不能转换', async () => {
  assert.throws(() => parseModel(draft));
  await assert.rejects(compileReviewedModel(report, createReviewTemplate(draft)), /必须先确认/);
  for (const key of ['scope', 'domains', 'businessRules']) {
    const invalid = structuredClone(review); invalid.confirmed[key] = false;
    await assert.rejects(compileReviewedModel(report, invalid), /必须先确认/);
  }
  await assert.rejects(compileReviewedModel(report, { ...review, reportId: 'wrong' }), /不属于/);
  const unknown = structuredClone(review); unknown.fields[0].sourceId = 'unknown';
  await assert.rejects(compileReviewedModel(report, unknown), /来源未知/);
  const duplicate = structuredClone(review); duplicate.fields.push(duplicate.fields[0]);
  await assert.rejects(compileReviewedModel(report, duplicate), /来源未知或重复/);
  const empty = structuredClone(review); empty.fields[0].values = [];
  await assert.rejects(compileReviewedModel(report, empty), /非空数组/);
  const tampered = structuredClone(report); tampered.snapshots[0].controls[0].label += 'changed';
  await assert.rejects(compileReviewedModel(tampered, review), /指纹不匹配/);
});

test('确认 CLI 导出正式模型和映射，原有输出不覆盖', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mes-discovery-review-'));
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report));
  writeFileSync(join(dir, 'review.json'), JSON.stringify(review));
  const args = ['bin/review.mjs', '--report', join(dir, 'report.json'), '--review', join(dir, 'review.json'), '--out', join(dir, 'result')];
  const invoke = () => spawnSync(process.execPath, args, { cwd: new URL('../../', import.meta.url), encoding: 'utf8' });
  const result = invoke(); assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(join(dir, 'result/model.json'))).fields.length, 4);
  const bytes = readFileSync(join(dir, 'result/model.json'), 'utf8');
  assert.equal(invoke().status, 1);
  assert.equal(readFileSync(join(dir, 'result/model.json'), 'utf8'), bytes);
});

test('业务复选框、保存按钮均在点击前拦截，页面数据保持不变', async () => {
  for (const selector of ['[data-testid=checkbox-a]', '[data-testid=linkage-save]']) {
    const result = await discoverPage(page, { schemaVersion: 3, id: 'forbidden', scenes: [{ id: 'guard', url: plan.scenes[1].url, ready: { selector: '[data-testid=checkbox-a]' }, steps: [{ kind: 'open-dialog', target: { selector }, expected: { selector: 'body' } }] }] });
    assert.equal(result.scenes[0].status, 'blocked');
    assert.equal(result.scenes[0].completedSteps, 0);
    assert.equal(await page.locator('[data-testid=checkbox-a]').isChecked(), false);
    assert.deepEqual(await context.storageState(), storageBefore);
  }
});

test('快照预算、取消与错误定位不会冒充发现完成', async () => {
  const limited = await discoverPage(page, { ...plan, limits: { maxSnapshots: 1 } });
  assert.equal(limited.snapshots.length, 1);
  assert.equal(limited.status, 'partial');
  assert.ok(limited.scenes.slice(1).every(s => s.status === 'limited'));
  const controller = new AbortController(); controller.abort();
  const cancelled = await discoverPage(page, plan, { signal: controller.signal });
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.snapshots.length, 0);
  const broken = await discoverPage(page, { schemaVersion: 3, id: 'bad-locator', limits: { timeoutMs: 200 }, scenes: [{ ...plan.scenes[0], ready: { selector: '#does-not-exist' } }] });
  assert.equal(broken.status, 'partial'); assert.equal(broken.scenes[0].status, 'failed');
});

test('计划格式拒绝任意动作、重复场景及失效预算', () => {
  assert.throws(() => parseDiscoveryPlan({ ...plan, scenes: [plan.scenes[0], plan.scenes[0]] }), /重复/);
  for (const maxSnapshots of [0, -1, 1.5, 1001]) assert.throws(() => parseDiscoveryPlan({ ...plan, limits: { maxSnapshots } }));
  assert.throws(() => parseDiscoveryPlan({ schemaVersion: 3, id: 'x', scenes: [{ ...plan.scenes[0], steps: [{ kind: 'fill', target: { selector: 'input' }, expected: { selector: 'input' } }] }] }), /不允许/);
});

// 补充原生组件与脱敏边界；主要验收仍是上面的真实 Vue 页面。
test('原生补充：密码值脱敏、禁用选项、多选当前值、不可见字段和独立 radio 组', async () => {
  const fixture = await context.newPage();
  try {
    await fixture.setContent(`<label>密码<input id="secret" type="password" value="secret-must-not-leak"></label>
      <label>验证码<input autocomplete="one-time-code" value="654321"></label>
      <input hidden value="hidden-must-not-leak"><input data-discovery-ignore="true" value="ignored-must-not-leak">
      <label>城市<select multiple id="cities"><option value="a" selected>A</option><optgroup disabled><option value="b">B</option></optgroup></select></label>
      <form id="first"><input type="radio" name="mode" value="x" checked><input type="radio" name="mode" value="y"></form>
      <form id="second"><input type="radio" name="mode" value="z" checked></form>
      <div role="radiogroup" aria-label="ARIA 模式" id="aria-mode"><div role="radio" aria-checked="true" data-value="a">A</div><div role="radio" aria-checked="false" data-value="b">B</div></div>
      <div role="radiogroup" aria-label="包装模式" id="wrapped-mode"><label role="radio"><input type="radio" name="wrapped" value="wrapped-a" checked>A</label><label role="radio"><input type="radio" name="wrapped" value="wrapped-b">B</label></div>
      <input aria-label="限长" maxlength="100" id="limited">
      <input type="file" id="file"><iframe title="frame"></iframe>`);
    const result = await fixture.evaluate(scanDocument, settings);
    assert.ok(!JSON.stringify(result).includes('secret-must-not-leak'));
    for (const value of ['654321', 'hidden-must-not-leak', 'ignored-must-not-leak']) assert.ok(!JSON.stringify(result).includes(value));
    assert.equal(result.controls.filter(c => c.kind === 'password').length, 2);
    const select = result.controls.find(c => c.kind === 'multiselect');
    assert.deepEqual(select.currentValue, ['a']); assert.equal(select.options[1].disabled, true);
    assert.deepEqual(result.controls.filter(c => c.kind === 'radio-group').map(c => c.currentValue), ['x', 'z', 'a', 'wrapped-a']);
    assert.equal(result.controls.find(c => c.label === '限长').attributes.maxlength, '100');
    assert.equal(result.frames.length, 1);
    assert.equal((await fixture.evaluate(scanDocument, { ...settings, maxControls: 1 })).truncated, true);
    assert.equal((await fixture.evaluate(scanDocument, { ...settings, maxOptions: 1 })).truncated, true);
    assert.equal((await fixture.evaluate(scanDocument, { ...settings, maxTextLength: 2 })).truncated, true);
    await assert.rejects(fixture.evaluate(scanDocument, { ...settings, scopes: [{ selector: 'form' }] }), /扫描区域不唯一/);
  } finally { await fixture.close(); }
});
