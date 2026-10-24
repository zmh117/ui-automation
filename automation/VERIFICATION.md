# 六页 UI 自动执行验收

日期：2026-10-07。已确认规格和模型版本：`2026-10-07.1`。运行环境：Node.js 22.14.0、Playwright Test 1.63.0、Google Chrome 154.0.8037.98。目标为本项目真实运行的 Vue 练习站 `http://127.0.0.1:5173`，保存介质为隔离上下文的 localStorage。

## 完整执行

执行命令：项目根目录 `npm run test:ui`。本次采用 4 workers、retries=0。

完整计划已执行结束，用时 **31.1 分钟**，命令退出码为 1（有产品断言失败）。**2453 次已执行，2451 次通过、2 次失败；超时、跳过、中断、未执行均为 0。** `complete=true`、`coverageComplete=true`、`allPassed=false`：执行目录已跑完，产品回归尚未全绿。

2461 条计划路径中，2459 条所在测试通过。配置候选包含 1372 次合法、1012 次非法目标；69 次是明确行为场景。

- [完整计划](output/2026-10-07T15-13-20-037Z-a138cd9c/plan.json)：2453 次测试、2461 条计划路径。
- [逐条结果](output/2026-10-07T15-13-20-037Z-a138cd9c/results.jsonl)：每条候选、步骤、断言、实际值及证据路径。
- [执行汇总](output/2026-10-07T15-13-20-037Z-a138cd9c/summary.json)。
- [HTML 报告](output/2026-10-07T15-13-20-037Z-a138cd9c/html/index.html)。

| 页面 | 执行数 | 通过 | 失败 |
|---|---:|---:|---:|
| `/#/inputs` | 129 | 129 | 0 |
| `/#/linkage` | 53 | 53 | 0 |
| `/#/dialogs` | 353 | 353 | 0 |
| `/#/extended` | 284 | 284 | 0 |
| `/#/table` | 400 | 399 | 1 |
| `/#/all` | 1234 | 1233 | 1 |

完整覆盖目录包括 1192 条不同配置候选，分类页及全部组件页各执行一次，共 2384 次；另有 69 次操作行为场景。2-way、3-way、PICT 冒烟、无限值域和跨全部字段笛卡尔积不属于本轮。

## 已观察到的产品缺陷

**搜索后新增第 6 行没有定位到最后一页。**同一个 `TableView.vue` 在 `/#/table` 和 `/#/all` 上均复现。

复现路径：

1. 正常 UI 新增并填写到 5 行。
2. 搜索 `MAT-001`，列表只显示第一条明细。
3. 点击“添加明细”，总行数变为 6，搜索框清空。
4. 预期当前页为第 2 页，显示新增行；实际仍是第 1 页。

根据源码分析，`add()` 清空 `search` 后设置末页；`watch(search, () => page.value = 1)` 又把页码改回 1。没有搜索条件时新增跨页、跨页编辑和删除后的页码收敛由独立场景验证，避免这一失败遮挡其他路径。

保留失败断言，没有改为预期失败或放宽到“任意页都通过”。此次没有修改被测前端源码。

```bash
npm run test:ui -- --headed --slow-mo 300 --workers 1 --grep 'behavior.table.add-clear-query-goto-end'
```

- [分类页错误现场](output/2026-10-07T15-13-20-037Z-a138cd9c/artifacts/behaviors-category-behavior-table-add-clear-query-goto-end/error-context.md)
- [分类页截图](output/2026-10-07T15-13-20-037Z-a138cd9c/artifacts/behaviors-category-behavior-table-add-clear-query-goto-end/test-failed-1.png)
- [分类页 trace](output/2026-10-07T15-13-20-037Z-a138cd9c/artifacts/behaviors-category-behavior-table-add-clear-query-goto-end/trace.zip)

## 其他验证

| 检查 | 结果 |
|---|---|
| `npm --prefix automation run typecheck` | 通过 |
| 枚举器 `npm test` | 24/24 通过 |
| 只读发现 `npm run test:discovery` | 13/13 通过 |
| `openspec validate execute-playground-ui-configurations --strict` | 通过 |
| `npm run ui:plan` | 输出 2453 条计划；attempted=0、notRun=2453、complete=false |
| 报告筛选与直接 CLI 入口 | 筛选执行 1/1 通过但 coverageComplete=false；直接 CLI 计划标为未核验选择，不冒充全量 |
| 可见慢速单用例成功退出 | 退出码 0；观察到本次 8 个 Chrome 进程，结束后残留 0 |
| 可见慢速单用例失败退出 | 退出码 1；观察到本次 7 个 Chrome 进程，结束后残留 0 |
| 可见慢速运行中 Ctrl+C | 退出码 130；观察到本次 7 个 Chrome 进程，结束后残留 0 |

完整运行退出后，再按先前记录的 32 个所属进程和 4 个测试浏览器配置目录核对，残留为 0，见 [全量运行清理记录](output/full-run-cleanup.json)。

生命周期证据：[成功/失败退出](output/lifecycle-exit.json)、[中断退出](output/lifecycle-cancel.json)。进程归属按本次 runner 的子进程树记录，检查相同 PID 和命令是否残留；没有按进程名终止 Chrome。

复杂组件通过普通 Playwright 操作校准：开关点击可见轨道，单选/多选点击可见选项，变量通过第二页选择，时间先等待弹层初始化再输入并失焦，日历与时分秒列表实际点击，颜色使用原生输入框的 `locator.fill()`，文件使用 `setInputFiles()`。没有修改 DOM 值、Vue 内部状态或应用存储的自定义注入。

先前的 `output/` 目录包含适配调试、筛选回归和生命周期验证，不能把这些筛选结果相加冒充完整执行。此文只以上述完整运行目录作为全量验收依据。

本结果证明的是本地练习站及其执行器，不代表真实 MES、数据库、Redis、WMS 或设备链路已经验收。

## 2026-10-24：MES 工作流入口同步验证

新增 `--suite mes --cases <文件>`，详细使用方式见 [MES.md](MES.md)。本轮验证的是执行器接入，不是实际 EBR/JTH 后端联测。

- 7 项本地隔离回归通过：节点 ID 重建、前后关系消歧、失败不点击/不重试、短名重复、Frame/Shadow、独立预期与面板范围，以及正式 runner 的计划/成功/错误断言/无效用例分支。
- 正式 runner 的故意错误预期返回非零退出码，保留当前 JSON、失败现场、截图和 trace；该失败是负向测试预期，不属于业务验收。
- 类型检查、枚举器 31 项、原报告 15 项、冒烟 9 项测试及严格 OpenSpec 校验通过。原全量计划仍为 2665 项，发现页计划仍为 212 项；本轮未重新执行练习站全量浏览器用例。
- 验证期间记录本次 runner 的子进程树，正常关闭后核验同 PID/命令残留为 0；未操作用户 Chrome。

本地证据：[回归日志](../output/mes-adapter-20261024/adapter-tests.log)、[进程归属与退出](../output/mes-adapter-20261024/processes.json)。输出为本地忽略文件；换机器可用 `npm --prefix automation run test:mes-adapter` 重跑。真实地址、目标配方及独立预期需按环境填写，当前没有真实环境通过结论。
