import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiElementModel, findUiRelations, fingerprintReport, compileReviewedModel, createDiscoveryDraft, createReviewTemplate, renderUiElementModel } from '../dist/discovery/index.js';

const url = 'http://mes.invalid/#/legal';
const context = { url, framePath: [] };
const locator = (id, shadowPath = []) => ({ selector: `[data-testid="${id}"]`, shadowPath, basis: 'test-id', unique: true });
const field = (id, extra = {}) => ({ key: id, context, locator: locator(id), category: 'field', kind: 'text', label: id,
  currentValue: '', valueKnown: true, disabled: false, readOnly: false, required: false, multiple: false,
  attributes: {}, options: [], optionCoverage: null, notes: [], dialog: null, containers: [], popups: [], ...extra });
const snapshot = (id, controls = [], extra = {}) => ({ id, sceneId: 'legal', afterStep: Number(id.split(':').at(-1)) || 0, url, controls, cells: [], dialogs: [],
  documents: [{ context, status: 'scanned' }], associations: [], warnings: [], truncated: false, unresolvedControls: 0, regions: [], ...extra });
async function report(snapshots, extra = {}) {
  const value = { schemaVersion: 3, artifactType: 'page-discovery', reportId: '', plan: { schemaVersion: 3, id: 'test', scenes: [{ id: 'legal', url, ready: { selector: 'body' }, steps: [] }] },
    startedAt: '', finishedAt: '', status: 'completed', scope: 'specified-scenes-and-openers', snapshots, scenes: [], limitations: [], ...extra };
  value.reportId = await fingerprintReport(value); return value;
}
const fields = model => model.elements.filter(n => n.kinds.includes('field'));

test('字段身份保留完整 URL、Frame 和 Shadow；状态合并但不覆盖，配置字段可追溯', async () => {
  const contexts = [context, { ...context, framePath: [{ selector: '#frame-a' }] }, { ...context, framePath: [{ selector: '#frame-b' }] }];
  const controls = contexts.map(c => field('same', { context: c }));
  controls.push(field('same', { key: 'shadow-same', locator: locator('same', ['#shadow-a']) }));
  const a = snapshot('legal:0', controls);
  const b = snapshot('legal:1', controls.map(c => ({ ...c, currentValue: 'changed', disabled: true })));
  const c = snapshot('other:0', [field('same', { context: { url: url + '?id=B', framePath: [] } })], { url: url + '?id=B' });
  const model = await createUiElementModel(await report([a, b, c]));
  assert.equal(fields(model).length, 5);
  const shared = fields(model).filter(n => n.observations.length === 2);
  assert.equal(shared.length, 4);
  for (const n of shared) {
    assert.deepEqual(n.observations.map(o => o.state.currentValue), ['', 'changed']);
    assert.deepEqual(n.observations.map(o => o.state.disabled), [false, true]);
  }
  assert.equal(model.configurationFields.length, 5);
  assert.ok(model.configurationFields.every(f => model.elements.some(e => e.id === f.elementId)));
  const again = await createUiElementModel(await report([b, a, c]));
  assert.deepEqual(model.elements.map(n => n.id), again.elements.map(n => n.id));
});

test('未定位元素仅限当前快照，不按重复 key 或文案跨状态合并', async () => {
  const unresolved = { selector: '', shadowPath: [], basis: 'unresolved', unique: false };
  const model = await createUiElementModel(await report([
    snapshot('legal:0', [field('unknown-1', { locator: unresolved }), field('unknown-2', { locator: unresolved })]),
    snapshot('legal:1', [field('unknown-1', { locator: unresolved })]),
  ]));
  assert.equal(fields(model).length, 3);
  assert.ok(fields(model).every(n => !n.locatable && n.observations.length === 1 && n.identityBasis === 'snapshot-only'));
  assert.equal(model.status, 'partial'); assert.equal(model.configurationFields.length, 0);
});

test('选项值 0 与字符串 0 不混同；未知和重复值不强行合并', async () => {
  const options = [0, '0', false, null].map(value => ({ label: String(value), value, valueKnown: true, selected: false, disabled: false }));
  options.push({ label: '未知', value: null, valueKnown: false, selected: false, disabled: false });
  options.push({ label: '重复零', value: 0, valueKnown: true, selected: false, disabled: false });
  const model = await createUiElementModel(await report([snapshot('legal:0', [field('choice', { options })]), snapshot('legal:1', [field('choice', { options })])]));
  const choice = fields(model)[0];
  const edges = findUiRelations(model, choice.id, { kind: 'has-option', direction: 'outgoing' });
  assert.equal(edges.length, 9); // 唯一已知值 3 个，另外 3 个观察选项各两次。
  assert.equal(findUiRelations(model, choice.id, { kind: 'has-option', snapshotId: 'legal:0' }).length, 6);
  assert.ok(model.elements.filter(n => n.identityBasis === 'option-value').every(n => n.observations.length === 2));
});

test('包含关系以真实容器链为依据，不解析 test-id 连字符或使用行号', async () => {
  const table = { key: 't', kind: 'table', label: '法人', locator: locator('legal-table') };
  const rowA = { key: 'a', kind: 'row', label: 'A', locator: locator('legal-table-row-COR-A-001') };
  const rowB = { key: 'b', kind: 'row', label: 'B', locator: locator('legal-table-row-COR-B-001') };
  const action = row => field(`detail-${row.key}`, { category: 'action', kind: 'button', label: '详情', locator: { ...locator('detail'), selector: `${row.locator.selector} [data-testid="detail"]` }, containers: [table, row], valueKnown: false });
  const model = await createUiElementModel(await report([snapshot('legal:0', [action(rowA), action(rowB)]), snapshot('legal:1', [action(rowB), action(rowA)])]));
  const rows = model.elements.filter(n => n.kinds.includes('row'));
  assert.equal(rows.length, 2);
  for (const row of rows) {
    const links = findUiRelations(model, row.id, { direction: 'outgoing', kind: 'contains' });
    assert.equal(links.length, 1); assert.equal(links[0].evidence.length, 2);
    assert.equal(findUiRelations(model, row.id, { direction: 'incoming', kind: 'contains' }).length, 1);
  }
  assert.ok(!model.relations.some(r => r.kind === 'opens'));
});

test('已验证展开连接实际组件触发器，失败步骤和危险按钮不生成打开关系', async () => {
  const action = field('widget', { category: 'action', kind: 'button', targets: [locator('trigger')] });
  const dialog = { label: '编辑', context, locator: locator('editor'), containers: [] };
  const base = await report([snapshot('legal:0', [action, field('save', { category: 'action', kind: 'button' })]), snapshot('legal:1', [action], { dialogs: [dialog] })]);
  base.plan.scenes[0].steps = [{ kind: 'open-dialog', target: { selector: '[data-testid=trigger]' }, expected: locator('editor') },
    { kind: 'open-dialog', target: locator('save'), expected: locator('unknown') }];
  base.reportId = await fingerprintReport(base);
  const model = await createUiElementModel(base), edges = model.relations.filter(e => e.kind === 'opens');
  assert.equal(edges.length, 1); assert.equal(edges[0].evidence[0].snapshotId, 'legal:1');
  assert.equal(model.elements.find(n => n.id === edges[0].to).locator.selector, locator('editor').selector);
  assert.match(renderUiElementModel(model), /已观察打开/);
});

test('缺失目标与旧结构证据明确部分覆盖，不根据名称伪造关系；不会放宽配置确认', async () => {
  const c = field('add'); delete c.containers;
  const value = await report([snapshot('legal:0', [c]), snapshot('legal:1', [c])]);
  value.plan.scenes[0].steps = [{ kind: 'open-dialog', target: locator('add'), expected: locator('missing') }];
  value.reportId = await fingerprintReport(value);
  const model = await createUiElementModel(value);
  assert.equal(model.status, 'partial'); assert.equal(model.businessRules, 'not-inferred');
  assert.ok(model.limitations.some(l => l.includes('缺少容器链')));
  assert.ok(model.limitations.some(l => l.includes('缺少可匹配')));
  assert.equal(model.relations.filter(e => e.kind === 'opens').length, 0);
  await assert.rejects(compileReviewedModel(value, createReviewTemplate(await createDiscoveryDraft(value))), /必须先确认/);
});

test('拒绝篡改指纹、重复快照与不存在的查询元素', async () => {
  const value = await report([snapshot('legal:0', [field('code')])]);
  const model = await createUiElementModel(value);
  assert.throws(() => findUiRelations(model, 'missing'), /未知 UI 元素/);
  value.snapshots[0].controls[0].currentValue = 'tampered';
  await assert.rejects(createUiElementModel(value), /指纹/);
  value.snapshots.push(structuredClone(value.snapshots[0])); value.reportId = await fingerprintReport(value);
  await assert.rejects(createUiElementModel(value), /快照标识重复/);
});
