import test, { before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { readWorkflow, requireWorkflowNode, clickWorkflowNode, discoverPage, createWorkflowReport, createUiElementModel, fingerprintReport } from '../../dist/discovery/index.js';

const require = createRequire(import.meta.url), sourceRoot = resolve('../../真实项目代码');
const compiler = require(join(sourceRoot, 'JTH/node_modules/vue-template-compiler'));
const vue = readFileSync(join(sourceRoot, 'JTH/node_modules/vue/dist/vue.js'), 'utf8');
const pluginSource = readFileSync(join(sourceRoot, 'EBR/src/libs/test-id.js'), 'utf8');
const pluginUrl = 'data:text/javascript;base64,' + Buffer.from(pluginSource).toString('base64');
const nodeTemplate = compiler.parseComponent(readFileSync(join(sourceRoot, 'EBR/src/components/workflow/node.vue'), 'utf8')).template.content;
const nodeCallSites = ['view/workflow/index.vue', 'view/execute/workflow.vue', 'view/production/workOrderProgress.vue'];
const calls = nodeCallSites.map(file => readFileSync(join(sourceRoot, 'EBR/src', file), 'utf8').match(/<MdNode\b[\s\S]*?<\/MdNode>/)[0]);
const url = 'http://workflow.test/';
const address = { selector: '[data-workflow="mes"]' };
const query = { name: '称量检查', type: '8', predecessor: { name: '投料' }, successor: { name: '结束' } };
let browser, server, context, page, owned = [];
const processes = () => execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).trim().split('\n').map(line => {
  const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/); return m ? { pid: Number(m[1]), ppid: Number(m[2]), command: m[3] } : null;
}).filter(Boolean);
function remember() {
  const all = processes(), ids = new Set([server.process().pid]);
  let size; do { size = ids.size; for (const p of all) if (ids.has(p.ppid)) ids.add(p.pid); } while (size !== ids.size);
  for (const p of all.filter(p => ids.has(p.pid))) if (!owned.some(x => x.pid === p.pid && x.command === p.command)) owned.push(p);
}
before(async () => {
  server = await chromium.launchServer({ channel: process.env.BROWSER_CHANNEL ?? 'chrome', headless: true });
  browser = await chromium.connect(server.wsEndpoint()); remember();
});
after(async () => {
  if (!server) return;
  remember(); await browser?.close(); await server.close();
  const live = processes(), remaining = owned.filter(p => live.some(l => l.pid === p.pid && l.command === p.command));
  writeFileSync(process.env.WORKFLOW_PROCESS_LOG ?? '/tmp/mes-workflow-processes.json', JSON.stringify({ owned, remaining }, null, 2));
  assert.deepEqual(remaining, [], '只清理本次测试浏览器，所有自有进程应退出');
});
beforeEach(async () => {
  context = await browser.newContext();
  await context.route(url + '**', route => route.fulfill({ contentType: 'text/html', body: '<meta charset="utf-8"><style>.node-fixture{width:240px;height:90px;position:relative}svg{width:226px;height:60px}</style><div id="app"></div>' }));
  page = await context.newPage(); await page.goto(url); await page.addScriptTag({ content: vue }); remember();
});
afterEach(async () => { await context?.close(); });

async function mountFixture({ pluginUrl, nodeTemplate, callTemplate, offset }) {
    const { default: plugin } = await import(pluginUrl); Vue.use(plugin);
    window.warnings = []; Vue.config.warnHandler = warning => warnings.push(warning); window.clicked = [];
    Vue.component('MdNode', {
      template: nodeTemplate, props: ['node', 'currClickIndex'],
      data: () => ({ hoverIndex: 0, EXCEL_TYPE: { START: 1, END: 2 }, nodeClass: 'node-fixture', hasActiveClass: false, isStep: true, isWoWorkFlow: false, isShow: true, isCanEditByEditMode: false, notCreate: false }),
      methods: { mousedown() {}, nodeClickHandler() { clicked.push(this.node.basic.id); }, nodeTouchEnd() {} },
      components: { MdIcon: { template: '<i></i>' }, Icon: { template: '<i></i>' }, MdButton: { template: '<button></button>' } }
    });
    const make = (id, name, type, next) => ({ basic: { id: id + offset, desc: name, type }, shape: { left: 0, top: 0, linkout: next.map(n => ({ id: n + offset, to: `node${n + offset}Top` })) }, attribute: {} });
    const pi = [make(0, '投料', 3, [1]), make(1, '称量检查', 8, [3]), make(2, '称量检查', 8, [3]), make(3, '结束', 2, [])];
    const Graph = {
      template: '<div data-workflow="mes" :data-testid="$testId(\'canvas\',\'ebr-workflow-index\')">' + callTemplate + '</div>',
      data: () => ({ pi, currClickIndex: '', initColors: Array.from({ length: 6 }, () => ({ value: 'red' })) }),
      methods: { clickHandler() {}, deleteHandler() {}, doClickHandler() {} },
      mounted() { window.graph = this; }
    };
    new Vue({ el: '#app', components: { Graph }, template: '<Graph test-id-scope="ebr-pi-workflow" />' });
    await Vue.nextTick();
}
async function boot(call = 0, offset = 0) {
  await page.evaluate(mountFixture, { pluginUrl, nodeTemplate, callTemplate: calls[call], offset });
  await page.waitForFunction(() => document.querySelector('[data-workflow-node-id="' + graph.pi[1].basic.id + '"]').getAttribute('data-testid'));
}
const read = options => readWorkflow(page.mainFrame(), address, options);

test('三个真实 MdNode 模板使用 basic.id，0 有效；多个判断节点及形状不重复', async () => {
  for (let i = 0; i < calls.length; i++) {
    if (i) { await page.goto(url); await page.addScriptTag({ content: vue }); }
    await boot(i);
    const reading = await read(); assert.equal(reading.status, 'observed');
    assert.equal(new Set(reading.nodes.map(n => n.testId)).size, 4);
    assert.ok(reading.nodes.every(n => n.testId === `ebr-pi-workflow-node-${n.id}`));
    const shapes = await page.locator('polygon').evaluateAll(nodes => nodes.map(el => el.getAttribute('data-testid')));
    assert.deepEqual(shapes, ['ebr-pi-workflow-node-1-shape', 'ebr-pi-workflow-node-2-shape']);
    assert.deepEqual(await page.evaluate(() => warnings), []);
  }
});

test('当前 JSON 前后关系消歧；下次运行全部 ID 改变仍使用同一业务查询', async () => {
  await boot();
  const before = await page.locator('[data-workflow]').innerHTML();
  const first = await read(); assert.equal(requireWorkflowNode(first, query).id, '1');
  assert.equal(await page.locator('[data-workflow]').innerHTML(), before, '读取无副作用');
  assert.throws(() => requireWorkflowNode(first, { name: '称量检查' }), /歧义/);
  await clickWorkflowNode(page.mainFrame(), address, query);
  await page.evaluate(async () => {
    graph.pi = graph.pi.map(n => ({ ...n, basic: { ...n.basic, id: n.basic.id + 100 }, shape: { ...n.shape, linkout: n.shape.linkout.map(e => ({ ...e, id: e.id + 100 })) } }));
    await Vue.nextTick();
  });
  const second = await clickWorkflowNode(page.mainFrame(), address, query);
  assert.equal(second.node.id, '101'); assert.deepEqual(await page.evaluate(() => clicked), [1, 101]);
  assert.equal(first.nodes[1].id, '1', '旧 JSON 保持证据，执行不接收旧 JSON');
  assert.throws(() => requireWorkflowNode(second.reading, { id: '1' }), /动态 ID/);
});

test('同名歧义与错误关系均不点击；不同工作流重复 ID 必须限定画布', async () => {
  await boot();
  await assert.rejects(clickWorkflowNode(page.mainFrame(), address, { name: '称量检查' }), /歧义/);
  await assert.rejects(clickWorkflowNode(page.mainFrame(), address, { ...query, predecessor: { name: '未知' } }), /未找到/);
  await page.evaluate(() => { const canvas = document.querySelector('[data-workflow]'); const second = canvas.cloneNode(true); second.setAttribute('data-testid', 'other-workflow'); canvas.parentElement.append(second); });
  await assert.rejects(read(), /唯一/);
  assert.equal((await readWorkflow(page.mainFrame(), { selector: '[data-testid="ebr-pi-workflow-canvas"]' })).nodes.length, 4);
  assert.deepEqual(await page.evaluate(() => clicked), []);
});

test('缺失 ID、重复 ID、未知后继、错误元数据和预算不足全部拒绝执行', async () => {
  await boot();
  for (const [attr, value] of [['data-workflow-node-id', ''], ['data-workflow-node-id', '0'], ['data-workflow-next', '[999]'], ['data-workflow-next', 'bad-json']]) {
    const node = page.locator('[data-workflow-node-id="1"]'); const old = await node.getAttribute(attr);
    const element = await node.elementHandle();
    await element.evaluate((el, args) => el.setAttribute(...args), [attr, value]);
    await assert.rejects(clickWorkflowNode(page.mainFrame(), address, query), /不完整/);
    await element.evaluate((el, args) => el.setAttribute(...args), [attr, old]); await element.dispose();
  }
  assert.equal((await read({ maxNodes: 1 })).status, 'incomplete');
  assert.equal((await read({ maxTextLength: 1 })).status, 'incomplete');
  await assert.rejects(clickWorkflowNode(page.mainFrame(), address, query, { maxNodes: 0 }), /不完整/);
  assert.deepEqual(await page.evaluate(() => clicked), []);
});

test('隐藏节点和隐藏画布不能作为完整关系依据', async () => {
  await boot();
  await page.locator('[data-workflow-node-id="2"]').evaluate(el => el.hidden = true);
  await assert.rejects(clickWorkflowNode(page.mainFrame(), address, query), /不完整/);
  await page.locator('[data-workflow]').evaluate(el => el.style.opacity = '0');
  await assert.rejects(read(), /可见/);
  assert.deepEqual(await page.evaluate(() => clicked), []);
});

test('采集到操作前图发生变化，拒绝旧地址而不尝试点击', async () => {
  await boot();
  await page.evaluate(() => {
    const root = document.querySelector('[data-workflow]'), original = root.getAttribute;
    // Changes after nodes have been read but before the first snapshot is returned.
    root.getAttribute = function(name) {
      if (name === 'data-testid') { document.querySelector('[data-workflow-node-id="1"]').setAttribute('data-workflow-node-name', '已变更'); root.getAttribute = original; }
      return original.call(this, name);
    };
  });
  await assert.rejects(clickWorkflowNode(page.mainFrame(), address, query), /已变化/);
  assert.deepEqual(await page.evaluate(() => clicked), []);
});

test('发现、workflow.json、关系模型贯通，重复快照不把动态 ID 当跨运行身份', async () => {
  await boot();
  const payload = { pluginUrl, nodeTemplate, callTemplate: calls[0], offset: 0 };
  await context.route(url + '**', route => route.fulfill({ contentType: 'text/html', body: '<style>.node-fixture{width:240px;height:90px}svg{width:226px;height:60px}</style><div id="app"></div><script>' + vue + '</script><script type="module">(' + mountFixture.toString() + ')(' + JSON.stringify(payload) + ')</script>' }));
  const report = await discoverPage(page, { schemaVersion: 3, id: 'wf', scenes: [{ id: 'graph', url: url + '#graph', ready: address, steps: [] }] });
  assert.equal(report.snapshots[0].workflows.length, 1);
  const output = await createWorkflowReport(report), model = await createUiElementModel(report);
  assert.equal(output.snapshots[0].workflows[0].reading.nodes.length, 4);
  assert.equal(model.relations.filter(e => e.kind === 'connects-to').length, 3);
  const nodes = model.elements.filter(e => e.kinds.includes('workflow-node'));
  assert.equal(nodes.length, 4); assert.ok(nodes.every(n => n.identityBasis === 'snapshot-only' && !n.locatable));
  const repeat = structuredClone(report.snapshots[0]); repeat.id = 'graph:1'; report.snapshots.push(repeat);
  report.reportId = await fingerprintReport(report);
  assert.equal((await createUiElementModel(report)).elements.filter(e => e.kinds.includes('workflow-node')).length, 8);
  if (process.env.WORKFLOW_TEST_OUTPUT) {
    mkdirSync(process.env.WORKFLOW_TEST_OUTPUT, { recursive: true });
    writeFileSync(join(process.env.WORKFLOW_TEST_OUTPUT, 'workflow.json'), JSON.stringify(output, null, 2));
    writeFileSync(join(process.env.WORKFLOW_TEST_OUTPUT, 'ui-model.json'), JSON.stringify(model, null, 2));
  }
  report.snapshots[0].workflows[0].reading.nodes[1].name = '篡改';
  await assert.rejects(createWorkflowReport(report), /指纹/);
});

test('Frame 和开放 Shadow 保留作用域；隐藏宿主不能绕过检查', async () => {
  await boot();
  await page.evaluate(() => {
    const graph = document.querySelector('[data-workflow]'), host = document.createElement('div'); host.id = 'host';
    document.body.append(host); const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<style>.node-fixture{width:240px;height:90px}svg{width:226px;height:60px}</style>'; shadow.append(graph);
  });
  const shadowAddress = { ...address, shadowPath: ['#host'] };
  assert.equal(requireWorkflowNode(await readWorkflow(page.mainFrame(), shadowAddress), query).id, '1');
  await page.locator('#host').evaluate(el => el.hidden = true);
  await assert.rejects(readWorkflow(page.mainFrame(), shadowAddress), /可见/);
  await page.evaluate(() => { const f = document.createElement('iframe'); f.name = 'wf'; document.body.append(f); });
  const frame = page.frame({ name: 'wf' });
  await frame.setContent('<style>.node-fixture{width:240px;height:90px}</style><div id="app"></div>');
  await frame.addScriptTag({ content: vue });
  await frame.evaluate(mountFixture, { pluginUrl, nodeTemplate, callTemplate: calls[0], offset: 50 });
  assert.equal((await clickWorkflowNode(frame, address, query)).node.id, '51');
  await page.locator('iframe').evaluate(el => el.hidden = true);
  await assert.rejects(readWorkflow(frame, address), /可见/);
});

test('真实公共组件原有 22 项回归，长前缀的 transfer 浮层仍归属正确且保持后缀合同', async () => {
  const fixture = readFileSync(join(sourceRoot, 'test-ids/fixture.html'), 'utf8');
  await context.route(url + '**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body, contentType = 'text/javascript';
    if (path === '/runtime.js') body = pluginSource;
    else if (['/md-table.js', '/md-table-lazy.js'].includes(path)) {
      const source = compiler.parseComponent(readFileSync(join(sourceRoot, 'JTH/src/components/md-components/md-table-page', path.slice(1).replace('.js', '.vue')), 'utf8'));
      const render = compiler.compile(source.template.content);
      body = source.script.content.replace('export default', 'const component =') + '\ncomponent.render = new Function(' + JSON.stringify(render.render) + ');\ncomponent.staticRenderFns=' + JSON.stringify(render.staticRenderFns) + '.map(code=>new Function(code));export default component;';
    } else if (path.startsWith('/deps/')) {
      body = readFileSync(join(sourceRoot, 'JTH/node_modules', path.slice(6)));
      if (path.endsWith('.css')) contentType = 'text/css';
      if (/\.(ttf|woff)$/.test(path)) contentType = 'application/octet-stream';
    } else { body = fixture; contentType = 'text/html'; }
    await route.fulfill({ contentType, body });
  });
  await page.goto(url);
  const checks = new Function('return (' + readFileSync(join(sourceRoot, 'test-ids/browser-check.js'), 'utf8') + ')')();
  assert.equal((await checks(page)).passed, 22);
  const bases = ['ebr-first-' + 'nested-'.repeat(30) + 'select-type', 'ebr-second-' + 'nested-'.repeat(30) + 'select-type', 'x'.repeat(111)];
  const ids = await page.evaluate(async ({ bases, pluginUrl }) => {
    const { compactTestId } = await import(pluginUrl);
    const el = document.createElement('div'); document.body.prepend(el);
    new Vue({ el, template: '<div><md-select v-for="base in bases" :key="base" v-test-id="base" :option-item="options" transfer /></div>', data: { bases, options: [{ value: 1, label: '一' }] } });
    await Vue.nextTick(); return bases.map(compactTestId);
  }, { bases, pluginUrl });
  assert.equal(new Set(ids).size, 3);
  for (const id of ids) {
    assert.equal(await page.getByTestId(id).count(), 1);
    await page.getByTestId(id + '-trigger').click();
    await page.getByTestId(id + '-panel').waitFor({ state: 'visible' });
    await page.getByTestId(id + '-option-1').click();
    assert.equal(await page.getByTestId(id).inputValue(), '一');
  }
});
