import { canonical, cloneJson, parseModel } from "../model.js";
import type { JsonValue } from "../types.js";
import { fingerprintReport } from "./discover.js";
import type { DiscoveryDraft, DiscoveryReport, DraftField, ReviewInput, ReviewedModel } from "./types.js";

function unique(values: JsonValue[]): JsonValue[] {
  return [...new Map(values.map((value) => [canonical(value), value])).values()];
}

export async function createDiscoveryDraft(report: DiscoveryReport): Promise<DiscoveryDraft> {
  if (report.schemaVersion !== 2 || report.artifactType !== "page-discovery" || !report.reportId || report.reportId !== await fingerprintReport(report)) throw new Error("发现报告格式或指纹不匹配");
  const fields = new Map<string, DraftField>();
  for (const snapshot of report.snapshots) for (const control of snapshot.controls) {
    if (control.category !== "field") continue;
    const identity = canonical({ pageUrl: snapshot.url, context: JSON.stringify(control.context), key: control.key, kind: control.kind, weakLabel: control.locator.basis === "structure" ? control.label : "" });
    let field = fields.get(identity);
    if (!field) {
      const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
      const sourceId = "field_" + Array.from(new Uint8Array(digest).slice(0, 10), (x) => x.toString(16).padStart(2, "0")).join("");
      const testId = /^\[data-testid="([a-zA-Z_][a-zA-Z0-9_.-]*)"\]$/.exec(control.locator.selector)?.[1];
      field = { sourceId, suggestedId: testId?.replace(/[-.]/g, "_") ?? sourceId, label: control.label, kind: control.kind,
        url: snapshot.url, context: cloneJson(control.context), locator: cloneJson(control.locator), observedIn: [], suggestedValues: [], observedOptions: [], observations: [],
        needsReview: ["确认字段是否属于本次测试范围", "确认有限值域及边界；当前观测不代表全部取值", "确认业务规则；本次未推导业务约束"] };
      fields.set(identity, field);
    }
    field.observedIn.push(snapshot.id);
    field.observations.push({ snapshotId: snapshot.id, currentValue: cloneJson(control.currentValue), valueKnown: control.valueKnown, multiple: control.multiple, disabled: control.disabled, readOnly: control.readOnly, required: control.required, attributes: cloneJson(control.attributes), optionCoverage: cloneJson(control.optionCoverage) });
    field.needsReview = [...new Set([...field.needsReview, ...control.notes])];
    if (control.optionCoverage) field.needsReview.push(`选项集合 ${control.optionCoverage.status}：${control.optionCoverage.reasons.join("；")}；必须确认业务全集来源`);
    if (control.required || Object.keys(control.attributes).some((key) => ["min", "max", "minlength", "maxlength", "pattern", "step"].includes(key))) field.needsReview.push("已观察 DOM 约束，但尚未确认为业务约束");
    if (["checkbox", "switch"].includes(control.kind)) field.suggestedValues.push(false, true);
    else if (control.multiple) {
      if (control.valueKnown) field.suggestedValues.push(cloneJson(control.currentValue));
      field.needsReview.push("多选需确认完整子集或拆为布尔因子，不将单个选项误作整个字段值");
    } else {
      field.suggestedValues.push(...control.options.filter((x) => x.valueKnown).map((x) => cloneJson(x.value)));
      if (control.valueKnown && control.currentValue !== null) field.suggestedValues.push(cloneJson(control.currentValue));
    }
    if (control.options.some((x) => !x.valueKnown)) field.needsReview.push("选项业务值未知，必须人工映射，不能直接使用显示标签");
    for (const option of control.options) {
      const key = canonical({ label: option.label, value: option.value, valueKnown: option.valueKnown });
      if (!field.observedOptions.some((x) => canonical({ label: x.label, value: x.value, valueKnown: x.valueKnown }) === key)) field.observedOptions.push(cloneJson(option));
    }
    field.suggestedValues = unique(field.suggestedValues);
    field.needsReview = [...new Set(field.needsReview)];
  }
  const result = [...fields.values()];
  if (new Set(result.map((x) => x.sourceId)).size !== result.length) throw new Error("发现字段标识冲突，不能安全生成草稿");
  // 同名字段可位于不同路由，不能默默合并为同一个配置因子。
  const idCounts = new Map<string, number>();
  for (const field of result) idCounts.set(field.suggestedId, (idCounts.get(field.suggestedId) ?? 0) + 1);
  for (const field of result) if (idCounts.get(field.suggestedId)! > 1) field.suggestedId = field.sourceId;
  return { schemaVersion: 2, artifactType: "unreviewed-configuration-draft", reportId: report.reportId, status: "needs-review", fields: result, businessRules: "not-inferred" };
}

export function createReviewTemplate(draft: DiscoveryDraft): ReviewInput {
  return {
    reportId: draft.reportId, confirmed: { scope: false, domains: false, businessRules: false }, modelId: "reviewed-page-model", version: "1",
    fields: draft.fields.map((field) => ({ sourceId: field.sourceId, include: false, id: field.suggestedId, values: cloneJson(field.suggestedValues) })), rules: [],
  };
}

/** 明确确认之后才构建正式模型；不打开页面、不执行枚举。 */
export async function compileReviewedModel(report: DiscoveryReport, input: unknown): Promise<ReviewedModel> {
  const draft = await createDiscoveryDraft(report);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("确认信息必须是对象");
  const review = input as ReviewInput;
  for (const key of Object.keys(review)) if (!["reportId", "confirmed", "modelId", "version", "fields", "rules"].includes(key)) throw new Error(`未知确认属性：${key}`);
  if (review.reportId !== report.reportId) throw new Error("确认文件不属于当前发现报告");
  if (!review.confirmed || review.confirmed.scope !== true || review.confirmed.domains !== true || review.confirmed.businessRules !== true) throw new Error("必须先确认测试范围、有限值域和业务规则，不能直接使用发现草稿");
  for (const key of Object.keys(review.confirmed)) if (!["scope", "domains", "businessRules"].includes(key)) throw new Error(`未知确认项：${key}`);
  if (!Array.isArray(review.fields)) throw new Error("确认字段必须为数组");
  const sources = new Map(draft.fields.map((x) => [x.sourceId, x]));
  const seen = new Set<string>();
  const fields = [];
  const mapping: ReviewedModel["mapping"] = { schemaVersion: 2, reportId: report.reportId, fields: [] };
  for (const field of review.fields) {
    if (!field || typeof field !== "object" || Array.isArray(field)) throw new Error("确认字段必须是对象");
    for (const key of Object.keys(field)) if (!["sourceId", "include", "id", "values"].includes(key)) throw new Error(`未知确认字段属性：${key}`);
    const source = sources.get(field.sourceId);
    if (!source || seen.has(field.sourceId)) throw new Error("确认字段来源未知或重复");
    seen.add(field.sourceId);
    if (typeof field.include !== "boolean") throw new Error("字段 include 必须为布尔值");
    if (!field.include) continue;
    if (["password", "file"].includes(source.kind)) throw new Error("密码或文件字段需单独的测试数据适配，本轮不转换");
    fields.push({ id: field.id, label: source.label, values: field.values });
    mapping.fields.push({ id: field.id, sourceId: source.sourceId, url: source.url, context: cloneJson(source.context), locator: cloneJson(source.locator), observedIn: [...source.observedIn] });
  }
  const model = parseModel({ id: review.modelId, version: review.version, fields, rules: review.rules });
  return { model, mapping };
}

export function renderDiscoveryReport(report: DiscoveryReport, draft: DiscoveryDraft): string {
  const clean = (value: unknown) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("|", "\\|").replace(/[\r\n]/g, " ");
  const where = (context: { url: string; framePath: unknown[] }) => `${context.framePath.length ? JSON.stringify(context.framePath) : "主文档"} · ${context.url}`;
  const state = { complete: "完整（当前声明集合）", partial: "部分", unknown: "未知" };
  const options = report.snapshots.flatMap(s => s.controls.filter(c => c.optionCoverage).map(c => {
    const o = c.optionCoverage!;
    return `| ${clean(s.id)} | ${clean(c.label)} | ${clean(where(c.context))} | ${state[o.status]} | ${o.observedCount} | ${o.totalCount ?? "未知"} | ${o.source} | ${clean(o.reasons.join("；"))} |`;
  }));
  const associations = report.snapshots.flatMap(s => s.associations.filter(a => a.step === s.afterStep).map(a => `| ${clean(s.id)} | ${clean(a.label)} | ${clean(where(a.context))} | ${clean(JSON.stringify(a.opener))} | ${clean(JSON.stringify(a.dialog))} | ${clean(JSON.stringify(a.parentDialog))} | 隐藏→可见 |`));
  const cells = report.snapshots.flatMap(s => s.cells.map(c => `| ${clean(s.id)} | ${clean(where(c.context))} | ${clean(c.rowKey ?? c.rowIndex ?? "未知")} | ${clean(c.columnKey ?? (c.columnLabel || c.columnIndex))} | ${clean(c.displayText)} | ${c.valueKnown ? clean(JSON.stringify(c.businessValue)) : "未知"} | ${c.displayTruncated ? "是" : "否"} |`));
  const documents = report.snapshots.flatMap(s => s.documents.map(d => `| ${clean(s.id)} | ${clean(where(d.context))} | ${d.status} | ${clean(d.reason ?? "—")} |`));
  return [
    "# 页面配置发现报告", "", `版本：2；计划：${clean(report.plan.id)}；执行状态：${report.status}；快照：${report.snapshots.length}；字段：${draft.fields.length}。`,
    "", "这是指定入口的观察报告，不是整个应用的完整模型，也不是测试通过报告。选项完整仅指当前 DOM/ARIA 声明集合，规则与业务值域仍须确认。", "", "## 入口执行", "",
    "| 场景 | 状态 | 已执行展开步骤 | 原因 |", "|---|---|---:|---|",
    ...report.scenes.map(s => `| ${clean(s.id)} | ${s.status} | ${s.completedSteps} | ${clean(s.reason ?? "—")} |`),
    "", "## 弹框关联", "", "| 快照 | 弹框名称 | 文档上下文 | 入口 | 目标弹框 | 父弹框 | 证据 |", "|---|---|---|---|---|---|---|", ...associations,
    "", "## 文档扫描", "", "| 快照 | Frame 路径及 URL | 状态 | 原因 |", "|---|---|---|---|", ...documents,
    "", "## 选项完整性", "", "| 快照 | 控件 | 上下文 | 状态 | 观测数 | 声明总数 | 来源 | 原因 |", "|---|---|---|---|---:|---:|---|---|", ...options,
    "", "## 单元格显示证据", "", "显示值不等于正确性结论；业务值仅来自显式 DOM JSON 声明，单元格不会自动成为配置因子。表、行、列及 Shadow 定位详见 report.json。", "",
    "| 快照 | 上下文 | 行 | 列 | 显示文本 | 显式业务值 | 显示截断 |", "|---|---|---|---|---|---|---|", ...cells,
    "", "## 候选字段", "", "| 来源标识 | 名称 | 类型 | 建议值数量 | 文档上下文 | 根内定位与 Shadow 路径 |", "|---|---|---|---:|---|---|",
    ...draft.fields.map(f => `| ${f.sourceId} | ${clean(f.label)} | ${f.kind} | ${f.suggestedValues.length} | ${clean(where(f.context))} | ${clean(JSON.stringify(f.locator))} |`),
    "", "## 限制与未探索项", "", ...report.limitations.map(x => `- ${x}`),
    ...report.snapshots.flatMap(s => s.warnings.map(w => `- ${clean(s.id)}：${clean(w)}`)),
    "", "候选值、选项与逐状态证据见 draft-model.json。确认模板默认不选择任何字段；确认值域和规则后再运行 config-review。旧版发现报告/计划不兼容，请重新发现。", "",
  ].join("\n");
}
