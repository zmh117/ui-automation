import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { markdown } from "../reporting/chinese-report.mjs";
import { describeCase, pageName } from "../reporting/catalog.mjs";

export function writeSmokeReview(selection, directory) {
  const lines = [
    "# 冒烟选例说明", "",
    `请求强度：**${selection.requestedWay}-way**；各组实际强度为请求值与字段数的较小值。`, "",
    `原目录 ${selection.fullPlanned} 次执行，选出 ${selection.planned} 次：${selection.configurationExecutions} 次配置执行（${selection.selectedValid} 个合法候选、${selection.selectedInvalid} 个非法候选在各入口执行）＋ ${selection.behaviorExecutions} 条操作场景。`, "",
    "选择已经通过静态覆盖核验，尚不代表 UI 测试通过。合法 n-way 由微软 PICT 生成；负向和边界由补充策略保留。所有取消、恢复、分页等明确操作场景保持原样。", "",
    "字段数不足 N 时覆盖全部合法完整组合；单字段保留全部样本。非法代表优先只违反一条规则，再补齐每个字段的每个已确认样本。这不覆盖所有非法组合，也不保证无限输入或任意操作顺序。", "",
    `引擎：${markdown(selection.engine.tag ?? "自定义 PICT")}；源码提交：${markdown(selection.engine.revision ?? "未提供")}；固定种子：${selection.seed}。`,
    `二进制 SHA-256：${selection.engine.sha256}`, "",
    "## 分组覆盖", "",
    "| 组 | 字段数 | 实际强度 | 全部候选 | 合法候选 | PICT 选中 | 补充后选中 | 可行元组 | 已覆盖 | 状态 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...selection.groups.map((g) => `| ${markdown(g.id)} | ${g.fields.length} | ${g.effectiveWay} | ${g.totalCandidates} | ${g.legalCandidates} | ${g.pictRows} | ${g.selected} | ${g.requiredTuples} | ${g.coveredTuples} | ${g.status === "no-legal-configurations" ? "无合法配置，仅负向补充" : "覆盖已核验"} |`),
    "", "## 每组所选配置与理由", "",
  ];
  for (const g of selection.groups) {
    const first = selection.cases.find((c) => c.metadata[0].candidate.id === g.rows[0]?.candidate.id);
    lines.push(`### ${markdown(first ? describeCase(first.metadata[0]).title : g.id)}`, "",
      `原始模型、值映射与输出位于 [${g.evidence}](<${g.evidence}/>)。${g.status === "no-legal-configurations" ? "该组没有合法配置，不调用 PICT，也不会伪造输出。" : ""}`, "",
      "| 候选 ID | 类型 | 原始输入 | 选中理由 | 实际违规规则 |", "| --- | --- | --- | --- | --- |",
      ...g.rows.map(({ candidate: c, reasons }) => `| ${markdown(c.id)} | ${c.classification === "valid" ? "合法" : "非法"} | ${markdown(JSON.stringify(c.values))} | ${markdown(reasons.join("；"))} | ${markdown(c.violations.map((v) => v.ruleId).join("、") || "无")} |`), "");
  }
  lines.push("## 保留的操作场景", "", "| 页面 | 场景 | 标识 |", "| --- | --- | --- |");
  for (const row of selection.cases.filter((r) => r.metadata[0].candidate.classification === "behavior")) {
    const m = row.metadata[0];
    lines.push(`| ${markdown(pageName(m.route))} | ${markdown(describeCase(m).title)} | ${markdown(m.candidate.id)} |`);
  }
  lines.push("", "完整机器清单见 [smoke.json](smoke.json)；浏览器执行后查看 [中文测试报告](<中文测试报告.md>)。", "");
  writeFileSync(resolve(directory, "冒烟选例说明.md"), lines.join("\n"));
}
