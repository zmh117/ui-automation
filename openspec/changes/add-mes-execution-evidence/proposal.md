## Why

MES 已有用例、定位和断言附件，但 JSON 缺少完整逐步轨迹，成功执行也不保留 trace。用户要求把需求用例和实际执行证据关联，供 Agent 对照分析。

## What Changes

- **BREAKING** MES 用例采用 schemaVersion 2，明确需求编号、版本、正文，以及用户步骤/断言编号及需求引用；旧文件需人工补充，不能猜测需求。
- 标准 MES 入口记录导航、Frame、入口点击、画布等待、节点解析/点击、面板等待和逐项断言，保留开始结束时间、前后状态、预期、实际、失败和未执行步骤。
- 每步落盘，输出成功和失败均有的 execution.json，原有 results.jsonl 补充业务轨迹与 Playwright 步骤；trace 和收尾截图覆盖所有执行。
- 在现有本地适配器及正式 runner 验证成功、前置失败、断言失败、中断/未执行及证据缺口，不改前端，不接入 Agent 服务。

## Capabilities

### New Capabilities
- `mes-execution-evidence`: 需求关联、逐步执行证据与 Agent 可分析 JSON。

### Modified Capabilities
无。

## Impact

影响 automation/mes、MES 页面适配器、示例与验证。无新增运行依赖，不修改 EBR/JTH，不涉及部署。
