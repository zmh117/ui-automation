import test, { before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { scanDocument, createUiElementModel, findUiRelations, discoverPage, renderUiElementModel, waitElement } from '../../dist/discovery/index.js';

const url = process.env.MES_COMPONENT_URL;
let browser, context, page;
before(async () => {
  if (!url || new URL(url).hostname !== '127.0.0.1') throw new Error('请先运行真实项目代码/test-ids/serve-fixture.cjs，并设置 MES_COMPONENT_URL 为其本地地址');
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'chrome', headless: true });
});
after(async () => { await browser?.close(); });
beforeEach(async () => { context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); page = await context.newPage(); await page.goto(url); await page.getByTestId('fixture-input').waitFor(); });
afterEach(async () => { await context?.close(); });
const address = id => ({ selector: `[data-testid="${id}"]` });
const settings = { scopes: [{ selector: 'body' }], framePath: [], maxCells: 300, maxShadowDepth: 8, maxControls: 300, maxOptions: 100, maxTextLength: 500, includeRegions: true };
const scan = () => page.evaluate(scanDocument, settings);

test('真实 Vue/md-mes-plus transfer 下拉关联自身面板，输入和触发器归于同一控件', async () => {
  for (const id of ['fixture-single', 'fixture-second', 'fixture-multi']) {
    await page.getByTestId(id + '-trigger').click();
    await page.getByTestId(id + '-panel').waitFor({ state: 'visible' });
    await (await waitElement(page.mainFrame(), address(id + '-panel'), 3000)).dispose();
    const observation = await scan();
    const control = observation.controls.find(c => c.kind === 'combobox' && (c.attributes['data-testid'] === id || c.targets.some(t => t.selector === address(id + '-trigger').selector)));
    assert.ok(control, JSON.stringify(observation.controls.map(c => [c.kind, c.attributes['data-testid']])));
    assert.equal(control.popups.length, 1, JSON.stringify(control));
    assert.equal(control.popups[0].locator.selector, address(id + '-panel').selector);
    assert.equal(control.options.length, 3, JSON.stringify(control));
    assert.ok(control.options.every(o => o.locator.selector.includes(id + '-option-')));
    await page.getByRole('heading').click();
    await page.getByTestId(id + '-panel').waitFor({ state: 'hidden' });
  }
});

test('真实 iView、MdTable、MdTableLazy 排序前后均记录正确行归属及列标题', async () => {
  const before = await scan();
  await page.getByTestId('fixture-table-sort-code-asc').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="fixture-table-body"] tr')?.getAttribute('data-testid') === 'fixture-table-row-A');
  const after = await scan();
  for (const prefix of ['fixture-table', 'fixture-source-table', 'fixture-source-lazy']) {
    const code = prefix === 'fixture-source-lazy' ? 'B' : 'A';
    const name = code === 'A' ? 'Alpha' : 'Beta';
    const pick = observation => observation.cells.find(c => c.displayText === name && c.containers.some(p => p.locator.selector === address(prefix + '-row-' + code).selector));
    assert.ok(pick(before), `缺少 ${prefix} 的 ${code} 行名称`);
    assert.ok(pick(after));
    assert.equal(pick(before).locator.selector, pick(after).locator.selector);
    assert.equal(pick(before).columnLabel, '名称');
    assert.ok(before.controls.some(c => c.category === 'action' && c.containers.some(p => p.kind === 'row' && p.locator.selector === address(prefix + '-fixed-right-row-' + code).selector)));
  }
});

test('真实组件计划贯通发现和模型，导出下拉及弹框打开关系', async () => {
  const report = await discoverPage(page, { schemaVersion: 3, id: 'mes-components', scenes: [
    { id: 'select', url, ready: address('fixture-single'), steps: [{ kind: 'open-dropdown', target: address('fixture-single-trigger'), expected: address('fixture-single-panel') }] },
    { id: 'modal', url, ready: address('show-modal'), steps: [{ kind: 'open-dialog', target: address('show-modal'), expected: address('fixture-modal') }] },
  ] });
  assert.ok(report.scenes.every(s => s.status === 'completed'), JSON.stringify(report.scenes));
  const model = await createUiElementModel(report);
  const opens = model.relations.filter(r => r.kind === 'opens');
  assert.equal(opens.length, 2, JSON.stringify(model.limitations));
  const modal = model.elements.find(n => n.locator?.selector === address('fixture-modal').selector);
  assert.ok(modal.kinds.includes('dialog'));
  assert.ok(findUiRelations(model, modal.id, { kind: 'contains', direction: 'outgoing' }).some(r => model.elements.find(n => n.id === r.to).kinds.includes('field')));
  if (process.env.UI_RELATIONS_OUT) {
    const out = process.env.UI_RELATIONS_OUT; mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
    writeFileSync(join(out, 'ui-model.json'), JSON.stringify(model, null, 2));
    writeFileSync(join(out, 'ui-model.md'), renderUiElementModel(model));
  }
});
