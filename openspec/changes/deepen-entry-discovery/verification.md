# 本地验证记录

日期：2026-10-13。

## 范围及现场取舍

对比 `现场使用/ui-automatic/` 最新源码和 `mes-ebr-combo-11` 报告：现场已新增表单、表格及行操作提取。聚合统计为 40 个快照、43 个表格、61 个表单、808 个行操作；这 808 个操作均缺少唯一性或使用了位置型地址，不能直接用于自动点击。

本轮吸收其链接／图标操作、业务行上下文和表单／详情展示采集需求；保留原始单元格、重复标签及独立控件，不引入按第 N 行合并固定列、忽略全部 URL 参数、位置 XPath 或粗略 z-index 剔除内容的策略。未复制或执行现场登录脚本、凭证和生产数据。

## 已执行检查

| 检查 | 结果 |
|---|---|
| `npm --prefix packages/config-enumerator test` | 24/24，通过 |
| `npm --prefix packages/config-enumerator run test:discovery` | 54/54，通过；原 40 项 + 本轮 14 项 |
| `npm --prefix automation run typecheck` | 通过 |
| `npm --prefix playground run build` | 通过；已有大 chunk 提示仍存在 |
| `npm run test:ui -- --scope discovery --grep 'discovery.observation\|behavior.discovery' --workers 2` | 23/23，通过 |
| `openspec validate deepen-entry-discovery --strict` | 通过 |
| `git diff --check` | 通过 |

UI 中文报告：`automation/output/2026-10-13T08-15-20-399Z-55cf0e7d/中文测试报告.md`。

## 新增测试证据

- 两行同名修改通过业务行键区分；行顺序反转后仍回查原行。
- 原始 URL 参数保留，`id=A` 与 `id=B` 分别探索。
- 新增→高级配置、只读详情、异步表单、iframe／开放 Shadow、实际 Vue 标签页及下拉均有路径和快照。
- 删除必须配置预期弹框；错误契约被阻止；确认层中即使有“查看”按钮也不继续。
- 禁用／隐藏祖先、无唯一锚点、危险和未知按钮不点击。
- 主配方起点、URL 排除及 iframe 排除覆盖；排除文档字段不进入报告候选。
- 深度及动作预算记录 limited；不同来源、多个弹框、无变化入口明确 blocked。
- 新窗口扫描后关闭，调用方已有窗口保留。
- 隔离页面用持久化业务计数验证未写入；实际 Vue 页面扫描前后 `storageState` 一致，避免仅靠刷新后的界面计数作断言。

## 最终 CLI 示例运行

运行 `npm run discover -- --plan examples/entry-exploration.json --out output/entry-exploration-20261013-final`，使用默认操作深度 4 和动作预算 180。

- 54 个快照，53 条成功路径（深度 1/2/3/4 分别为 9/9/14/21），23 个候选字段。
- 动作计数 153，含重放；203 条按策略未点击记录（包含不同路径下的同名入口观测）。
- 21 条达到深度上限 4 的后续路径；0 failed、0 blocked、0 截断、0 未定位控件。
- 因深度预算存在未探索分支，状态为 partial，CLI 退出码 2；不是执行故障。
- 中文发现报告：`packages/config-enumerator/output/entry-exploration-20261013-final/report.md`。
- 完整操作路径及关联快照：同目录 `report.json`。

## 验收边界

验证环境为本地 Chrome、真实 Vue 练习站及隔离 HTTP 测试页面，未连接真实 MES。没有运行七页 2665 条全量或 PICT 冒烟；本轮新增入口页用于发现验证，没有加入其业务配置执行目录。

自动探索不承诺全部按钮可执行。未知按钮、无语义图标、不唯一固定列、闭合 Shadow、虚拟／分页列表全域、隐含业务选项及主配方专用规则仍需项目配置或后续适配。按钮名称不能证明后端无副作用；自动创建草稿的入口应排除。未提交或推送。
