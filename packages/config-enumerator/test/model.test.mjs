import test from "node:test";
import assert from "node:assert/strict";
import { createEnumeration, parseModel, ModelValidationError } from "../dist/index.js";

const base = () => ({ id: "model", version: "1", fields: [{ id: "x", values: [0, 1] }], rules: [] });
const rule = (condition) => ({ id: "rule", message: "测试规则", assert: condition });

test("错误模型在迭代之前报出可定位错误", () => {
  const mutations = [
    (m) => { m.fields = []; },
    (m) => { m.fields[0].values = []; },
    (m) => { m.fields.push({ id: "x", values: [false] }); },
    (m) => { m.fields[0].values = [1, 1]; },
    (m) => { m.fields[0].values = [{ a: 1, b: 2 }, { b: 2, a: 1 }]; },
    (m) => { m.fields[0].id = "__proto__"; },
    (m) => { m.rules = [rule({ op: "eq", field: "missing", value: 1 })]; },
    (m) => { m.rules = [rule({ op: "typo", field: "x", value: 1 })]; },
    (m) => { m.rules = [rule({ op: "eq", field: "x" })]; },
    (m) => { m.rules = [rule({ op: "all", conditions: [] })]; },
    (m) => { m.rules = [rule({ op: "in", field: "x", values: [] })]; },
    (m) => { m.rules = [rule({ op: "gt", field: "x", value: "0" })]; },
    (m) => { m.rules = [rule({ op: "length", field: "x" })]; },
    (m) => { m.rules = [rule({ op: "length", field: "x", min: 2, max: 1 })]; },
    (m) => { m.rules = [rule({ op: "length", field: "x", max: -1 })]; },
    (m) => { m.rules = [rule({ op: "not" })]; },
    (m) => { m.rules = [rule({ op: "eq", field: "x", value: 1 })]; m.rules[0].whenn = { op: "eq", field: "x", value: 0 }; },
    (m) => { m.rules = [rule({ op: "eq", field: "x", value: 1 }), rule({ op: "eq", field: "x", value: 0 })]; },
    (m) => { m.fields[0].values = [undefined]; },
    (m) => { m.version = "1#2"; },
  ];
  for (const change of mutations) {
    const model = base(); change(model);
    assert.throws(() => createEnumeration(model), (error) => error instanceof ModelValidationError && error.path.startsWith("model"));
  }
});

test("JSON 校验拒绝非有限数、非 JSON 对象、循环、空洞与访问器", () => {
  const cycle = {}; cycle.self = cycle;
  const accessor = Object.defineProperty({}, "value", { enumerable: true, get() { throw new Error("不应执行访问器"); } });
  const extendedArray = []; extendedArray["4294967295"] = "JSON 会丢失的属性";
  for (const value of [NaN, Infinity, 1n, () => 1, Symbol("x"), new Date(), new Map(), cycle, Array(1), accessor, extendedArray]) {
    const model = base(); model.fields[0].values = [value];
    assert.throws(() => parseModel(model), ModelValidationError);
  }
});

test("比较值保持类型，JSON 对象按结构相等，数组保持顺序", () => {
  const values = [1, "1", true, null, { a: 1, b: 2 }, [1, 2], [2, 1]];
  const model = base(); model.fields[0].values = values;
  model.rules = [rule({ op: "in", field: "x", values: [1, { b: 2, a: 1 }, [1, 2]] })];
  assert.deepEqual([...createEnumeration(model).cases].map((r) => r.classification), ["valid", "invalid", "invalid", "invalid", "valid", "valid", "invalid"]);
});

test("逻辑与条件规则对照独立布尔预期", () => {
  const model = {
    id: "logic", version: "1", fields: ["a", "b", "c"].map((id) => ({ id, values: [false, true] })),
    rules: [{ id: "conditional", message: "a 开启时 b/c 至少一项不开启", when: { op: "eq", field: "a", value: true }, assert: { op: "not", condition: { op: "all", conditions: [{ op: "eq", field: "b", value: true }, { op: "eq", field: "c", value: true }] } } }],
  };
  for (const row of createEnumeration(model).cases) {
    const { a, b, c } = row.values;
    assert.equal(row.classification === "valid", !a || !(b && c));
  }
  model.rules[0].assert = { op: "any", conditions: [{ op: "neq", field: "b", value: true }, { op: "eq", field: "c", value: false }] };
  for (const row of createEnumeration(model).cases) {
    const { a, b, c } = row.values;
    assert.equal(row.classification === "valid", !a || !b || !c);
  }
});

test("数值边界不做字符串转数字", () => {
  const expectations = { lt: [true, true, false, false, false], lte: [true, true, true, false, false], gt: [false, false, false, true, false], gte: [false, false, true, true, false] };
  for (const [op, expected] of Object.entries(expectations)) {
    const model = base(); model.fields[0].values = [-1, 0, 1, 2, "2"];
    model.rules = [rule({ op, field: "x", value: 1 })];
    assert.deepEqual([...createEnumeration(model).cases].map((r) => r.classification === "valid"), expected);
  }
});

test("长度按 Unicode 码点或数组项数计算，100/101 字符边界", () => {
  const model = base(); model.fields[0].values = ["", "中".repeat(100), "🙂".repeat(100), "🙂".repeat(101), [], [1], null, 100];
  model.rules = [rule({ op: "length", field: "x", min: 1, max: 100 })];
  assert.deepEqual([...createEnumeration(model).cases].map((r) => r.classification === "valid"), [false, true, true, false, false, true, false, false]);
});

test("多选 includes 是数组成员匹配，不是字符串包含", () => {
  const model = base(); model.fields[0].values = [["record"], ["recording"], "record", [], [{ id: "v1" }]];
  model.rules = [rule({ op: "includes", field: "x", value: "record" })];
  assert.deepEqual([...createEnumeration(model).cases].map((r) => r.classification === "valid"), [true, false, false, false, false]);
  model.rules = [rule({ op: "includes", field: "x", value: { id: "v1" } })];
  assert.equal([...createEnumeration(model).cases][4].classification, "valid");
});

test("嵌套 JSON 的特殊键不污染原型", () => {
  const model = base();
  model.fields[0].values = [JSON.parse('{"__proto__":{"polluted":true}}')];
  const row = [...createEnumeration(model).cases][0];
  assert.equal(Object.hasOwn(row.values.x, "__proto__"), true);
  assert.equal({}.polluted, undefined);
});
