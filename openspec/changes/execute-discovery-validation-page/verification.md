# 发现验证页执行验收

环境：2026-10-11，本项目 Vue 开发服务 `http://127.0.0.1:5173`，本机 Chrome / Playwright 1.63.0，真实微软 PICT。每例隔离浏览器上下文，不重试，不跳过。模型版本 `2026-10-11.1`。本轮没有修改被测前端，也没有连接真实 MES。

## 实际运行

| 范围 | 命令（项目根目录） | 计划 / 通过 | 报告 |
|---|---|---:|---|
| 新页分组全量 | `npm run test:ui -- --scope discovery --workers 2` | 212 / 212 | [中文测试报告](../../../automation/output/2026-10-11T14-07-14-630Z-0778e3f3/中文测试报告.md) · [中文失败报告](../../../automation/output/2026-10-11T14-07-14-630Z-0778e3f3/中文失败报告.md) |
| 新页 PICT 2-way | `npm run test:ui:smoke -- --scope discovery --way 2 --workers 2` | 99 / 99 | [中文测试报告](../../../automation/output/2026-10-11T14-09-11-565Z-d7c76646/中文测试报告.md) · [选例说明](../../../automation/output/2026-10-11T14-09-11-565Z-d7c76646/冒烟选例说明.md) |
| 新页 PICT 3-way | `npm run test:ui:smoke -- --scope discovery --way 3 --workers 4` | 204 / 204 | [中文测试报告](../../../automation/output/2026-10-11T14-12-17-466Z-81840282/中文测试报告.md) · [选例说明](../../../automation/output/2026-10-11T14-12-17-466Z-81840282/冒烟选例说明.md) |

以上三次运行均无失败、超时、中断、跳过、未执行。每例收尾均成功采集 7 个文档及其开放 Shadow 字段/单元格证据，没有采集错误。中文报告由逐条结果生成，统计与 summary 一致。

全量 212 = 194 合法配置 + 10 非法目标 + 8 操作场景。2-way 99 = 89 合法配置 + 2 非法代表 + 8 操作场景。3-way 204 = 194 合法配置 + 2 非法代表 + 8 操作场景；本页各组最多 3 个因子，因此合法部分达到有限组内全组合，非法部分仍为代表选例，不能替代全量。

`pageCoverageComplete=true` 只属于新页分组全量，`coverageComplete=false`；冒烟使用 `smokeComplete`，不会宣称全项目完整覆盖。

## 目录与回归核对

- 完整七页清单：2665 条（原六页 2453 + 新页 212），2673 条计划路径。所有中文场景均已识别，候选版本一致。[计划报告](../../../automation/output/2026-10-11T14-00-58-963Z-78bbb5eb/中文测试报告.md)。本轮未重新执行原六页全部用例。
- 默认七页 2-way 清单：808 条，真实 PICT 生成、可行元组覆盖及注册预核对通过，仅生成计划。[选例说明](../../../automation/output/2026-10-11T14-08-20-854Z-ddfbdebf/冒烟选例说明.md)。
- `npm --prefix automation run typecheck`：通过。
- `npm --prefix automation run test:report`：15/15 通过，含单页/全项目范围防混淆、跨文档失败证据和收尾采集错误可见性。
- `npm --prefix automation run test:smoke`：9/9 通过，使用真实 PICT，含单页目录与跨页污染拒绝。

- 原基础页及全部组件页保存刷新回归：`npm run test:ui -- --grep 'basic.free@2026-10-11.1#' --workers 1`，8/8 通过；报告明确标为 filtered。[中文报告](../../../automation/output/2026-10-11T14-14-43-287Z-ffe221a7/中文测试报告.md)。
- `openspec validate execute-discovery-validation-page --strict`、`git diff --check`：通过。

## 首轮失败与修正依据

首轮全量 [原始失败报告](../../../automation/output/2026-10-11T13-59-06-902Z-c91c0daf/中文失败报告.md) 保留，结果为 205 通过、7 失败。4 条是对原生 option 使用 `toBeDisabled` 的测试适配问题；3 条是远程选项期望标签错误。对照原生属性、当前工具行为和项目静态响应后修正测试，没有改被测页面来满足断言。

原生下拉的 `t` 候选仅断言 `disabled=true`、`selected=false` 和当前值保持 `kg`。本机无头 Chrome 键盘探针不能改变此选择器，`selectOption` 又能设置禁用项，因此不使用该 API 注入非法值，也不以动作超时证明 UI 拒绝。**本轮未验证操作系统原生菜单中的点击拦截。**合法 kg/g 实际选择执行。

远程成功场景读取本项目真实 GET 返回的“目标重量、实际重量、批次温度、环境湿度、搅拌速度”，独立预期写在测试内，不从响应动态生成期望。加载场景仅延迟后放行真实请求；503 是明确的受控故障模拟。

## 覆盖边界

- 分组和有限样本见 [覆盖规格](coverage-review.md)，不是全页面字段笛卡尔积或无限操作序列。
- 新页没有保存功能：检查字段隔离、取消/刷新复位，无业务写请求且没有 localStorage 写入。
- 展示列表和无处理器的“确定”不计为选择或保存；虚拟列表验证 3 个指定窗口，不证明声明的 100 项全部可达。
- 闭合 Shadow 内部不可访问，只核验限制记录；不伪装成内部覆盖。
- 没有推送代码或删除旧报告；`automation/output` 是本地忽略目录，换机器需重新执行。
