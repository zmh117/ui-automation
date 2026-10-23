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

## 验证范围

```sh
npm test
node --test test/discovery/handsontable.test.mjs
```

浏览器测试使用公开 npm 包 `handsontable-pro@6.2.3` 和本地固定数据，覆盖格式化文本、合并、固定副本、虚拟滚动、Frame/Shadow、预算、隐藏及只读行为。该旧版仅为开发测试依赖，不进入读取器运行时；其历史依赖的审计提示不通过升级业务前端来处理。

EBR 声明 `handsontable-pro@6.2.6`，公共 npm 可用版本最高为 6.2.3，本次证据不等于 6.2.6 或真实 MES 页面验收。模板/任务对应的业务预期及完整批记录验收仍需在实际测试环境执行。
