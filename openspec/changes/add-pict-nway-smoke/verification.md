# PICT 冒烟接入验收记录

验收日期：2026-10-08。范围为本项目 Vue 练习站的已确认分组、有限样本和原有 Playwright 断言，不表示真实 MES 环境验收。

## 引擎与实现

- 使用真实微软 PICT v3.7.4，固定源码提交 `d529bb1535b725c8f29704f183b23dd344895d02`。
- 本机二进制位于 `automation/.tools/pict/pict`，SHA-256 为 `a46e63dd3dfeca693050b9b9399b022eeb48094d37a5bdcbfd5dee5d77629863`。其他平台重新编译的二进制指纹可能不同，每次运行记录实际指纹。
- macOS 编译时为编译子进程设置 SDK 与标准库头路径；没有修改系统配置。重复执行 `npm run pict:install` 已验证可识别既有安装。
- PICT 只生成合法 n-way，之后补齐每条违规规则代表及每个字段的已确认有限样本，并保留全部 69 条操作场景。分类页和全部组件页共用选例、分别执行。
- 原 Playwright 操作、断言与前端产品代码未修改；配置用例注册仅新增选例过滤。默认全量入口不变。

## 自动检查

| 检查 | 结果 |
| --- | --- |
| `npm --prefix automation run test:smoke` | 8 项通过，实际调用本机 PICT，未 mock 引擎 |
| `npm --prefix automation run test:report` | 12 项通过，包括冒烟、筛选和中断的中文范围标识 |
| `npm --prefix automation run typecheck` | 通过 |
| `openspec validate add-pict-nway-smoke --strict` / `git diff --check` | 通过 |
| `--way 0`、`--way 2.5`、全量入口使用 `--way 3` | 均退出 1，未进入 UI 执行 |
| `PICT_BIN` 指向不存在文件 | 退出 1，未进入 UI 执行，未降级为抽样 |

引擎测试包括 A/B/C/D 的 9 个合法配置、1/2/3/4-way 与 N=99、固定种子复现、中文及特殊字符、数组/对象类型、单值/单字段、全非法组、非法专用边界、错误输出、覆盖缺口、不完整候选目录、模型漂移，以及子进程超时、输出上限与中断。

## 六页计划与独立覆盖复核

| 模式 | 分组 | 合法配置候选 | 非法配置候选 | 操作场景执行 | 总执行数 | 可行 n 元组 |
| --- | --- | --- | --- | --- | --- | --- |
| 原分组全量 | 24 | 沿用完整目录 | 沿用完整目录 | 69 | 2453 | 不适用 |
| 2-way | 24 | 252 | 68 | 69 | 709 | 492/492 |
| 3-way | 24 | 515 | 68 | 69 | 1235 | 840/840 |

候选在分类页、全部组件页各执行一次，因此总数为配置候选数 × 2 + 69。N 大于字段数时使用全部字段；不构造跨组笛卡尔积。

除生成器内的覆盖核验，还使用独立 Python 脚本，通过 `itertools.combinations` 对完整合法目录与 PICT 所选行分别投影，核对 2-way 和 3-way 每组可行元组集合相等；另行核对全部字段样本和违规规则均被保留。两种计划均通过。

本地原始计划（路径相对于项目根目录；output 为忽略的运行产物）：

- 全量：`automation/output/2026-10-08T13-00-59-682Z-ae4b96f2/`
- 2-way：`automation/output/2026-10-08T13-00-59-682Z-d5ed287a/`
- 3-way：`automation/output/2026-10-08T13-00-59-682Z-3c75ceea/`

## 完整 2-way 浏览器执行

命令：`npm run test:ui:smoke -- --way 2`。默认本机 Chrome 无头执行，4 个 worker，无重试。

报告目录：`automation/output/2026-10-08T13-02-56-974Z-ddb83c8a/`。

结果：709 条全部执行，706 通过、3 失败、0 中断、0 跳过、0 未执行；耗时约 8.6 分钟，命令退出 1。汇总为 `complete=true`、`smokeComplete=true`、`coverageComplete=false`、`allPassed=false`，中文报告与原始记录一致。

三条失败为：

1. `category behavior.table.add-clear-query-goto-end`：既有搜索后新增物料的分页缺陷。
2. `all behavior.table.add-clear-query-goto-end`：相同分页缺陷在全部组件页的第二个入口。
3. `all behavior.extended.calendar-time-panels-clear`：点击时间面板小时 13 时超时，日志记录元素不稳定及其他元素拦截。

第三项使用 `npm run test:ui:smoke -- --way 2 --workers 1 --grep 'all behavior.extended.calendar-time-panels-clear$'` 单独复跑，1 条通过，耗时约 9.3 秒。报告目录为 `automation/output/2026-10-08T13-17-58-398Z-3858b67b/`，范围正确标为 `filtered`，`smokeComplete=false`。一次单独通过不足以证明稳定性问题已解决；没有替换完整运行的失败记录，也没有修改断言。

## 中断收尾

以单 worker、500ms slow-mo 筛选冒烟中 `category extended.color@2026-10-07.1#1`，测试开始后向本次 wrapper 子进程发送 SIGINT。

报告目录：`automation/output/2026-10-08T13-18-58-659Z-c3534f57/`。

观察结果：退出码 130；计划 1、中断 1、通过 0，`complete=false`、`smokeComplete=false`、`coverageComplete=false`，已生成中文中断报告并等待本次 Playwright 子进程收尾。没有向用户其他浏览器或无关进程发送信号。

## 验收边界

- 2-way 已完整实跑，有上述 3 条保留失败；接入完成不等于产品回归全部通过。
- 3-way 完成计划生成和静态覆盖核验，本轮未完整执行其 1235 条浏览器用例。
- 原全量 2453 条仅重新生成计划确认兼容，本轮未完整重跑。
- 冒烟覆盖基于已确认的有限值域，不代表无限输入、任意操作顺序或所有非法组合。
- 选例核心可供其他 Vue 项目复用，仍需要对应模型、页面操作和业务断言。
