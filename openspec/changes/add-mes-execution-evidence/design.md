## Context

标准入口 executeMesWorkflowCase 已有单次节点点击和独立预期轮询。MES reporter 不导出步骤，前置导航/入口失败缺少业务上下文，成功 trace 被丢弃。保持当前正式套件范围，不把它扩展为任意业务动作引擎。

## Goals / Non-Goals

**Goals:** 每个已选用例都有需求与步骤计划；每个实际步骤有有序、可落盘、可追溯证据。成功与失败都能供 Agent 对照，未执行和证据不足明确区分。

**Non-Goals:** 不调用外部 Agent、不自动生成业务预期、不做后端验收、不改前端，不根据日志改写失败结果；绕过标准入口的底层工具不承诺自动生成完整用例轨迹。

## Decisions

- 用例 schemaVersion 2 强制 requirements（id/version/text），入口和 checks 有 id/title；checks 必须引用有效需求。基础导航/等待步骤使用保留编号，不伪造业务需求覆盖。示例迁移，旧 schema 明确拒绝。
- 一个轻量记录器复用现有适配器；先创建完整步骤计划（not-run），开始记录 running，操作后记录 passed/failed。保留 actionAttempted/actionCompleted，防止把等待/断言失败误说成点击未发生。
- 每步前后只读采集相关目标 DOM 摘要、URL、Frame/Shadow 地址和时间，限定文本长度；工作流解析的完整当前图作为该步实际证据。采集失败明确 unavailable，不能覆盖原始执行错误。密码与验证码字段不记录值。
- 每步原子写入独立执行 JSON；TestInfo 注解登记路径，最终附加附件。reporter 在结束时读取，处理 running 为 interrupted、缺失为 unavailable，未运行用例保留计划。同步输出逐用例 results.jsonl 与整次 execution.json，包括低层 Playwright 步骤和附件索引。
- trace/screenshot 均开启，保留成功失败的 DOM 轨迹与收尾截图；结构化状态在每步读取，不在每步截图或全页面全量扫描，控制成本。
- 需求是否全部满足仍是独立分析结论。报告只给明确断言结果、路径和证据缺口，不以脚本通过证明整个需求成立。

## Risks / Trade-offs

- [浏览器关闭或导航失败] → 每步尝试采集并记录缺口，不绕过失败、不重试业务点击。
- [进程异常结束] → 每步记录已落盘；reporter 能运行时收敛中断状态，强制终止时只承诺保留最近已写记录，不承诺生成完整汇总。
- [trace 占用空间增加] → 每次独立输出目录，由用户按需归档；本任务不清理历史报告。
- [业务预期缺失] → 收集阶段拒绝不合规用例，不猜需求编号或规则。

## Migration Plan

将本地 MES 用例更新为 schemaVersion 2，并补齐 requirements、入口步骤和 checks 编号/引用。仅升级自动化程序，不部署前端。旧输出保留，不做旧数据转换。
