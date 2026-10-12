## Why

发现验证页已有只读采集验收，但尚未进入统一配置执行目录、PICT 选例和中文测试报告。需要实际操作本页的输入、弹框和文档边界，并区分“该页分组全量完成”与“全项目全量完成”。

## What Changes

- 为该页定义有限分组模型和独立操作场景，使用已有全量枚举器与真实 PICT n-way。
- 增加精确 Frame/Shadow 操作适配和独立 UI 断言；记录发现证据，但不把观察值作为预期。
- 增加 `--scope discovery`，支持只生成、执行和报告该页完整目录；默认仍包含全部页面。
- 扩充中文目录与现场证据，实际运行新增页全量及 2-way、3-way 冒烟。
- 不新增保存或自定义列表选择功能；列表当前仅展示，闭合 Shadow 内部不强行操作。

## Capabilities

### New Capabilities
- `discovery-page-ui-execution`: 发现验证页的有限配置全量、PICT 冒烟、UI 执行与中文报告。

### Modified Capabilities

无。沿用原执行和选例流程，新增明确范围。

## Impact

影响 automation 的模型、测试、运行入口和报告；新增 OpenSpec 覆盖说明。模型版本更新，历史报告只读保留。原六页用例行为与 PICT 算法保持不变，不连接真实 MES。
