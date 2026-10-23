## Why

当前发现报告保存字段、表格单元格、弹框和入口路径，但它们分散在逐次快照中，无法直接查询一个操作属于哪条记录、打开哪个界面。EBR/JTH 的公共组件复用、transfer 浮层及稳定行标识需要一个保留上下文和证据的 UI 关系模型。

## What Changes

- 从发现快照构建独立的 UI 元素关系模型，保留稳定身份、逐状态观察、包含关系、选项归属及已验证的打开关系。
- 根据真实 iView/md 组件源码补充表单、弹框、表格行和 transfer 面板的结构证据；不按 test-id 的连字符任意拆层级。
- 发现命令导出 `ui-model.json` 和中文关系摘要，提供按元素查询关联的 API。
- 模型保留未定位、选项不完整和缺失关系证据；不自动生成业务规则或执行动作。

## Capabilities

### New Capabilities
- `ui-element-relations`: 基于可追溯扫描事实的 UI 元素、状态及关系建模。

### Modified Capabilities
无。

## Impact

修改 `packages/config-enumerator` 的发现类型、DOM 扫描、模型导出和文档，新增聚焦单元及浏览器回归。沿用现有 JSON 输出，不引入数据库或图平台。不修改 EBR/JTH 业务代码，不连接真实 MES 或推断库存、签名等业务规则。真实环境验收与本地验证分开记录。
