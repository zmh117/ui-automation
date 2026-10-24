## Why

真实 EBR 页面暴露定位前缀过长、工作流节点键为空的问题。将首次采集的动态 ID 写死在测试中还会导致数据重建后定位失败，需要以当前观察和业务关系解析目标。

## What Changes

- **BREAKING** 两套前端公共适配器缩短生成标识，保留作用域区分；不兼容旧长标识。
- 修复 EBR 工作流节点键，增加少量只读 DOM 元数据供节点与连线采集。
- 自动化采集当前工作流 JSON，根据业务名称、类型、前后节点关系唯一匹配；操作前重新读取，拒绝缺失、歧义和不完整证据。
- 输出模型关系及可运行测试；不访问 Vue 私有实例，不逐个改写业务页面。

## Capabilities

### New Capabilities
- `business-node-locators`: 简短作用域标识及基于当前工作流业务关系的节点定位。

### Modified Capabilities

无。

## Impact

EBR/JTH 的公共定位适配器、EBR 工作流模板；config-enumerator 的发现、JSON、关系模型与测试。已有依赖即可实现，不修改业务保存逻辑或后端。
