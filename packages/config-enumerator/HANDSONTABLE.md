# Handsontable 只读读取器

读取逻辑全部位于 UI 自动化项目。本次没有修改 EBR/JTH 前端，也不要求给单元格添加 test ID。复用已经标识的 HotTable 根节点，读取实际 DOM；不读取 Vue 私有字段，不修改组件设置，不主动滚动、编辑或切换任务。

## 使用与断言

```js
import assert from 'node:assert/strict';
import { readHandsontable, requireHandsontableCell } from '@mes-ui/config-enumerator/discovery';

// page 是已登录并进入目标任务的 Playwright 页面。
// 先用业务步骤确认当前任务、模板版本，等待表格加载完成。
const actual = await readHandsontable(page.mainFrame(), {
  selector: '[data-testid="record-sheet"]', // 换成实际 HotTable 外层标识
  // shadowPath: ['#host'], // 位于开放 Shadow 时填写
}, { maxCells: 300, maxTextLength: 500, includeStyles: true });

const cell = requireHandsontableCell(actual, {
  rowHeader: '2', columnHeader: 'B', // 固定版式当前快照的可见标题
});
// 预期值来自测试输入与已确认规则，不能从 actual 自动生成。
assert.equal(cell.displayTruncated, false);
assert.equal(cell.displayText, '温度 36.50 ℃');
assert.equal(cell.format['text-align'], 'right');
assert.deepEqual(cell.merge, { rowSpan: 1, colSpan: 1 });
```

`requireHandsontableCell` 在找不到目标、标题重复、目标内容截断或副本冲突时抛错。可传 `pane: 'ht_master'` 明确选择区域；未指定时仅接受一个候选或已有一致性证据的副本。该函数检查当前已采集范围，不保证坐标对应跨任务业务身份，也不表示测试成功。对于应等待的异步显示，用测试框架轮询**重新读取**并对照独立预期，不重复提交业务动作。

iframe 内先通过现有 `enterFrames` 取得目标 Frame，再调用读取器。只允许唯一、可见的外层定位，隐藏祖先/Shadow 宿主、重复入口或不支持的根结构均失败；不通过读取隐藏节点补数据。

## 输出

原有发现命令无需新增计划字段：

```sh
npm run build
npm run discover -- --plan path/to/plan.json --out output/new-discovery
```

发现协调器自动识别扫描范围内包含直属 `.ht_master` 的 `.handsontable` 根节点。新增 `handsontable.json`；完整结果也在 `report.json` 的 `snapshots[].handsontables`，归属与副本关系进入 `ui-model.json`。

| 内容 | JSON 字段及含义 |
|---|---|
| 来源 | `reportId`、`snapshotId`、页面 URL、表格 `locator`、Frame/Shadow 上下文、真实祖先容器 |
| 显示内容 | `displayText` 保留文本前后缀及块级/显式换行；`displayTruncated` 标记截断。不等于浏览器排版折行或完整富文本渲染 |
| 原始值 | `businessValue: null`、`valueKnown: false`、`valueSource: "unknown"`；不把 `"0012"`、`"36.50"`、枚举标签转换成后台值 |
| 坐标与身份 | `headers.row/column` 是当前可见标题；`renderedRow/Column` 是 pane 内 DOM 槽位，**不是数据索引**；身份为 `snapshot-only` |
| 合并 | `merge.rowSpan/colSpan` 来自真实 TD，只记录锚点，不伪造被覆盖格 |
| 格式 | `format` 为计算 CSS 白名单：字体、颜色、背景、对齐、换行规则、文本装饰、四边框。`parts[].format` 表示选定内层控件或 `.control-text` 的样式；不是 Excel 数字格式、背景合成后的像素或截图验收 |
| 内部内容 | `parts` 记录输入框值、复选状态、只读/禁用、图片加载状态等；不导出 HTML、图片 URL、密码/验证码值。TD 自身不凭样式类推断业务可编辑性 |
| 副本 | `pane` 保留主表/固定区域；标题唯一、内容/格式/跨度一致时 `duplicateOf` 指向同快照主项，模型以 `mirrors` 关联；冲突不静默选第一项 |
| 覆盖 | `coverage.scope: "rendered-dom"`、`totalCells: null`、`allDataCovered: false`；保留预算截断、未知原始值、未读取范围。DOM 渲染缓冲区可能超出当前视口，CSS 可见不等于屏幕上未被遮挡 |

主表隐藏表头时，只从对应固定区域的**可见标题**按轴对齐读取，允许 1 CSS 像素边框差，并要求唯一匹配。缺失标题、自定义多层表头、几何错位或重复标题不猜测；保留内容，但辅助按标题查找会拒绝歧义。固定标题不代表稳定业务 ID，不跨快照合并单元格。

关系模型表达 `页面/Frame → 真实容器 → 表格 → 渲染行 → 单元格`；合并跨度与内部控件状态保留在单元格观察中，副本增加 `mirrors` 边。不推断模板、字段、工序业务依赖；这些信息未公开时需要用业务步骤验证任务范围。

## 预算与性能

独立 API 默认最多读取 300 个数据 TD（含固定区域副本），文本上限 500 字符、每格选定子内容上限 16 个；`includeStyles: false` 可关闭格式读取。发现流程复用计划 `limits.maxCells/maxTextLength`，跨普通表格、Handsontable 和 Frame 共享单元格预算。

一次读取批量执行 DOM 观察，只有测试运行时有成本，不向生产页面安装监听器。关闭格式读取适合仅验值场景。`elapsedMs` 是该次浏览器采集耗时，不能当成生产性能基准。未自动滚动，因此结果不证明整份批记录、全部模板或隐藏区域已覆盖。

直接调用底层 `scanDocument` 只输出 `handsontableTargets` 入口；完整读取用 `discoverPage` 或 `readHandsontable`。`createHandsontableReport(report)` 校验指纹后生成独立 JSON。

## 无 test ID 的右键菜单

Handsontable 将右键菜单动态挂载到 `body`。它同样带有 `.handsontable/.ht_master/table/td`，但属于菜单，不是另一张批记录表格。读取器会排除 `.htMenu`，通用采集器将 `.htMenu.htContextMenu` 内主区域的菜单 TD 记录为 `category: "action"`、`kind: "menuitem"`。

不需要修改 EBR/JTH 或给每个菜单项加 `data-testid`。`ht_90e8d3caeba1779c` 这样的随机 ID 不参与生成定位；定位采用当前可见菜单范围及精确显示名称，`Ctrl+1` 等独立右浮动快捷键单独记录，不混入“设置单元格格式”的名称。该适配针对已验证的 Handsontable 菜单结构；任意自定义快捷键布局不会被猜测拆分。

已打开菜单的观察结果位于 `report.json` 的 `snapshots[].controls`，也导出到 `handsontable.json` 的 `snapshots[].menuItems`；快照保留 `truncated` 和 `warnings`，预算不足时不能把缺少项目当成菜单不存在。其中：

| 字段 | 含义 |
|---|---|
| `label`、`locator` | 显示名称及可唯一回查的定位；同名项或多个同类可见面板导致歧义时 `unique: false` |
| `disabled` | DOM 的禁用属性或菜单 `htDisabled/htSelectionDisabled` 状态 |
| `menu.panelKind` | 主右键菜单 `context-menu` 或已展开子菜单 `submenu` |
| `menu.hasSubmenu` | 当前项具有 `htSubmenu` 标记，不代表子菜单已经读取 |
| `menu.shortcut` | 独立显示的快捷键；未识别时 `null` |
| `menu.ownerTable`、`menu.parentItem` | `null`：这类 DOM 未提供源表格和父菜单项的可靠归属，不能从位置、高亮或随机 ID 猜测 |
| `containers` | 菜单面板与操作的真实包含关系，进入 `ui-model.json`；布局 table/tr 不作为业务表格或记录行 |

测试步骤负责进入正确表格、右键打开菜单，再扫描当前 DOM。例：

```js
import assert from 'node:assert/strict';
import { scanDocument, findElement } from '@mes-ui/config-enumerator/discovery';

// 前置：已按测试用例在目标表格/单元格打开右键菜单。
const frame = page.mainFrame(); // iframe 内改用 enterFrames 返回的 Frame
const observation = await frame.evaluate(scanDocument, {
  scopes: [{ selector: 'body' }], framePath: [],
  maxControls: 300, maxOptions: 100, maxTextLength: 500,
  maxCells: 300, maxShadowDepth: 8, includeRegions: true,
});
assert.equal(observation.truncated, false);
const matches = observation.controls.filter(c => c.menu?.component === 'handsontable'
  && c.menu.panelKind === 'context-menu' && c.label === '设置单元格格式');
assert.equal(matches.length, 1);
assert.equal(matches[0].locator.unique, true);
assert.equal(matches[0].disabled, false);
const target = await findElement(frame, matches[0].locator);
assert.ok(target);
try {
  // 只有用例明确要求打开格式设置时才点击；后续仍须断言预期弹窗和内容。
  await target.click();
} finally { await target.dispose(); }
```

菜单关闭后重新打开、切换表格、悬停展开子菜单后都应重新采集。分隔线、隐藏项和未展开子菜单不属于已观察操作。采集过程不右键、不悬停、不点击，也不自动执行删除、剪切、合并等命令；当前发现计划没有自动遍历右键菜单的动作。菜单文字不是内部命令键，菜单扫描也不证明执行结果正确，断言须由用例提供独立预期。

## 验证范围

```sh
npm test
node --test test/discovery/handsontable.test.mjs
```

浏览器测试使用公开 npm 包 `handsontable-pro@6.2.3` 和本地固定数据，覆盖格式化文本、合并、固定副本、虚拟滚动、Frame/Shadow、预算、隐藏及只读行为。该旧版仅为开发测试依赖，不进入读取器运行时；其历史依赖的审计提示不通过升级业务前端来处理。

菜单回归包含用户提供的原始 13 项菜单 DOM，以及真实 6.2.3 组件的右键、悬停子菜单、关闭重开和菜单点击；验证分隔线、禁用、重复名称/面板、随机 ID 变化、隐藏、预算、JSON 与包含关系。菜单点击仅执行夹具回调，不代表真实 MES 命令或后端业务验收。

EBR 声明 `handsontable-pro@6.2.6`，公共 npm 可用版本最高为 6.2.3，本次证据不等于 6.2.6 或真实 MES 页面验收。模板/任务对应的业务预期及完整批记录验收仍需在实际测试环境执行。
