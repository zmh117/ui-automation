## Why

当前发现器会遗漏组件范围外的弹框、Frame 和开放 Shadow DOM，也无法机器区分选项全集与当前渲染片段；表格仅能发现输入控件。需要把这些边界和显示证据纳入发现报告，避免将观察完成误解为业务覆盖完成。

## What Changes

- **BREAKING**：发现计划、报告、草稿与映射升级为新结构，定位包含 Frame 链与 Shadow 宿主链；不兼容旧发现数据，旧报告可保留供历史查阅。
- 关联指定入口新打开的弹框，扫描本次关联的外置与嵌套弹框，不以全局同名按钮判断归属。
- 为选项记录完整／部分／未知、观测数、声明总数、来源和原因，不自动翻页或更改业务选项。
- 扫描范围内可见 iframe 与开放 Shadow DOM，支持明确的 Frame 和 Shadow 入口，预算或不可访问边界记入报告。
- 采集普通表格和 ARIA 表格单元格的显示文本、行列身份及显式 DOM 业务值；不读取 Vue 私有状态，不自动断言显示正确。
- 在本项目新增发现验证页与真实浏览器测试，保留原六页与枚举/PICT 回归范围。

## Capabilities

### New Capabilities
- `discovery-evidence`: 跨边界页面发现、弹框关联、选项完整性与单元格显示证据。

### Modified Capabilities
无已归档的主规格需要修改。

## Impact

影响 `packages/config-enumerator` 的发现 API、CLI 产物、示例、测试和说明，以及 `playground` 验证实例。复用已有 Vue、Playwright，不引入新运行依赖。用户已授权实施和必要重构；不扩展至后台非法注入或真实 MES 验收。
