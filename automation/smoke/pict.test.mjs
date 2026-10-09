import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createEnumeration } from "@mes-ui/config-enumerator";
import { buildPictModel, canonical, generateGroup, inspectGroup, parsePictRows, resolvePictBinary, validateWay, verifyTupleCoverage } from "./pict.mjs";
import { createSmokeSelection, selectCandidates, verifyExecutionSelection, catalogGroups } from "./selection.mjs";
import { runProcess } from "./process.mjs";

const binary = resolvePictBinary(); // 没有真实 PICT 就失败，不能跳过引擎验收。
function dir(t) {
  const path = mkdtempSync(resolve(tmpdir(), "mes-pict-"));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
function candidates(id, values, rules = []) {
  return [...createEnumeration({ id, version: "test", fields: Object.entries(values).map(([id, values]) => ({ id, values })), rules }).cases];
}
const bool = [false, true];
const abcd = candidates("abcd", { a: bool, b: bool, c: bool, d: bool }, [
  { id: "ab", message: "AB互斥", when: { op: "eq", field: "a", value: true }, assert: { op: "eq", field: "b", value: false } },
  { id: "cd", message: "C依赖D", when: { op: "eq", field: "c", value: true }, assert: { op: "eq", field: "d", value: true } },
]);
function independentCovered(all, selected, fields, n) {
  function combinations(items, n) {
    if (!n) return [[]];
    return items.flatMap((f, i) => combinations(items.slice(i + 1), n - 1).map((rest) => [f, ...rest]));
  }
  for (const fs of combinations(fields, n)) {
    const selectedTuples = new Set(selected.map((c) => JSON.stringify(fs.map((f) => c.values[f]))));
    for (const c of all) assert.ok(selectedTuples.has(JSON.stringify(fs.map((f) => c.values[f]))));
  }
}
test("真实 PICT：A/B/C/D 约束下 1/2/3/4-way 与超字段数", async (t) => {
  const legal = abcd.filter((c) => c.classification === "valid");
  assert.equal(legal.length, 9);
  for (const way of [1, 2, 3, 4, 99]) {
    const g = await generateGroup(abcd, { way, binary, directory: resolve(dir(t), "group") });
    const selectedLegal = g.rows.map((r) => r.candidate).filter((c) => c.classification === "valid");
    independentCovered(legal, selectedLegal, ["a", "b", "c", "d"], Math.min(way, 4));
    assert.equal(g.requiredTuples, g.coveredTuples);
    assert.ok(g.rows.some((r) => r.candidate.violations.some((v) => v.ruleId === "ab")));
    assert.ok(g.rows.some((r) => r.candidate.violations.some((v) => v.ruleId === "cd")));
    assert.equal(g.selectedInvalid, 2);
    if (way >= 4) assert.equal(g.pictRows, 9);
  }
});
test("相同种子可复现，保留原 ID 和原始类型", async (t) => {
  const input = candidates("special", {
    text: ["", "中文,|~\n\t\"", "00", 0, false, null],
    list: [[], ["a", "b"], { x: "中", y: 2 }],
  });
  const one = await generateGroup(input, { way: 2, binary, directory: dir(t) });
  const two = await generateGroup(input, { way: 2, binary, directory: dir(t) });
  assert.deepEqual(one, two);
  assert.equal(one.selected, input.length);
  for (const row of one.rows) assert.deepEqual(row.candidate, input.find((c) => c.id === row.candidate.id));
});
test("单字段全部样本、全非法与单值固定字段可运行", async (t) => {
  const single = candidates("single", { raw: ["", "99", "100", "101"] });
  assert.equal((await generateGroup(single, { way: 3, binary, directory: dir(t) })).selected, 4);
  const bad = candidates("bad", { raw: ["abc", "1e3", "-1"] }, [{ id: "invalid", message: "非法格式", assert: { op: "eq", field: "raw", value: "never" } }]);
  const g = await generateGroup(bad, { way: 2, binary: "/does-not-exist", directory: dir(t) });
  assert.equal(g.status, "no-legal-configurations");
  assert.equal(g.pictRows, 0); assert.equal(g.selectedInvalid, 3);
  const constant = candidates("constant", { x: [1], y: [true] });
  assert.equal((await generateGroup(constant, { way: 2, binary, directory: dir(t) })).pictRows, 1);
});
test("非法专用边界全部补齐；同一规则不同样本不会全部丢弃", async (t) => {
  const input = candidates("boundary", { count: ["0", "1", "9999", "10000", "", "   "], mode: ["a", "b"] }, [
    { id: "range", message: "范围", assert: { op: "in", field: "count", values: ["0", "1", "9999"] } },
  ]);
  const g = await generateGroup(input, { way: 1, binary, directory: dir(t) });
  assert.deepEqual(new Set(g.rows.map((r) => r.candidate.values.count)), new Set(input.map((c) => c.values.count)));
  assert.equal(g.selectedInvalid, 3);
});
test("未知值、非法输出、空覆盖与不完整目录均拒绝", () => {
  const encoded = buildPictModel(abcd, 2);
  assert.throws(() => parsePictRows("bad\nV0", encoded), /表头/);
  assert.throws(() => parsePictRows("P0\tP1\tP2\tP3\nXX\tV0\tV0\tV0", encoded), /未知值/);
  assert.throws(() => parsePictRows("P0\tP1\tP2\tP3\nV1\tV1\tV0\tV0", encoded), /非法/);
  assert.throws(() => verifyTupleCoverage(encoded.legal, [], encoded.fields, 2), /覆盖不足/);
  assert.throws(() => inspectGroup(abcd.slice(1)), /不是完整/);
});
function planFor(input) {
  const behavior = { id: "behavior.table.add-clear-query-goto-end", classification: "behavior" };
  const cases = ["/#/table", "/#/all"].flatMap((route) => [...input, behavior].map((candidate) => ({ metadata: [{ route, region: "table", modelVersion: "test", candidate, paths: 1 }] })));
  return { modelVersion: "test", coverage: "group-exhaustive-and-explicit-behaviors", planned: cases.length, cases };
}
test("两个入口共用所选候选并保留操作场景；模型漂移或少执行时拒绝", async (t) => {
  const plan = planFor(abcd), directory = dir(t);
  const s = await createSmokeSelection(plan, { way: 2, binary, directory });
  assert.equal(s.behaviorExecutions, 2);
  assert.equal(s.configurationExecutions, s.selectedConfigCandidates * 2);
  assert.deepEqual(JSON.parse(readFileSync(resolve(directory, "smoke.json"), "utf8")), s);
  assert.equal(selectCandidates(abcd, s).length, s.selectedConfigCandidates);
  assert.throws(() => selectCandidates(abcd.map((c, i) => i ? c : { ...c, values: { ...c.values, a: "changed" } }), s), /模型已变化/);
  assert.doesNotThrow(() => verifyExecutionSelection(s, s.cases, false));
  assert.throws(() => verifyExecutionSelection(s, s.cases.slice(1), false), /没有覆盖/);
  assert.doesNotThrow(() => verifyExecutionSelection(s, s.cases.slice(1), true));
  assert.throws(() => catalogGroups({ ...plan, coverage: "smoke" }), /完整有限目录/);
});
test("参数及 PICT 执行错误清晰失败，无降级抽样", async (t) => {
  for (const n of [0, -1, "2.5", "abc", "1e3", undefined, Infinity]) assert.throws(() => validateWay(n), /正整数/);
  assert.equal(validateWay("3"), 3);
  await assert.rejects(generateGroup(abcd, { way: 2, binary: "/does-not-exist-pict", directory: dir(t) }), /ENOENT/);
  await assert.rejects(generateGroup(abcd, { way: 2, binary: process.execPath, directory: dir(t) }), /PICT 执行失败/);
});
test("子进程超时、输出上限和中断只清理本次进程", async () => {
  await assert.rejects(runProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeoutMs: 50 }), /超过/);
  await assert.rejects(runProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(5000))"], { maxBytes: 100 }), /输出超过/);
  const controller = new AbortController();
  const promise = runProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], { signal: controller.signal });
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(promise, /中断/);
});
