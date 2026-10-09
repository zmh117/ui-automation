import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, relative, basename } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { describeCase, fieldNames, groupId, pageName, pageNames } from "./catalog.mjs";

export const reportNames = ["中文测试报告.md", "中文失败报告.md"];
const statuses = { passed: "通过", failed: "失败", timedOut: "超时", interrupted: "中断", skipped: "跳过", notRun: "未执行" };
const classifications = { valid: "合法配置", invalid: "非法配置（验证 UI 拦截或修正）", behavior: "操作场景" };
const matchers = {
  toHaveText: "文本应与预期一致", toContainText: "文本应包含预期内容", toHaveValue: "输入值应与预期一致",
  toBeVisible: "元素可见状态应符合预期", toBeHidden: "元素应隐藏", toBeEnabled: "元素可用/禁用状态应符合预期", toBeDisabled: "元素应禁用",
  toBeChecked: "选中状态应符合预期", toBeFocused: "元素应获得焦点", toBeInViewport: "元素应在可视区域内",
  toHaveCount: "元素数量应符合预期", toHaveAttribute: "元素属性应符合预期", toHaveClass: "元素样式状态应符合预期",
  toHaveURL: "页面地址应符合预期", toHaveTitle: "页面标题应符合预期", toEqual: "实际数据应等于预期数据",
  toBe: "实际值应等于预期值", toMatchObject: "实际对象应包含预期字段", toHaveLength: "数据长度应符合预期",
  toBeNull: "实际值应为空", toBeGreaterThan: "实际值应大于下限", toBeGreaterThanOrEqual: "实际值应不小于下限",
  toBeLessThanOrEqual: "实际值应不大于上限", toMatch: "实际值应符合格式", toBeTruthy: "条件应成立",
};
const clean = (s) => stripVTControlCharacters(String(s ?? ""));
export const markdown = (s) => clean(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/[\\`*_[\]{}|#!]/g, "\\$&").replace(/\r?\n/g, "<br>");
const literal = (v) => v === undefined ? "未记录" : JSON.stringify(v);
const value = (v) => markdown(literal(v));
function fence(text) {
  const source = clean(text), ticks = "`".repeat(Math.max(3, ...[...source.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  return `${ticks}text\n${source}\n${ticks}`;
}
const href = (path) => path.split(/[\\/]/).map(encodeURIComponent).join("/");
const link = (label, path) => `[${markdown(label)}](<${href(path)}>)`;
const details = (label, content) => `<details>\n<summary>${markdown(label)}</summary>\n\n${content}\n\n</details>`;
function table(headers, rows) {
  return [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}
function flatten(steps = []) { return steps.flatMap((s) => [s, ...flatten(s.steps)]); }

export function explainError(result, meta) {
  if (result.status === "interrupted") return {
    conclusion: "运行被中断，该用例未完成，不能据此判断页面是否正确。",
    expected: "用例应完整执行到所有检查结束", actual: "执行中断",
    impact: "本场景尚未得到完整验证；需要重新运行。", raw: clean((result.errors ?? []).join("\n\n")),
  };
  if (result.status === "skipped") return {
    conclusion: "该用例被跳过，没有完整验证结果。", expected: "执行本用例", actual: "跳过",
    impact: "覆盖存在缺口；需检查跳过原因。", raw: clean((result.errors ?? []).join("\n\n")),
  };
  const raw = clean((result.errors?.length ? result.errors : flatten(result.steps).filter((s) => s.error).map((s) => s.error)).join("\n\n"));
  const primary = clean(result.errors?.[0] ?? flatten(result.steps).find((s) => s.error)?.error ?? "");
  const matcher = primary.match(/\b(to[A-Z]\w+)\(/)?.[1];
  const negated = /\.not\.to[A-Z]/.test(primary);
  const read = (pattern) => primary.match(pattern)?.[1]?.trim();
  const expected = read(/^Expected(?:\s+(?:string|substring|pattern|length))?:\s*(.+)$/mi);
  const actual = read(/^Received(?:\s+(?:string|value|length))?:\s*(.+)$/mi);
  const locator = read(/^Locator:\s*(.+)$/mi);
  const timeout = read(/^Timeout:\s*(.+)$/mi);
  const normalized = (s) => { try { return String(JSON.parse(s)).trim(); } catch { return s?.trim(); } };
  // 必须同时命中断言内容；同一场景可能先在搜索清空或导航处失败。
  const pagination = meta?.candidate?.id === "behavior.table.add-clear-query-goto-end" &&
    matcher === "toHaveText" && !negated && locator?.includes(".el-pager li.is-active") &&
    normalized(expected) === "2" && normalized(actual) === "1";
  if (pagination) return {
    conclusion: "新增物料后仍停留在第 1 页，预期应跳到第 2 页。",
    expected: "分页器选中第 2 页", actual: "分页器仍选中第 1 页", locator, timeout, raw,
    impact: "新增的第 6 行位于第 2 页，当前没有自动定位过去，用户需要手动翻页才能继续编辑。该断言不证明新增数据丢失。",
    hint: "排查线索：检查“搜索条件变化时回第 1 页”与“新增后跳到末页”两段逻辑的执行顺序。此处是诊断建议；报告生成器未核验源码根因。",
  };
  const known = matchers[matcher];
  return {
    conclusion: result.status === "timedOut" ? "用例执行超时，未能完成全部检查。" : known
      ? `检查未通过：${negated ? "反向断言（要求不满足以下条件）：" : ""}${known}。`
      : "执行未通过，当前报告无法自动解释该错误的具体业务原因。",
    expected: expected ?? (known ? `${negated ? "不满足：" : ""}${known}` : "无法自动提取，请查看下面的原始技术记录"),
    actual: actual ?? (/element\(s\) not found/i.test(primary) ? "在等待期限内未找到匹配元素" : "未提取到明确实际值，请结合原始记录与现场截图排查"),
    locator, timeout, raw,
    impact: "该检查点尚未满足预期；需结合截图和 trace 判断是页面行为、定位方式还是运行环境问题，不能仅凭失败状态判定产品缺陷。",
  };
}

function stepText(step) {
  const s = clean(step.title);
  const assertion = s.match(/^Expect(?:\s+\"([^\"]+)\")?/);
  if (assertion) return `检查：${matchers[assertion[1]] ?? "核对断言（具体对象见原始记录）"}`;
  const actions = [
    [/^Navigate\b/, "打开页面"], [/^Reload\b/, "刷新页面"], [/^Click\b/, "点击控件"],
    [/^Fill\b/, "填写输入框"], [/^Check\b/, "勾选"], [/^Uncheck\b/, "取消勾选"],
    [/^Set checked\b/i, "设置选中状态"], [/^Press\b/, "按键"], [/^Hover\b/, "鼠标移入"],
    [/^Select option\b/i, "选择选项"], [/^Set input files\b/i, "选择文件"],
    [/^Evaluate\b/, "读取页面状态"], [/^Attach\b/, "记录附件"],
  ];
  for (const [pattern, label] of actions) if (pattern.test(s)) return s.replace(pattern, label);
  return /[\u3400-\u9fff]/.test(s) ? s : `操作记录：${s}（详细对象见 trace）`;
}
function executionSteps(result) {
  // Hooks 是环境准备和收尾，不把它们当成业务操作。
  const steps = flatten((result.steps ?? []).filter((s) => s.category !== "hook" && !/Hooks|Worker Cleanup/.test(s.title)))
    .filter((s) => !s.steps?.length);
  if (!steps.length) return "没有可用的操作步骤记录。";
  const selected = steps.slice(0, 120);
  const rows = selected.map((s, i) => [i + 1, markdown(stepText(s)), s.error ? "此步骤报错" : "已记录（无步骤错误）"]);
  return `${table(["顺序", "执行记录的中文说明", "记录状态"], rows)}\n\n步骤名称不一定包含控件目标；精确目标与时间顺序以 trace 为准。${steps.length > 120 ? `仅展示前 120 步，其余 ${steps.length - 120} 步见 results.jsonl。` : ""}`;
}
function attachmentPath(dir, attachment) {
  if (!attachment.path) return null;
  const path = resolve(dir, attachment.path);
  return existsSync(path) ? relative(dir, path) : null;
}
function evidence(dir, result) {
  const labels = { screenshot: "失败时页面截图", trace: "操作轨迹 trace", "error-context": "原始英文页面快照" };
  const rows = [], previews = [];
  for (const a of result.attachments ?? []) {
    if (!a.path) continue;
    const p = attachmentPath(dir, a);
    rows.push(p ? `- ${link(labels[a.name] ?? a.name, p)}` : `- ${markdown(labels[a.name] ?? a.name)}：证据文件缺失（${markdown(a.path)}）`);
    if (p && a.name === "screenshot") previews.push(`![失败时页面截图](<${href(p)}>)`);
  }
  if (!rows.length) rows.push("未记录截图或 trace 附件；请查阅原始结果。");
  if (result.attachments?.some((a) => a.name === "trace" && attachmentPath(dir, a)))
    rows.push("\ntrace 是操作回放文件。可从 Playwright HTML 报告打开，或在 automation 目录运行 npx playwright show-trace 后面的 trace.zip 路径。");
  return [...rows, ...previews].join("\n\n");
}
function observation(result) {
  const a = result.attachments?.find((a) => a.name === "实际页面与保存状态" && a.text);
  if (!a) return "未记录实际页面与保存状态附件。";
  let data;
  try { data = JSON.parse(a.text); } catch { return "实际页面附件格式损坏，无法展开；请查阅 results.jsonl。"; }
  if (!Array.isArray(data.fields)) return "实际页面附件未包含可识别的字段列表。";
  const rows = data.fields.map((f, i) => [markdown(fieldNames[f.id] ?? f.id ?? `无标识字段 ${i + 1}`), value(f.value), f.checked === undefined ? "—" : f.checked ? "是" : "否", f.disabled ? "是" : "否"]);
  return `采集地址：${markdown(data.url)}。此附件为测试收尾时的只读观察，不一定与截图同一瞬间，也不证明此前每步正确。\n\n${table(["字段", "实际值", "选中", "禁用"], rows)}\n\nlocalStorage：${data.saved === null ? "未保存记录" : data.saved === undefined ? "未记录" : "存在保存记录；完整原文见 results.jsonl 中同名附件"}。`;
}

function readJSON(dir, name, required = false) {
  const path = resolve(dir, name);
  if (!existsSync(path)) {
    if (required) throw new Error(`缺少必需文件：${path}`);
    return null;
  }
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error(`无法读取 JSON 文件：${path}；请保留原始证据并检查文件是否完整`); }
}
export function loadRun(dir) {
  const plan = readJSON(dir, "plan.json", true), summary = readJSON(dir, "summary.json"), invocation = readJSON(dir, "invocation.json");
  const results = [];
  const path = resolve(dir, "results.jsonl");
  if (existsSync(path)) for (const [i, line] of readFileSync(path, "utf8").split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try { results.push(JSON.parse(line)); }
    catch { throw new Error(`results.jsonl 第 ${i + 1} 行损坏；无法可靠生成报告，请保留原始文件`); }
  }
  return { plan, summary, invocation, results };
}
function countsFor(items) {
  const counts = Object.fromEntries(Object.keys(statuses).map((s) => [s, 0]));
  for (const item of items) counts[item.result?.status ?? "notRun"]++;
  return counts;
}
const metadata = (c) => c?.metadata?.[0] ?? {};
function facts(data) {
  const { plan, results, summary, invocation } = data, warnings = [];
  if (!Array.isArray(plan?.cases) || plan.cases.some((c) => !c?.id)) throw new Error("plan.json 缺少有效的用例清单");
  if (new Set(plan.cases.map((c) => c.id)).size !== plan.cases.length) throw new Error("plan.json 用例标识重复，无法可靠汇总");
  const byId = new Map();
  for (const r of results) {
    if (!r?.id || !(r.status in statuses) || r.status === "notRun") throw new Error("results.jsonl 含有未知状态或缺失用例标识");
    if (byId.has(r.id)) warnings.push(`用例 ${r.id} 有多次结果；表内计入最后一次，历史记录仍在原文件。`);
    byId.set(r.id, r);
  }
  const items = plan.cases.map((c) => ({ ...c, meta: metadata(c), result: byId.get(c.id) }));
  const ids = new Set(items.map((c) => c.id));
  for (const id of byId.keys()) if (!ids.has(id)) warnings.push(`结果 ${id} 不在计划内，未计入计划覆盖统计。`);
  const counts = countsFor(items), planned = items.length;
  if (plan.planned !== planned) warnings.push("plan.json 的计划总数与用例清单不一致。");
  if (!summary) warnings.push("缺少 summary.json，运行可能尚未结束或未正常收尾，不能认定完成。");
  else {
    for (const [key, actual] of Object.entries({ planned, ...counts }))
      if (summary[key] !== actual) warnings.push(`汇总中的 ${statuses[key] ?? "计划"} 数量为 ${summary[key]}，逐条证据为 ${actual}；以下以逐条证据为准。`);
  }
  const smoke = summary?.smoke ?? plan.smoke;
  if (smoke && !smoke.verified) warnings.push("冒烟选例未通过覆盖核验，不能认定冒烟完成。");
  const planOnly = summary?.mode === "plan" || invocation?.mode === "plan";
  const complete = !planOnly && !!summary?.complete && !warnings.length && planned > 0 &&
    !counts.notRun && !counts.skipped && !counts.interrupted && !summary?.errors?.length && !["interrupted", "timedout"].includes(summary?.status);
  const scope = summary?.scope ?? "unknown";
  const full = complete && !smoke && scope === "full-confirmed-catalog" && summary?.coverageComplete === true;
  const smokeComplete = complete && scope === "smoke-confirmed-catalog" && !!smoke?.verified && summary?.smokeComplete === true && planned === smoke.planned;
  const allPassed = complete && counts.passed === planned && summary?.status === "passed";
  let conclusion = planOnly ? "本次仅生成执行计划，没有操作页面，也没有通过或失败结论。"
    : warnings.length ? "执行证据不完整或存在不一致，不能认定本次验证完成。"
      : !complete ? "本次运行未完成，不能作为完整覆盖的验收结果。"
        : allPassed ? full ? "本次已执行完整确认目录，全部通过。" : smokeComplete ? "本次冒烟清单全部通过；不代表全量配置已验证。" : "本次所选用例全部通过；这不代表完整确认目录已验证。"
          : `本次所选用例已执行结束，存在 ${counts.failed} 条失败、${counts.timedOut} 条超时。`;
  return { items, counts, planned, warnings, planOnly, scope, complete, full, smoke, smokeComplete, allPassed, conclusion };
}
const scopeNames = { "full-confirmed-catalog": "完整确认目录（分组全量 + 明确操作场景）", "smoke-confirmed-catalog": "PICT 冒烟（组内合法 n-way + 非法代表/边界 + 操作场景）", filtered: "筛选后的用例范围", "direct-unverified-selection": "直接运行，未确认是否选择完整目录", unknown: "范围信息缺失" };
function timestamp(value) {
  if (!value || Number.isNaN(Date.parse(value))) return "未记录";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "medium", hour12: false }).format(new Date(value)) + "（北京时间）";
}
function failedCase(dir, item, index) {
  const { result, meta } = item, scene = describeCase(meta), error = explainError(result, meta), candidate = meta.candidate ?? {};
  const params = Object.entries(candidate.values ?? {});
  return [
    `<a id="case-${index}"></a>\n\n## ${index}. ${markdown(scene.title)} — ${statuses[result.status]}`,
    `**结论：${markdown(error.conclusion)}**`,
    `页面：${markdown(pageName(meta.route))}；区域：${markdown(pageNames[meta.region] ?? meta.region)}；用例类型：${markdown(classifications[candidate.classification] ?? "未记录")}。`,
    `用例标识：${value(candidate.id)}；执行标识：${value(item.id)}。`,
    `### 场景设计与复现步骤\n\n以下是用例设计，不能据此认定每一步都已执行。\n\n${scene.steps.map((s, i) => `${i + 1}. ${markdown(s)}`).join("\n")}\n\n整体预期：${markdown(scene.expected)}。`,
    ...(params.length ? [`### 本次候选输入\n\n${table(["字段", "原始目标值"], params.map(([k, v]) => [markdown(fieldNames[k] ?? k), value(v)]))}\n\n原始目标值可能被 UI 拒绝或修正，不等于最终保存值。`] : []),
    `### 实际检查结果\n\n${table(["项目", "记录"], [["预期", markdown(error.expected)], ["实际", markdown(error.actual)], ...(error.timeout ? [["等待上限", markdown(error.timeout)]] : []), ...(error.locator ? [["技术定位信息", markdown(error.locator)]] : [])])}`,
    `影响：${markdown(error.impact)}${error.hint ? `\n\n${markdown(error.hint)}` : ""}`,
    `### 现场证据\n\n${evidence(dir, result)}`,
    details("展开实际操作记录（中文）", executionSteps(result)),
    details("展开收尾时的实际字段值", observation(result)),
    details("展开原始技术错误（保留英文，供开发排查）", error.raw ? fence(error.raw) : "没有错误文本；请结合执行状态和原始结果判断。"),
  ].join("\n\n");
}

export function renderChineseReports(data, dir) {
  const f = facts(data), { summary, invocation } = data;
  const counts = table(["计划", ...Object.values(statuses)], [[f.planned, ...Object.keys(statuses).map((s) => f.counts[s])]]);
  const warnings = f.warnings.length ? `证据提醒：\n\n${f.warnings.map((w) => `- ${markdown(w)}`).join("\n")}` : "";
  const globalErrors = summary?.errors?.length ? `### 运行级错误\n\n${details("展开原始运行错误", fence(summary.errors.join("\n\n")))}` : "";
  const smokeInfo = f.smoke ? [
    `**冒烟强度：${f.smoke.requestedWay}-way**。完整候选目录 ${f.smoke.fullPlanned} 次执行，冒烟清单 ${f.smoke.planned} 次；本次实际选择 ${f.planned} 次。`,
    `配置候选：${f.smoke.selectedValid} 个合法、${f.smoke.selectedInvalid} 个非法；保留 ${f.smoke.behaviorExecutions} 条操作场景。组内不足 N 个字段时使用全部字段的强度。`,
    `选例覆盖核验：${f.smoke.verified ? "已通过" : "未通过"}；整个冒烟执行完成：${f.smokeComplete ? "是" : "否"}。选例覆盖是输入组合的静态核验，不等于页面断言通过，也不等于全量回归完成。`,
  ].join("\n\n") : "";
  const intro = [
    `**${f.conclusion}**`, counts,
    `运行目录：${markdown(basename(dir))}。范围：${scopeNames[f.scope] ?? markdown(f.scope)}。模型版本：${markdown(data.plan.modelVersion ?? "未记录")}。`,
    `开始：${timestamp(invocation?.startedAt)}；结束：${timestamp(summary?.finishedAt)}。`,
    "“非法配置”指输入目标不符合规则；测试通过表示页面按预期拒绝或修正它。中断、跳过和未执行不等于产品缺陷。",
    smokeInfo, warnings, globalErrors,
  ].filter(Boolean).join("\n\n");
  const issues = f.items.filter((c) => c.result && c.result.status !== "passed");
  const issueTable = issues.length ? table(["编号", "页面", "场景", "结果"], issues.map((c, i) => [
    `[${i + 1}](<${href(reportNames[1])}#case-${i + 1}>)`,
    markdown(pageName(c.meta.route)), markdown(describeCase(c.meta).title), statuses[c.result.status],
  ])) : f.planOnly ? "本次仅生成计划，没有失败判断。" : "已记录结果中没有失败、超时、中断或跳过；请同时查看未执行数量及证据提醒。";
  const grouped = new Map();
  for (const c of f.items) {
    const key = JSON.stringify([c.meta.route, groupId(c.meta.candidate?.id)]);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(c);
  }
  const groups = table(["页面", "场景", "计划", ...Object.values(statuses)], [...grouped.values()].map((items) => {
    const c = countsFor(items);
    return [markdown(pageName(items[0].meta.route)), markdown(describeCase(items[0].meta).title), items.length, ...Object.keys(statuses).map((s) => c[s])];
  }));
  const reviewLink = existsSync(resolve(dir, "冒烟选例说明.md")) ? link("冒烟选例说明", "冒烟选例说明.md") : "本次主运行目录内的冒烟选例说明";
  const smokeCoverage = f.smoke ? `## 冒烟分组覆盖\n\n${table(["组", "实际强度", "PICT 合法行", "补充后候选", "可行元组", "已覆盖"], (f.smoke.groups ?? []).map((g) => [markdown(g.id), g.effectiveWay, g.pictRows, g.selected, g.requiredTuples, g.coveredTuples]))}\n\n详细候选值、负向规则和选中原因见${reviewLink}。\n\n` : "";
  const files = ["plan.json", "results.jsonl", "summary.json", "invocation.json", "smoke.json", "冒烟选例说明.md", "html/index.html"]
    .filter((p) => existsSync(resolve(dir, p))).map((p) => link(p === "html/index.html" ? "Playwright HTML 报告（含截图与 trace 入口）" : p, p)).join(" · ");
  const source = `由已确认场景说明和本次执行证据生成，不调用 Agent 或大模型。场景说明帮助理解，实际判定以测试断言为准。原始记录保持不变。\n\n${files}\n\nHTML 报告建议在 automation 目录使用 npx playwright show-report 打开；参数为本次运行目录下的 html 文件夹。`;
  return {
    summary: `# 中文测试报告\n\n${intro}\n\n## 需要关注的用例\n\n${issueTable}\n\n${link("打开中文失败报告", reportNames[1])}\n\n${smokeCoverage}## 按页面与场景汇总\n\n${groups}\n\n未执行的具体用例可按 plan.json 与 results.jsonl 中的执行标识对应查找；不将未执行项展开为失败。\n\n## 报告依据\n\n${source}\n`,
    failures: `# 中文失败报告\n\n${intro}\n\n${link("返回中文测试报告", reportNames[0])}\n\n${issues.length ? issues.map((c, i) => failedCase(dir, c, i + 1)).join("\n\n---\n\n") : issueTable}\n\n## 报告依据\n\n${source}\n`,
    facts: f,
  };
}

export function writeChineseReports(runDir) {
  const dir = resolve(runDir), output = renderChineseReports(loadRun(dir), dir);
  // 全部解析与渲染成功后才写入；只更新这两个中文文件。
  const files = reportNames.map((name) => resolve(dir, name));
  writeFileSync(files[0], output.summary, "utf8");
  writeFileSync(files[1], output.failures, "utf8");
  return files;
}
