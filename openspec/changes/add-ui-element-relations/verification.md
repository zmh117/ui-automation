# 验证记录

日期：2026-10-23。

## 已完成

- `npm test`（`packages/config-enumerator`）：TypeScript 构建通过，31/31 单元及原有枚举 CLI 检查通过。其中 7 项新增模型检查覆盖身份隔离、逐状态值、未定位、选项类型、行归属、打开证据、配置确认及报告指纹。
- `node --test --test-concurrency=1 test/discovery/*.test.mjs test/integration/mes-components.test.mjs`：63/63 浏览器检查通过，包含原有 54 项发现检查、6 项新增关系检查和 3 项真实组件检查。
- 真实组件使用 `真实项目代码/test-ids/serve-fixture.cjs`：加载 JTH 已安装的 Vue 2、view-design、md-mes-plus，以及真实 MdTable/MdTableLazy 源码和定位适配。验证单选/多选 transfer 面板、输入/触发器关联、记录排序、固定列和弹框。
- `config-discover` CLI：2 个场景、4 份快照完成，六份产物完整写出，报告指纹、所有关系端点/快照引用及候选字段映射核验通过。6 个候选字段的确认模板仍默认不选。
- 本地组件示例生成 74 个元素、75 条关系，其中 2 条经过实际展开验证的 `opens`。模型状态为 `partial`，保留选项全集未知及部分不可定位结构；不伪装为全应用模型。
- `openspec validate add-ui-element-relations --strict` 和差异空白检查通过。
- 测试使用独立浏览器上下文；所有记录的浏览器/辅助进程退出，随后关闭本次启动的练习站及组件服务。

## 产物

- 本地组件 API 输出：`output/ui-element-relations-20261023/`。
- 实际 CLI 输出：`output/ui-element-relations-cli-20261023/`，包含 `report.json`、`report.md`、`draft-model.json`、`review-template.json`、`ui-model.json`、`ui-model.md`。
- 输出目录按仓库约定忽略；使用 [UI-MODEL.md](../../../packages/config-enumerator/UI-MODEL.md) 中命令重新生成，服务端口以实际启动结果为准。

## 发现并修正的问题

- 普通扫描中新增区域结构时，整片表单文本重复采集造成预算截断；结构采集与探索所需的区域文本比较现已分开。
- md 多选可见触发器对应的原生输入可能不可见；精确组件约定现在允许唯一可见触发器作为所属面板依据，不绕过隐藏过滤。
- Frame 内导航现在连接新文档，而不是误指外层页面。
- 初次浏览器启动被执行沙箱限制；改用经工具审批的隔离本地测试执行。CLI 首次输出父目录不存在，目录准备后重跑通过。未将这些环境失败报告为功能通过。

## 验证边界

本地测试数据来自固定组件实例及练习站。未连接真实 MES 后端，未验收 EBR 依赖版本、全业务页面、接口/数据库持久化或设备交互。未实现通用 Vue 源码语义解析、自动业务依赖推断或基于模型的自动保存流程；既有发现安全边界及配置规则确认保持不变。
