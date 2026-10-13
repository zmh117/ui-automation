import test, { before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { scanDocument, findElement, discoverPage, createDiscoveryDraft, compileReviewedModel, createReviewTemplate, renderDiscoveryReport } from '../../dist/discovery/index.js';
const html = readFileSync(new URL('../fixtures/onsite-controls.html', import.meta.url), 'utf8');
const settings = { scopes: [{ selector: 'body' }], framePath: [], maxCells: 300, maxShadowDepth: 8, maxControls: 300, maxOptions: 100, maxTextLength: 500 };
let browser, context, page;
before(async () => { browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'chrome', headless: true }); });
after(async () => { await browser?.close(); });
beforeEach(async () => { context = await browser.newContext(); page = await context.newPage(); await page.setContent(html); });
afterEach(async () => { await context.close(); });
const scan = () => page.evaluate(scanDocument, settings);
async function identities(observed) {
  const ids = new Map();
  for (const c of observed.controls.filter(c => c.locator.unique)) {
    const el = await findElement(page.mainFrame(), c.locator);
    assert.ok(el, c.label);
    try { const id = await el.getAttribute('data-case'); assert.ok(id, c.label + JSON.stringify(c.locator)); assert.ok(!ids.has(id), `重复定位 ${id}`); ids.set(id, c); }
    finally { await el.dispose(); }
  }
  return ids;
}

test('现场无 ID 组件以父子、兄弟和区域语义定位，壳与 input 不重复，独立子输入保留', async () => {
  const observed = await scan(), ids = await identities(observed);
  for (const id of ['filter-group','dialog-group','description','page-filter','page-dialog','search-filter','search-dialog','unnamed-filter','radio-group','custom-format','checkbox','child-anchor','sibling-input','parent-action','independent-input']) assert.ok(ids.has(id), `缺少 ${id}: ${observed.warnings}`);
  assert.equal(ids.get('filter-group').kind, 'combobox');
  assert.equal(ids.get('radio-group').kind, 'radio-group');
  assert.deepEqual(ids.get('radio-group').options.map(o => o.value), ['date', 'custom']);
  assert.equal(ids.get('checkbox').currentValue, true);
  assert.equal(observed.controls.filter(c => c.kind === 'combobox').length, 3);
  assert.equal(observed.controls.length, ids.size + observed.unresolvedControls);
  for (const c of observed.controls) assert.doesNotMatch(c.locator.selector, /nth-|xpath=|\[\d+\]|el-id-/);
  assert.equal(new Set(observed.controls.map(c => c.key)).size, observed.controls.length);
});

test('地址能重放：插入无关节点、字段重排、改 ID 和重新渲染不改变业务目标', async () => {
  const ids = await identities(await scan());
  await page.evaluate(() => {
    for (const s of document.querySelectorAll('section')) { const p = document.createElement('p'); p.textContent = '新增提示'; s.prepend(p); }
    const region = document.querySelector('[aria-label="变量筛选"]'); region.prepend(region.querySelector('button'));
    const extra = document.createElement('input'); extra.type = 'text'; extra.name = 'unrelated'; region.append(extra);
    const field = document.querySelector('[data-case="description"]').closest('.ivu-form-item'); region.append(field);
    region.innerHTML = region.innerHTML;
    document.querySelector('[data-case="dynamic-a"]').id = 'el-id-9876';
  });
  for (const [id, c] of ids) {
    const el = await findElement(page.mainFrame(), c.locator); assert.ok(el, id);
    try { assert.equal(await el.getAttribute('data-case'), id); } finally { await el.dispose(); }
  }
  const description = await findElement(page.mainFrame(), ids.get('description').locator);
  await description.fill('实际填写'); await description.dispose();
  assert.equal(await page.locator('[data-case="description"]').inputValue(), '实际填写');
});

test('歧义增加后拒绝旧地址，不静默取第一个；隐藏副本不干扰语义定位', async () => {
  const c = (await identities(await scan())).get('search-filter');
  await page.evaluate(() => { const b = document.querySelector('[data-case="search-filter"]'); b.after(b.cloneNode(true)); });
  await assert.rejects(findElement(page.mainFrame(), c.locator), /不唯一/);
});

test('新增同名弹框后原区域地址不漂移，不把同一字段重复建模', async () => {
  await page.locator('[aria-label="变量编辑"]').evaluate(el => el.hidden = true);
  const before = await identities(await scan());
  await page.locator('[aria-label="变量编辑"]').evaluate(el => el.hidden = false);
  const after = await identities(await scan());
  for (const id of ['filter-group', 'search-filter', 'page-filter']) {
    assert.deepEqual(before.get(id).locator, after.get(id).locator, id);
    assert.equal(before.get(id).key, after.get(id).key, id);
    const el = await findElement(page.mainFrame(), before.get(id).locator);
    try { assert.equal(await el.getAttribute('data-case'), id); } finally { await el.dispose(); }
  }
});

test('执行器拒绝 CSS 序号、绝对层级及隐藏在关联步骤里的序号', async () => {
  for (const selector of ['input:nth-child(1)', 'input:first-of-type', 'html > body > input', 'xpath=(//input)[1]', 'anchor='+JSON.stringify([{ axis:'descendant', selector:'input:nth-of-type(2)' }])]) {
    await assert.rejects(findElement(page.mainFrame(), {selector}), /脆弱/);
  }
});

test('匿名字段不假装可定位，也不依据当前值生成定位', async () => {
  const result = await scan();
  const unresolved = result.controls.filter(c => !c.locator.unique);
  assert.equal(unresolved.length, 4);
  assert.ok(unresolved.every(c => c.locator.basis==='unresolved' && c.locator.selector==='' && c.locator.reason));
  await page.locator('[data-case="unknown-a"]').fill('这个值不能作为身份');
  const next = await scan(); assert.equal(next.unresolvedControls, 4);
  assert.ok(!next.controls.some(c => c.locator.selector.includes('这个值')));
});

test('开放 Shadow 中同样支持标签和兄弟锚点，宿主地址可重放', async () => {
  await page.evaluate(() => {
    const root = document.querySelector('[data-case="shadow-host"]').attachShadow({mode:'open'});
    root.innerHTML = '<label>温度<input data-case="shadow-temperature"></label><span aria-label="湿度设定">湿度</span><input data-case="shadow-humidity">';
  });
  const observed = await scan(), ids = await identities(observed);
  for (const id of ['shadow-temperature','shadow-humidity']) {
    const c=ids.get(id); assert.ok(c, id + JSON.stringify(observed.controls.filter(c => c.locator.shadowPath.length))); assert.equal(c.locator.shadowPath.length,1);
    const el=await findElement(page.mainFrame(),c.locator); await el.fill('12'); await el.dispose();
  }
});

test('unresolved 出现在中文报告且不可进入正式映射，重复快照仅合并稳定字段', async () => {
  await page.route('http://fixture.invalid/**', route => route.fulfill({contentType:'text/html',body:html}));
  const scene={id:'onsite',url:'http://fixture.invalid/controls',ready:{selector:'body'},steps:[]};
  const r=await discoverPage(page,{schemaVersion:3,id:'onsite-local',scenes:[scene,{...scene,id:'repeat'}]});
  assert.equal(r.status,'partial'); assert.ok(r.snapshots.every(s=>s.unresolvedControls===4));
  const draft=await createDiscoveryDraft(r);
  assert.ok(draft.fields.every(f=>f.locator.unique)); assert.ok(draft.fields.every(f=>f.observedIn.length===2));
  const review=createReviewTemplate(draft); review.confirmed={scope:true,domains:true,businessRules:true};
  review.fields=review.fields.slice(0,1).map(f=>({...f,include:true,values:['测试']}));
  const {mapping}=await compileReviewedModel(r,review); assert.equal(mapping.fields.length,1);
  assert.match(renderDiscoveryReport(r,draft), /未定位/);
});
