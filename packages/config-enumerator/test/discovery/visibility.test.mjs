import test, { before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { scanDocument, findElement, waitElement, enterFrames, discoverPage } from '../../dist/discovery/index.js';

const settings = { scopes: [{ selector: 'body' }], framePath: [], maxCells: 30, maxShadowDepth: 8, maxControls: 50, maxOptions: 20, maxTextLength: 300 };
const address = { selector: '#target' };
let browser, context, page;
before(async () => { browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'chrome', headless: true }); });
after(async () => { await browser?.close(); });
beforeEach(async () => { context = await browser.newContext(); page = await context.newPage(); });
afterEach(async () => { await context.close(); });

async function found(frame, target = address) {
  const element = await findElement(frame, target);
  try { return element ? await element.getAttribute('data-case') : null; }
  finally { await element?.dispose(); }
}

test('CSS/ID 定位排除自身及多层祖先隐藏；disabled 可见字段仍保留', async () => {
  const hidden = ['hidden', 'aria-hidden="true"', 'inert', 'style="display:none"', 'style="visibility:hidden"', 'style="visibility:collapse"', 'style="opacity:0"', 'style="content-visibility:hidden"'];
  for (const flag of hidden) for (const parent of [false, true]) {
    await page.setContent(`<div ${parent ? flag : ''}><section><input id="target" data-case="target" ${parent ? '' : flag}></section></div><input id="disabled" disabled>`);
    assert.equal(await found(page.mainFrame()), null, `${parent ? '祖先' : '自身'} ${flag}`);
    const observation = await page.evaluate(scanDocument, settings);
    assert.equal(observation.controls.length, 1, flag);
    assert.equal(observation.controls[0].disabled, true);
  }
  // 子元素覆盖 visibility，也不能绕过已隐藏的父区域。
  await page.setContent('<section style="visibility:hidden"><input id="target" style="visibility:visible"></section>');
  assert.equal(await found(page.mainFrame()), null);
});

test('隐藏 CSS 同名副本不参与唯一性判断，第二个可见副本仍报歧义', async () => {
  await page.setContent('<div hidden><input id="target" data-case="old"></div><input id="target" data-case="live">');
  assert.equal(await found(page.mainFrame()), 'live');
  const observation = await page.evaluate(scanDocument, settings);
  assert.equal(observation.controls.length, 1);
  assert.equal(observation.controls[0].locator.unique, true);
  assert.equal(await found(page.mainFrame(), observation.controls[0].locator), 'live');
  await page.locator('div').evaluate(el => el.hidden = false);
  await assert.rejects(findElement(page.mainFrame(), address), /不唯一/);
});

test('已发现目标随后隐藏不能复用；等待恢复可见，不提前成功或绕过隐藏父元素', async () => {
  await page.setContent('<section><input id="target" data-case="target"></section>');
  const observation = await page.evaluate(scanDocument, settings);
  const target = observation.controls[0].locator;
  await page.locator('section').evaluate(el => el.hidden = true);
  assert.equal(await found(page.mainFrame(), target), null);
  await assert.rejects(waitElement(page.mainFrame(), target, 100), /Timeout/);
  let ready = false;
  const pending = waitElement(page.mainFrame(), target, 3000).then(el => { ready = true; return el; });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(ready, false);
  await page.locator('section').evaluate(el => el.hidden = false);
  const el = await pending;
  try { assert.equal(await el.getAttribute('data-case'), 'target'); } finally { await el.dispose(); }
});

test('隐藏的兄弟/子锚点不能辅助定位可见目标', async () => {
  await page.setContent('<section><span hidden aria-label="隐藏锚点">标记</span><input id="target"></section>');
  const target = { selector: 'anchor=' + JSON.stringify([{ axis: 'descendant', selector: 'span', name: '隐藏锚点' }, { axis: 'sibling', selector: 'input' }]) };
  assert.equal(await found(page.mainFrame(), target), null);
});

test('开放 Shadow 宿主祖先及 slot 隐藏时，内部元素不能被定位或扫描', async () => {
  await page.setContent('<section><div id="host"></div></section><p>可见背景</p>');
  await page.locator('#host').evaluate(el => el.attachShadow({ mode: 'open' }).innerHTML = '<input id="target" data-case="shadow">');
  const target = { selector: '#target', shadowPath: ['#host'] };
  assert.equal(await found(page.mainFrame(), target), 'shadow');
  await page.locator('section').evaluate(el => el.style.opacity = '0');
  assert.equal(await found(page.mainFrame(), target), null);
  assert.equal((await page.evaluate(scanDocument, settings)).controls.length, 0);
  await page.locator('section').evaluate(el => el.style.opacity = '1');
  assert.equal(await found(page.mainFrame(), target), 'shadow');
  await page.locator('#host').evaluate(el => {
    el.shadowRoot.innerHTML = '<slot style="opacity:0"></slot>';
    el.innerHTML = '<input id="target" data-case="slotted">';
  });
  assert.equal(await found(page.mainFrame()), null);
  assert.equal((await page.evaluate(scanDocument, settings)).controls.length, 0);
});

test('已取得的跨源 Frame 在外层入口隐藏后也不能定位或提前等待成功', async () => {
  await page.route('http://outer.invalid/**', route => route.fulfill({ contentType: 'text/html', body: '<section><iframe id="outer" src="http://inner.invalid/frame"></iframe></section><p>背景</p>' }));
  await page.route('http://inner.invalid/**', route => route.fulfill({ contentType: 'text/html', body: '<iframe id="inner" src="http://leaf.invalid/frame"></iframe>' }));
  await page.route('http://leaf.invalid/**', route => route.fulfill({ contentType: 'text/html', body: '<input id="target" data-case="framed">' }));
  await page.goto('http://outer.invalid/');
  const frame = await enterFrames(page.mainFrame(), [{ selector: '#outer' }, { selector: '#inner' }], 3000);
  assert.equal(await found(frame), 'framed');
  await page.locator('section').evaluate(el => el.style.opacity = '0');
  assert.equal(await found(frame), null);
  await assert.rejects(waitElement(frame, address, 100), /Timeout/);
  await page.locator('section').evaluate(el => el.style.opacity = '1');
  const el = await waitElement(frame, address, 3000);
  try { assert.equal(await el.getAttribute('data-case'), 'framed'); } finally { await el.dispose(); }
});

test('隐藏的弹框可等待展开，范围隐藏后仍扫描本次关联的 Teleport 弹框', async () => {
  const html = '<main id="editor"><button id="open" onclick="document.querySelector(\'#dialog\').hidden=false;document.querySelector(\'#editor\').hidden=true">打开</button></main><section role="dialog" aria-label="配置" id="dialog" hidden><input id="target"></section>';
  await page.route('http://fixture.invalid/**', route => route.fulfill({ contentType: 'text/html', body: html }));
  const report = await discoverPage(page, { schemaVersion: 3, id: 'hidden-dialog', scenes: [{ id: 'open', url: 'http://fixture.invalid/', ready: { selector: '#open' }, scope: { selector: '#editor' }, steps: [{ kind: 'open-dialog', target: { selector: '#open' }, expected: { selector: '#dialog' } }] }] });
  assert.equal(report.status, 'completed');
  assert.deepEqual(report.snapshots[1].controls.map(c => c.kind), ['text']);
  assert.equal(report.snapshots[1].associations.length, 1);
});
