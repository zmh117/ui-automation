## Why

在开发 UI 自动化之前，需要一个规则明确、可重置、可独立运行的 Vue 练习站，覆盖表单约束、依赖联动和嵌套弹框，作为后续自动化的被测系统。

## What Changes

- 新增独立的 Vue + TypeScript 前端服务，提供基础输入、联动规则、嵌套弹框、扩展输入和动态表格页面。
- 增加全部组件页，在同一页集中展示上述五组完整交互，并提供页内快速定位。
- 按用户确认规则实现 A/B 双向互斥禁用、C 自动勾选并锁定 D；取消 C 后 D 保留勾选并恢复可编辑。
- 实现数字输入、100 字符限制、单选启用文本框、灰色 disabled 状态、校验及明确结果反馈。
- 增加下拉多选、级联、日期时间、滑块、开关、文件选择和动态行等输入形式。
- 弹框使用独立草稿，支持逐层确认和取消回退；确认保存至 localStorage，刷新保留，提供全站重置。
- 保留语义标签和稳定 test id；本次不开发 UI 自动化框架，也不接入真实 MES、数据库或 Redis。

## Capabilities

### New Capabilities

- `interaction-playground`: 前端练习站的导航、表单约束、联动、弹框事务、本地存储和扩展控件。

### Modified Capabilities

无。

## Impact

新增 playground/ 前端工程和启动说明；使用 Vue、Vite、Element Plus 及 TypeScript。原有 MES 方案和页面资料保留。本地存储只使用练习站专用 key，不操作其他应用数据。
