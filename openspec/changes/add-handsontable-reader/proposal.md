## Why

批记录使用 Handsontable 动态生成单元格，通用 DOM 扫描无法可靠表达合并范围、固定区域副本和样式。用户要求在自动化项目读取这些证据并输出 JSON，尽量不改前端。

## What Changes

- 新增只读 Handsontable DOM 读取器，复用外层定位，采集显示内容、可见控件状态、指定样式及合并结构。
- 发现流程自动识别 Handsontable，输出专用 JSON，并接入已有元素关系模型。
- 保留坐标依据、快照身份、预算和缺口；不从显示文本推断原始业务值，不以扫描结果生成预期值。
- 使用公开可安装的 Handsontable Pro 6.2.3 做本地真实组件验证（EBR 声明的 6.2.6 在公共 npm 不存在，不能等同该版本验收），不修改 EBR/JTH 前端。

## Capabilities

### New Capabilities
- `handsontable-reader`: 只读采集、结构关系、覆盖边界及断言辅助输出。

### Modified Capabilities
无。

## Impact

影响 packages/config-enumerator 的扫描协调器、导出、模型和测试。仅为自动化测试增加固定版本组件依赖；不连接真实 MES 后端、不修改前端、不提交代码。
