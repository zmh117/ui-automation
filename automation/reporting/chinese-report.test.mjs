import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describeCase } from "./catalog.mjs";
import { explainError, renderChineseReports, writeChineseReports, reportNames } from "./chinese-report.mjs";

const pagerId = "behavior.table.add-clear-query-goto-end";
const pagerError = 'Error: expect(locator).toHaveText(expected) failed\nLocator: getByTestId(\'section-table\').locator(\'.el-pager li.is-active\')\nExpected: "2"\nReceived: " 1 "\nTimeout: 4000ms';
const meta = (id = pagerId, classification = "behavior") => ({ modelVersion: "2026-10-07.1", route: "/#/table", region: "table", candidate: { id, classification }, paths: 1 });
function dataset(states, overrides = {}) {
  const cases = states.map((s, i) => ({ id: String(i), metadata: [meta()], title: ["case", String(i)] }));
  const results = cases.flatMap((c, i) => states[i] === "notRun" ? [] : [{ ...c, status: states[i], errors: states[i] === "failed" ? [pagerError] : [], steps: [], attachments: [] }]);
  const counts = Object.fromEntries(["passed", "failed", "timedOut", "skipped", "interrupted", "notRun"].map((s) => [s, states.filter((x) => x === s).length]));
  const complete = !counts.notRun && !counts.interrupted && !counts.skipped;
  return {
    plan: { cases, planned: states.length, modelVersion: "2026-10-07.1" }, results,
    invocation: { startedAt: "2026-10-08T05:22:57Z", mode: "execute" },
    summary: { planned: states.length, ...counts, mode: "execute", status: counts.interrupted ? "interrupted" : counts.failed || counts.timedOut ? "failed" : "passed", scope: "full-confirmed-catalog", complete, coverageComplete: complete, errors: [], ...overrides },
  };
}
function temp(t) {
  const dir = mkdtempSync(join(tmpdir(), "mes-zh-report-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function save(dir, data) {
  for (const [key, file] of [["plan", "plan.json"], ["summary", "summary.json"], ["invocation", "invocation.json"]])
    if (data[key]) writeFileSync(join(dir, file), JSON.stringify(data[key]));
  writeFileSync(join(dir, "results.jsonl"), data.results.map((r) => JSON.stringify(r)).join("\n"));
}

test("历史中断运行准确显示 826/2/1/1624，不称为全量完成", (t) => {
  const data = dataset([...Array(826).fill("passed"), "failed", "failed", "interrupted", ...Array(1624).fill("notRun")]);
  const out = renderChineseReports(data, temp(t));
  assert.equal(out.facts.planned, 2453);
  assert.equal(out.facts.complete, false);
  assert.match(out.summary, /2453 \| 826 \| 2 \| 0 \| 1 \| 0 \| 1624/);
  assert.match(out.failures, /运行被中断，该用例未完成/);
  assert.match(out.failures, /分页器仍选中第 1 页/);
  assert.match(out.failures, /用例设计，不能据此认定每一步都已执行/);
  assert.doesNotMatch(out.summary, /全部通过/);
});
test("通过、筛选、仅计划与非法候选含义分别表达", (t) => {
  const dir = temp(t), full = dataset(["passed"]);
  full.plan.cases[0].metadata[0] = meta("basic.required@2026-10-07.1#1", "invalid");
  assert.match(renderChineseReports(full, dir).summary, /完整确认目录，全部通过/);
  const filtered = renderChineseReports(dataset(["passed"], { scope: "filtered", coverageComplete: false }), dir);
  assert.match(filtered.summary, /所选用例全部通过/);
  assert.equal(filtered.facts.full, false);
  const plan = renderChineseReports(dataset(["notRun"], { mode: "plan", complete: false }), dir);
  assert.match(plan.failures, /仅生成执行计划/);
  assert.equal(plan.facts.allPassed, false);
});
test("缺失汇总或不一致时不根据通过数夸大结论", (t) => {
  const dir = temp(t), d = dataset(["passed"]);
  d.summary = null;
  assert.equal(renderChineseReports(d, dir).facts.complete, false);
  const bad = dataset(["failed"], { passed: 1, failed: 0, complete: true, status: "passed" });
  const out = renderChineseReports(bad, dir);
  assert.match(out.summary, /逐条证据为 0/);
  assert.equal(out.facts.allPassed, false);
});
test("超时、跳过和运行级错误均保留", (t) => {
  const out = renderChineseReports(dataset(["timedOut", "skipped"], { errors: ["服务器未启动"] }), temp(t));
  assert.match(out.failures, /用例执行超时/);
  assert.match(out.failures, /该用例被跳过/);
  assert.match(out.summary, /服务器未启动/);
  assert.equal(out.facts.complete, false);
});
test("分页解释须匹配错误签名，不能仅凭用例 ID", () => {
  const result = { status: "failed", errors: [`\u001b[31m${pagerError}\u001b[0m`] };
  assert.match(explainError(result, meta()).conclusion, /仍停留在第 1 页/);
  const other = { ...result, errors: ['Error: expect(locator).toHaveValue(expected) failed\nLocator: material-search\nExpected: ""\nReceived: "MAT-001"'] };
  assert.doesNotMatch(explainError(other, meta()).conclusion, /第 1 页/);
  assert.doesNotMatch(explainError(result, meta("another-case")).conclusion, /第 1 页/);
  assert.doesNotMatch(explainError({ ...other, errors: [...other.errors, pagerError] }, meta()).conclusion, /第 1 页/);
});
test("常见断言解析与未知错误降级，不编造实际状态", () => {
  const negative = explainError({ status: "failed", errors: ['Error: expect(locator).not.toHaveValue(expected) failed\nExpected: not "abc"\nReceived: "abc"'] }, meta());
  assert.match(negative.conclusion, /反向断言/);
  assert.equal(negative.actual, '"abc"');
  const missing = explainError({ status: "failed", errors: ['Error: expect(locator).toBeVisible() failed\nError: element(s) not found'] }, meta());
  assert.match(missing.actual, /未找到匹配元素/);
  const unknown = explainError({ status: "failed", errors: ["Unexpected driver error"] }, meta());
  assert.match(unknown.conclusion, /无法自动解释/);
  assert.match(unknown.actual, /未提取到/);
  assert.equal(unknown.raw, "Unexpected driver error");
});
test("离线生成保留原文件，附件路径支持空格及中文，缺失附件明确标注", (t) => {
  const dir = temp(t), data = dataset(["failed"]);
  const file = "artifacts/中文 截图.png";
  mkdirSync(join(dir, "artifacts"));
  writeFileSync(join(dir, file), "fixture");
  data.results[0].attachments = [
    { name: "screenshot", path: join(dir, file) }, { name: "trace", path: join(dir, "missing.zip") },
    { name: "实际页面与保存状态", text: JSON.stringify({ url: "local", fields: [{ id: "material-search", value: "", checked: false, disabled: false }], saved: null }) },
  ];
  save(dir, data);
  const original = readFileSync(join(dir, "results.jsonl"));
  const files = writeChineseReports(dir), contents = files.map((f) => readFileSync(f, "utf8"));
  assert.deepEqual(readFileSync(join(dir, "results.jsonl")), original);
  assert.match(contents[1], /artifacts\/%E4%B8%AD%E6%96%87%20%E6%88%AA%E5%9B%BE.png/);
  assert.match(contents[1], /证据文件缺失/);
  assert.match(contents[1], /物料搜索/);
  assert.doesNotMatch(contents[1], /\]\(<missing.zip/);
  assert.deepEqual(writeChineseReports(dir).map((f) => readFileSync(f, "utf8")), contents);
});
test("损坏 JSONL 以中文失败，不覆盖已有报告", (t) => {
  const dir = temp(t);
  save(dir, dataset(["passed"]));
  writeFileSync(join(dir, reportNames[0]), "先前报告");
  writeFileSync(join(dir, "results.jsonl"), '{"id":');
  assert.throws(() => writeChineseReports(dir), /第 1 行损坏/);
  assert.equal(readFileSync(join(dir, reportNames[0]), "utf8"), "先前报告");
});
test("不合法结果状态与重复计划 ID 拒绝汇总", (t) => {
  const d = dataset(["passed"]), dir = temp(t);
  d.results[0].status = "mystery";
  assert.throws(() => renderChineseReports(d, dir), /未知状态/);
  d.plan.cases.push(d.plan.cases[0]);
  assert.throws(() => renderChineseReports(d, dir), /标识重复/);
});
test("未知场景或模型版本给出明确提示，候选值不会破坏 Markdown", (t) => {
  assert.equal(describeCase(meta("new-case")).known, false);
  assert.equal(describeCase({ ...meta(), modelVersion: "future" }).known, false);
  const d = dataset(["failed"]);
  d.plan.cases[0].metadata[0].candidate.values = { raw: "<script>|[a](b)\n```" };
  d.results[0].errors = ["unknown\n```\n<script>"];
  const text = renderChineseReports(d, temp(t)).failures;
  assert.match(text, /&lt;script&gt;/);
  assert.match(text, /\\\|/);
  assert.match(text, /````text/);
});
test("CLI 不重新执行 UI，支持离线目录并以中文报告输入错误", (t) => {
  const dir = temp(t);
  save(dir, dataset(["passed"]));
  const script = fileURLToPath(new URL("../scripts/report-zh.mjs", import.meta.url));
  const success = spawnSync(process.execPath, [script, "--run", dir], { encoding: "utf8" });
  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /已生成/);
  const bad = spawnSync(process.execPath, [script, "--run", join(dir, "不存在")], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /缺少必需文件/);
});
