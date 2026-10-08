import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createEnumeration } from "../dist/index.js";

const abcd = JSON.parse(readFileSync(new URL("../examples/abcd.json", import.meta.url), "utf8"));
const key = (row) => Object.values(row.values).map(Number).join("");

test("ABCD 完整笛卡尔积，9 合法、7 非法，不漏掉双重违规", () => {
  const run = createEnumeration(abcd);
  assert.equal(run.getSummary().status, "ready");
  const rows = [...run.cases];
  assert.deepEqual(rows.map(key), Array.from({ length: 16 }, (_, i) => i.toString(2).padStart(4, "0")));
  assert.deepEqual(rows.filter((r) => r.classification === "valid").map(key), ["0000", "0001", "0011", "0100", "0101", "0111", "1000", "1001", "1011"]);
  assert.deepEqual(rows.filter((r) => r.classification === "invalid").map(key), ["0010", "0110", "1010", "1100", "1101", "1110", "1111"]);
  assert.deepEqual(rows.find((r) => key(r) === "1110").violations.map((v) => v.ruleId), ["A_B_EXCLUSIVE", "C_REQUIRES_D"]);
  assert.deepEqual(run.getSummary(), {
    modelId: "checkbox-linkage", modelVersion: "1", status: "completed", complete: true,
    totalCandidates: "16", generated: "16", valid: "9", invalid: "7", remaining: "0",
  });
  assert.deepEqual([...run.cases], []);
});

test("相同模型有确定顺序与标识，修改版本改变标识", () => {
  const first = [...createEnumeration(abcd).cases];
  assert.deepEqual([...createEnumeration(abcd).cases], first);
  assert.equal(first[0].id, "checkbox-linkage@1#1");
  assert.equal(first[15].ordinal, "16");
  assert.notEqual([...createEnumeration({ ...abcd, version: "2" }).cases][0].id, first[0].id);
});

test("70 布尔字段的总量精确且只消费预算内的 3 条", () => {
  const model = { id: "large", version: "1", fields: Array.from({ length: 70 }, (_, i) => ({ id: `f${i}`, values: [false, true] })), rules: [] };
  const run = createEnumeration(model, { maxCases: 3n });
  assert.equal(run.getSummary().totalCandidates, "1180591620717411303424");
  assert.equal([...run.cases].length, 3);
  assert.deepEqual(run.getSummary(), {
    modelId: "large", modelVersion: "1", status: "limited", complete: false,
    totalCandidates: "1180591620717411303424", generated: "3", valid: "3", invalid: "0", remaining: "1180591620717411303421",
  });
});

test("预算计入非法组合；预算等于或超过总量时完整", () => {
  const limited = createEnumeration(abcd, { maxCases: 3 });
  assert.equal([...limited.cases].length, 3);
  assert.equal(limited.getSummary().invalid, "1");
  assert.equal(limited.getSummary().remaining, "13");
  for (const maxCases of [16, 20, 2n ** 64n]) {
    const run = createEnumeration(abcd, { maxCases });
    [...run.cases];
    assert.equal(run.getSummary().complete, true);
  }
});

test("交付最后一条即记录生成完成", () => {
  const run = createEnumeration(abcd);
  for (let i = 0; i < 16; i++) run.cases.next();
  assert.equal(run.getSummary().complete, true);
  run.cases.return();
  assert.equal(run.getSummary().status, "completed");
});

test("消费者提前停止不算全量完成", () => {
  const run = createEnumeration(abcd);
  for (const row of run.cases) { assert.equal(row.ordinal, "1"); break; }
  assert.equal(run.getSummary().status, "cancelled");
  assert.equal(run.getSummary().remaining, "15");
});

test("开始前和执行中取消均保留真实计数", () => {
  for (const beforeStart of [true, false]) {
    const controller = new AbortController();
    const run = createEnumeration(abcd, { signal: controller.signal });
    if (!beforeStart) run.cases.next();
    controller.abort();
    assert.deepEqual([...run.cases], []);
    assert.equal(run.getSummary().status, "cancelled");
    assert.equal(run.getSummary().generated, beforeStart ? "0" : "1");
  }
});

test("源模型、规则及输出复合值的修改不能污染后续结果", () => {
  const model = {
    id: "isolation", version: "1",
    fields: [{ id: "data", values: [{ tags: ["a"] }] }, { id: "toggle", values: [false, true] }],
    rules: [{ id: "same", message: "必须保留原对象", assert: { op: "eq", field: "data", value: { tags: ["a"] } } }],
  };
  const run = createEnumeration(model);
  model.fields[0].values[0].tags[0] = "source mutation";
  model.rules[0].assert.value.tags[0] = "rule mutation";
  const first = run.cases.next().value;
  first.values.data.tags.push("output mutation");
  first.violations.push({ ruleId: "fake", message: "fake" });
  const last = run.cases.next().value;
  assert.deepEqual(last.values.data, { tags: ["a"] });
  assert.equal(last.classification, "valid");
  const summary = run.getSummary();
  summary.valid = "999";
  assert.equal(run.getSummary().valid, "2");
});

test("第二个表单模型包含数组和日期，独立业务预期为 48/30/18", () => {
  const model = JSON.parse(readFileSync(new URL("../examples/other-vue-form.json", import.meta.url), "utf8"));
  const run = createEnumeration(model);
  const rows = [...run.cases];
  assert.equal(rows.length, 48);
  for (const { values: v, classification } of rows) {
    const expected = (v.mode !== "manual" || v.quantity > 0) && (!v.checks.includes("sign") || v.checks.includes("record"));
    assert.equal(classification === "valid", expected);
  }
  assert.equal(run.getSummary().valid, "30");
  assert.equal(run.getSummary().invalid, "18");
});

test("不同值域大小与输入顺序，和独立三重循环逐行比对", () => {
  for (let a = 1; a <= 4; a++) for (let b = 1; b <= 3; b++) for (let c = 1; c <= 3; c++) {
    const values = (n) => Array.from({ length: n }, (_, i) => i);
    const model = { id: "product", version: "1", fields: [a, b, c].map((n, i) => ({ id: `v${i}`, values: values(n) })), rules: [] };
    const expected = [];
    for (let x = 0; x < a; x++) for (let y = 0; y < b; y++) for (let z = 0; z < c; z++) expected.push({ v0: x, v1: y, v2: z });
    assert.deepEqual([...createEnumeration(model).cases].map((r) => r.values), expected);
  }
});

test("不能以错误预算悄悄限制或跳过枚举", () => {
  for (const maxCases of [0, -1, 0n, -1n, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, "3", null]) {
    assert.throws(() => createEnumeration(abcd, { maxCases }), RangeError);
  }
});
