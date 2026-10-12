import { test, expect } from '../fixtures';
import { metadata } from '../pages/lab';
import { DiscoveryLab, byId, locations, scanSettings } from '../pages/discovery';
import * as models from '../models/discovery';
import { selectCandidates } from '../smoke/selection.mjs';
import { discoverPage, scanDocument, createDiscoveryDraft, createReviewTemplate, compileReviewedModel, type DiscoveryScene } from '@mes-ui/config-enumerator/discovery';
import { createEnumeration, type ConfigurationCase } from '@mes-ui/config-enumerator';

function cases(candidates: ConfigurationCase[], run: (lab: DiscoveryLab, values: any) => Promise<void>) {
  for (const c of selectCandidates(candidates)) test(`discovery ${c.id} ${c.classification}`, metadata('discovery', 'category', c), async ({ page }) => {
    const lab = new DiscoveryLab(page);
    await lab.goto();
    await test.step(`执行候选配置 ${JSON.stringify(c.values)}`, () => run(lab, c.values));
    await lab.noSave();
  });
}
function behavior(id: string, run: (lab: DiscoveryLab) => Promise<void>) {
  test(`discovery behavior.discovery.${id}`, metadata('discovery', 'category', { id: `behavior.discovery.${id}`, classification: 'behavior' }), async ({ page }) => {
    const lab = new DiscoveryLab(page);
    await lab.goto();
    await test.step(`执行操作场景 ${id}`, () => run(lab));
    await lab.noSave();
  });
}
const scan = (l: DiscoveryLab) => l.page.evaluate(scanDocument, scanSettings);

cases(models.inputs, async (l, v) => {
  await test.step('填写原生输入；合法单位实际选择，非法单位核验原生禁用契约', async () => {
    await l.fill('main', 'shared-field', v.raw);
    expect(await l.value('main')).toBe(v.raw);
    const unit = l.page.getByTestId('native-options');
    if (v.unit === 't') {
      // 原生菜单由系统渲染；不能用可能绕过 option.disabled 的 selectOption 验证拒绝。
      const disabledOption = unit.locator('option[value=t]');
      await expect(disabledOption).toHaveJSProperty('disabled', true);
      await expect(disabledOption).toHaveJSProperty('selected', false);
      await expect(unit).toHaveValue('kg');
    } else { await unit.selectOption(v.unit); await expect(unit).toHaveValue(v.unit); }
  });
  await l.reload();
  expect(await l.value('main')).toBe('主文档值');
  await expect(l.page.getByTestId('native-options')).toHaveValue('kg');
});

cases(models.teleport, async (l, v) => {
  const p = l.page, outer = p.getByTestId('evidence-dialog'), inner = p.getByTestId('inner-evidence-dialog');
  await l.click('main', 'open-evidence-dialog');
  await expect(outer).toBeVisible();
  await expect(p.getByTestId('discovery-editor')).toHaveAttribute('inert', '');
  await l.fill('main', 'outer-name', v.outerText);
  await l.click('main', 'open-inner-evidence');
  await l.fill('main', 'inner-search', v.innerText);
  await expect(outer.getByTestId('outer-name')).toHaveValue(v.outerText);
  await expect(inner.getByTestId('inner-search')).toHaveValue(v.innerText);
  await expect(p.getByTestId('unrelated-field')).toHaveValue('不属于编辑器');
  if (v.exit === 'inner-cancel') {
    await inner.getByRole('button', { name: '取消', exact: true }).click();
    await expect(inner).toBeHidden(); await expect(outer).toBeVisible();
    await expect(outer.getByTestId('outer-name')).toHaveValue(v.outerText);
    await l.click('main', 'open-inner-evidence');
    await expect(inner.getByTestId('inner-search')).toHaveValue('');
  }
  await outer.getByRole('button', { name: '取消', exact: true }).click();
  await expect(outer).toBeHidden(); await expect(inner).toBeHidden();
  await expect(p.getByTestId('discovery-editor')).not.toHaveAttribute('inert', '');
  await l.click('main', 'open-evidence-dialog');
  await expect(outer.getByTestId('outer-name')).toHaveValue('称重配置');
  await l.reload();
  await expect(outer).toBeHidden(); await expect(p.getByTestId('unrelated-dialog')).toBeVisible();
});

async function editBoundary(l: DiscoveryLab, v: any, kind: 'frame' | 'shadow') {
  await test.step(`进入 ${v.context}，填写字段并打开该边界内弹框`, async () => {
    await l.fill(v.context, 'shared-field', v.raw);
    await l.click(v.context, `${kind}-open`);
    await l.fill(v.context, `${kind}-note`, v.remark);
    expect(await l.value(v.context, `${kind}-note`)).toBe(v.remark);
    await l.assertIsolation(v.context, v.raw);
  });
  await test.step('刷新后各文档字段恢复默认、没有保存记录', async () => {
    await l.reload(); await l.assertIsolation();
    await l.click(v.context, `${kind}-open`);
    expect(await l.value(v.context, `${kind}-note`)).toBe(kind === 'frame' ? 'Frame 弹框已关联' : '开放根内备注');
  });
}
cases(models.shadow, (l, v) => editBoundary(l, v, 'shadow'));
cases(models.frames, (l, v) => editBoundary(l, v, 'frame'));

cases(models.lists, async (l, v) => {
  const p = l.page;
  if (v.list === 'remote') await expect(p.getByTestId('remote-ready')).toBeVisible();
  await p.getByTestId(`${v.list}-opener`).click();
  const list = p.getByTestId(`${v.list}-list`), canAdvance = ['paged', 'virtual'].includes(v.list);
  if (canAdvance) for (let i = 0; i < v.advance; i++) await list.getByRole('button', { name: v.list === 'paged' ? '下一页' : '滚动到下一段', exact: true }).click();
  else if (v.advance > 0) await expect(list.getByRole('button')).toHaveCount(0);
  const indices = v.list === 'paged' ? [[1, 2], [3, 4], [5]][v.advance] : v.list === 'virtual' ? [1, 2, 3].map(n => n + v.advance * 3) : v.list === 'unknown' ? [1, 2] : [1, 2, 3, 4, 5];
  const labels = v.list === 'remote' ? ['目标重量', '实际重量', '批次温度', '环境湿度', '搅拌速度']
    : indices.map((n: number) => `${v.list === 'virtual' ? '虚拟变量' : '变量'} ${n}`);
  await expect(list.getByRole('option')).toHaveText(labels);
  const actual = await scan(l);
  const options = actual.controls.find(c => c.locator.selector === byId(`${v.list}-opener`).selector)!;
  expect(options.options.map(o => o.label)).toEqual(labels);
  expect(options.optionCoverage).toMatchObject({ status: canAdvance ? 'partial' : v.list === 'unknown' ? 'unknown' : 'complete', observedCount: labels.length, totalCount: v.list === 'unknown' ? null : v.list === 'virtual' ? 100 : 5 });
  await l.reload();
  await expect(p.getByTestId(`${v.list}-list`)).toHaveCount(0);
});

function scene(l: DiscoveryLab, entry: string): DiscoveryScene {
  const common = { id: entry, url: l.page.url(), ready: byId('discovery-ready'), scope: byId('discovery-editor') };
  if (entry === 'frame') return { ...common, framePath: [byId('frame-one')], ready: byId('frame-ready'), scope: byId('frame-ready'), steps: [{ kind: 'open-dialog', target: byId('frame-open'), expected: byId('frame-dialog') }] };
  if (entry === 'shadow') return { ...common, steps: [{ kind: 'open-dialog', target: { ...byId('shadow-open'), shadowPath: [byId('open-shadow').selector] }, expected: { ...byId('shadow-dialog'), shadowPath: [byId('open-shadow').selector] } }] };
  return { ...common, steps: [{ kind: 'open-dialog', target: byId('open-evidence-dialog'), expected: byId('evidence-dialog') }, { kind: 'open-dialog', target: byId('open-inner-evidence'), expected: byId('inner-evidence-dialog') }] };
}
cases(models.observation, async (l, v) => {
  const limits = ({ normal: {}, options: { maxOptions: 1 }, shadow: { maxShadowDepth: 1 }, frames: { maxFrames: 1 }, cells: { maxCells: 1 } } as Record<string, object>)[v.budget];
  const report = await discoverPage(l.page, { schemaVersion: 2, id: 'execution-observation', scenes: [scene(l, v.entry)], limits });
  await test.info().attach('发现证据', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  const expected = v.budget === 'normal' || v.entry === 'frame' && v.budget === 'options' ? 'completed' : 'partial';
  expect(report.status, '预算截断必须与计划执行状态区分').toBe(expected);
  expect(report.scenes[0]!.status).toBe('completed');
  const last = report.snapshots.at(-1)!;
  expect(last.associations).toHaveLength(v.entry === 'teleport' ? 2 : 1);
  if (v.entry === 'teleport') expect(last.associations[1]!.parentDialog).toEqual(byId('evidence-dialog'));
  expect(report.snapshots.flatMap(s => s.controls).some(c => c.locator.selector.includes('unrelated-field'))).toBe(false);
  if (expected === 'partial') expect(report.snapshots.some(s => s.truncated || s.documents.some(d => d.status !== 'scanned'))).toBe(true);
});

behavior('display-evidence', async l => {
  await expect(l.page.getByTestId('weight-cell')).toHaveText(/12\.30 kg/);
  expect(await l.page.getByTestId('weight-cell').innerText()).toBe('12.30 kg');
  const actual = await scan(l);
  const weight = actual.cells.find(c => c.locator.selector === byId('weight-cell').selector)!;
  expect(weight).toMatchObject({ displayText: '12.30 kg', businessValue: 12.3, valueKnown: true, rowKey: 'weight-1', columnKey: 'weight', columnIndex: 2, columnLabel: '重量' });
  expect(actual.cells.find(c => c.columnKey === 'temperature')).toMatchObject({ displayText: '20.0 °C', businessValue: 20 });
  expect(actual.cells.find(c => c.columnKey === 'name')).toMatchObject({ valueKnown: false, displayText: '目标重量' });
  expect(JSON.stringify(actual.cells)).not.toContain('999');
  for (const context of models.frameContexts) {
    const target = await import('@mes-ui/config-enumerator/discovery').then(m => m.enterFrames(l.page.mainFrame(), locations[context]!.framePath, 5000));
    await expect(target.locator('td[data-column-key=weight]')).toHaveText('2.50 kg');
    await expect(target.locator('td[data-column-key=weight]')).toHaveAttribute('data-discovery-value', '2.5');
  }
});

behavior('remote-loading', async l => {
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  await l.page.route('**/discovery-options.json', async route => { await gate; await route.continue(); });
  try {
    await l.page.reload(); await l.page.getByTestId('remote-opener').click();
    const list = l.page.getByTestId('remote-list');
    await expect(list).toHaveAttribute('aria-busy', 'true');
    const c = (await scan(l)).controls.find(c => c.locator.selector === byId('remote-opener').selector)!;
    expect(c.optionCoverage).toMatchObject({ status: 'partial', observedCount: 0, totalCount: null });
    release();
    await expect(l.page.getByTestId('remote-ready')).toBeVisible();
    await expect(list.getByRole('option')).toHaveCount(5);
    expect((await scan(l)).controls.find(c => c.locator.selector === byId('remote-opener').selector)!.optionCoverage).toMatchObject({ status: 'complete', observedCount: 5 });
  } finally { release(); await l.page.unrouteAll({ behavior: 'wait' }); }
});
behavior('remote-error', async l => {
  await l.page.route('**/discovery-options.json', route => route.fulfill({ status: 503, body: 'controlled-unavailable' }));
  await l.page.reload(); await l.page.getByTestId('remote-opener').click();
  await expect(l.page.getByRole('alert')).toHaveText(/HTTP 503/);
  await expect(l.page.getByTestId('remote-ready')).toHaveCount(0);
  await expect(l.page.getByTestId('remote-list').getByRole('option')).toHaveCount(0);
  expect((await scan(l)).controls.find(c => c.locator.selector === byId('remote-opener').selector)!.optionCoverage!.status).not.toBe('complete');
});
behavior('list-wrap', async l => {
  const p = l.page;
  await p.getByTestId('paged-opener').click();
  const next = p.getByTestId('paged-list').getByRole('button', { name: '下一页' });
  for (let i = 0; i < 3; i++) await next.click();
  await expect(p.getByTestId('paged-list').getByRole('option')).toHaveText(['变量 1', '变量 2']);
  await next.click();
  await p.getByTestId('unknown-opener').click();
  await expect(p.getByTestId('paged-list')).toHaveCount(0);
  await p.getByTestId('paged-opener').click();
  await expect(p.getByTestId('paged-list').getByRole('option')).toHaveText(['变量 3', '变量 4']);
});
behavior('closed-shadow', async l => {
  expect(await l.page.getByTestId('closed-shadow').evaluate(el => el.shadowRoot)).toBeNull();
  expect((await scan(l)).controls.some(c => c.locator.shadowPath.some(s => s.includes('closed-shadow')))).toBe(false);
  const r = await discoverPage(l.page, { schemaVersion: 2, id: 'closed-boundary', scenes: [{ ...scene(l, 'teleport'), steps: [] }] });
  expect(r.limitations.join(' ')).toContain('闭合 Shadow');
});
behavior('wrong-dialog', async l => {
  const s = scene(l, 'teleport');
  s.steps = [{ ...s.steps[0]!, expected: byId('unrelated-dialog') }];
  const r = await discoverPage(l.page, { schemaVersion: 2, id: 'wrong-dialog', scenes: [s] });
  expect(r.status).toBe('partial'); expect(r.scenes[0]!.status).toBe('blocked');
  expect(r.scenes[0]!.reason).toContain('已可见');
  await expect(l.page.getByTestId('evidence-dialog')).toHaveCount(0);
});
behavior('navigation', async l => {
  const p = l.page;
  await p.getByTestId('nav-inputs').click(); await p.getByTestId('free-text').fill('原页面未保存草稿');
  await p.getByTestId('nav-discovery').click();
  await l.fill('main', 'shared-field', '验证页临时值');
  await l.click('main', 'open-evidence-dialog'); await l.click('main', 'open-inner-evidence');
  await p.getByTestId('nav-inputs').click();
  await expect(p.getByTestId('free-text')).toHaveValue('原页面未保存草稿');
  await expect(p.getByTestId('evidence-dialog')).toHaveCount(0); await expect(p.getByTestId('inner-evidence-dialog')).toHaveCount(0);
  await p.getByTestId('nav-discovery').click(); expect(await l.value('main')).toBe('主文档值');
});
behavior('source-mapping', async l => {
  const r = await discoverPage(l.page, { schemaVersion: 2, id: 'mapping', scenes: [{ ...scene(l, 'teleport'), steps: [] }] });
  const draft = await createDiscoveryDraft(r);
  const shared = draft.fields.filter(f => f.locator.selector === byId('shared-field').selector);
  expect(shared).toHaveLength(13); expect(new Set(shared.map(f => f.sourceId)).size).toBe(13);
  expect(draft.fields.some(f => f.locator.selector === byId('weight-cell').selector)).toBe(false);
  const review = createReviewTemplate(draft);
  review.confirmed = { scope: true, domains: true, businessRules: true };
  review.fields = shared.filter(f => !f.locator.shadowPath.length && f.context.framePath.length === 1 && f.context.framePath[0]!.selector === byId('frame-one').selector).map(f => ({ sourceId: f.sourceId, include: true, id: 'frame_a', values: ['', '配置'] }));
  const { model, mapping } = await compileReviewedModel(r, review);
  expect([...createEnumeration(model).cases]).toHaveLength(2);
  expect(mapping.fields[0]!.context.framePath).toEqual([{ ...byId('frame-one'), shadowPath: [] }]);
});
