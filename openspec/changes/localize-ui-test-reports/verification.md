# 中文报告本地验收记录

日期：2026-10-08。环境：本机 Node 22.14.0、Playwright 1.63.0、本机 Chrome、Vue 练习站 http://127.0.0.1:5173。仅验证本地报告能力，不代表真实 MES 或设备联调验收。

## 静态与单元检查

- `npm --prefix automation run test:report`：11 项通过，覆盖中断统计、计划/筛选范围、非法候选、统计不一致、未知错误、断言签名、Markdown 转义、缺失附件、损坏 JSON、CLI 和原文件保留。
- `npm --prefix automation run typecheck`：通过。
- 当前计划 2453 条、67 个场景组全部匹配中文目录，无遗漏。场景说明由已确认规格和执行脚本整理，不参与断言计算。
- `openspec validate localize-ui-test-reports --strict`：通过。

## 真实浏览器与报告生命周期

1. `npm run test:ui -- --workers 1 --grep 'behavior.table.add-clear-query-goto-end|category behavior.inputs.readonly-disabled|category basic.required@2026-10-07.1#1 |category extended.color@2026-10-07.1#1 '`：5 条实际执行，3 通过、2 失败，退出码 1。覆盖操作场景、非法候选、合法候选；两个失败均为已有新增分页问题。运行目录 `automation/output/2026-10-08T08-01-25-492Z-05ee712b`。
2. 调整为 onExit 生成中文报告后，复跑 1 个分页失败 + 1 个颜色通过：1 通过、1 失败，退出码 1；两份中文报告自动生成，包含已就绪的 HTML 链接。目录 `automation/output/2026-10-08T08-03-11-108Z-d15586e2`。
3. `npm run ui:plan`：2453 条计划，未操作浏览器，中文报告标记仅计划。最终目录 `automation/output/2026-10-08T08-03-07-444Z-80beeb41`。
4. 用自建子进程运行单条颜色用例（slow-mo 500），启动后向本次包装进程发送 SIGINT：退出码 130、1 条中断、complete=false；中文报告正常生成。目录 `automation/output/2026-10-08T08-04-10-747Z-9c261e26`。没有按进程名停止其他浏览器。

上述检查没有重新运行完整 2453 条，不将筛选检查当作全量回归通过。原有业务断言和 Vue 页面未改动。

## 历史结果补生成

```bash
npm run ui:report:zh -- --run automation/output/2026-10-08T05-22-57-609Z-a0544f31
```

两份中文报告准确显示计划 2453、通过 826、失败 2、中断 1、未执行 1624。失败分别发生在分类页和全部组件页的新增分页场景；颜色场景中断不计为产品失败。原始 40 个文件逐一计算 SHA-256，补生成前后内容一致。用户原先引用的 HTML data 下英文 Markdown 保留。

中文报告可读结论为“新增物料后仍停留在第 1 页，预期应跳到第 2 页”，附设计步骤、预期与实际、影响、截图、trace、执行步骤和实际字段附件。根因排查建议与自动提取事实分开。
