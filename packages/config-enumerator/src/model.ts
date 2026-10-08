import type { Condition, ConfigurationModel, JsonValue } from "./types.js";

export class ModelValidationError extends Error {
  constructor(public readonly path: string, reason: string) {
    super(`${path}: ${reason}`);
    this.name = "ModelValidationError";
  }
}

function fail(path: string, message: string): never {
  throw new ModelValidationError(path, message);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "必须是对象");
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${path}.${key}`, "未知属性，请检查拼写");
  }
}

function nonempty(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) fail(path, "必须是非空字符串");
}

function identifier(value: unknown, path: string): asserts value is string {
  nonempty(value, path);
  if (!/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(value) || ["__proto__", "constructor", "prototype"].includes(value)) {
    fail(path, "标识须以字母或下划线开头，仅含字母、数字、下划线、点或连字符，且不能使用保留名称");
  }
}

function array(value: unknown, path: string): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length === 0) fail(path, "必须是非空数组");
}

/** 校验 JSON 数据而非用 stringify 静默丢弃 undefined、函数、日期或 NaN。 */
function assertJson(value: unknown, path: string, ancestors = new Set<object>(), depth = 0): void {
  if (depth > 100) fail(path, "JSON 嵌套超过 100 层");
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (!value || typeof value !== "object") fail(path, "必须是 JSON 数据，数字必须有限");
  if (ancestors.has(value)) fail(path, "不允许循环引用");
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) fail(path, "必须是普通 JSON 对象");
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (!Object.hasOwn(value, i)) fail(`${path}[${i}]`, "数组不能包含空洞");
    }
  }
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    if (typeof key !== "string") fail(path, "不允许 Symbol 属性");
    if (Array.isArray(value) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) fail(path, "数组不能包含自定义属性");
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !("value" in descriptor)) fail(`${path}.${key}`, "不允许访问器或不可枚举属性");
    assertJson(descriptor.value, `${path}.${key}`, ancestors, depth + 1);
  }
  ancestors.delete(value);
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 对象键顺序无关，数组顺序有意义；保留 JSON 值类型。 */
export function canonical(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(",")}}`;
}

function validateCondition(input: unknown, fields: Set<string>, path: string): void {
  const c = record(input, path);
  switch (c.op) {
    case "all":
    case "any":
      keys(c, ["op", "conditions"], path);
      array(c.conditions, `${path}.conditions`);
      c.conditions.forEach((part, i) => validateCondition(part, fields, `${path}.conditions[${i}]`));
      return;
    case "not":
      keys(c, ["op", "condition"], path);
      validateCondition(c.condition, fields, `${path}.condition`);
      return;
    case "eq":
    case "neq":
    case "includes":
    case "in":
    case "lt":
    case "lte":
    case "gt":
    case "gte":
    case "length":
      break;
    default:
      fail(`${path}.op`, "未知或缺少运算符");
  }
  if (typeof c.field !== "string" || !fields.has(c.field)) fail(`${path}.field`, "引用了不存在的字段");
  if (c.op === "in") {
    keys(c, ["op", "field", "values"], path);
    array(c.values, `${path}.values`);
  } else if (c.op === "length") {
    keys(c, ["op", "field", "min", "max"], path);
    if (c.min === undefined && c.max === undefined) fail(path, "length 至少需要 min 或 max");
    for (const key of ["min", "max"]) {
      if (c[key] !== undefined && (!Number.isSafeInteger(c[key]) || (c[key] as number) < 0)) fail(`${path}.${key}`, "必须是非负安全整数");
    }
    if (c.min !== undefined && c.max !== undefined && (c.min as number) > (c.max as number)) fail(path, "min 不能大于 max");
  } else {
    keys(c, ["op", "field", "value"], path);
    if (!Object.hasOwn(c, "value")) fail(`${path}.value`, "缺少比较值");
    if (["lt", "lte", "gt", "gte"].includes(c.op as string) && typeof c.value !== "number") fail(`${path}.value`, "数值比较需要数字");
  }
}

/** 返回经过校验的独立副本。接收 unknown，方便直接使用 JSON 文件。 */
export function parseModel(input: unknown): ConfigurationModel {
  assertJson(input, "model");
  const model = record(input, "model");
  keys(model, ["id", "version", "fields", "rules"], "model");
  identifier(model.id, "model.id");
  nonempty(model.version, "model.version");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(model.version)) fail("model.version", "版本只能含字母、数字、点、下划线或连字符");
  array(model.fields, "model.fields");
  if (!Array.isArray(model.rules)) fail("model.rules", "必须是数组；没有规则时使用 []");
  const fields = new Set<string>();
  model.fields.forEach((inputField, i) => {
    const path = `model.fields[${i}]`;
    const field = record(inputField, path);
    keys(field, ["id", "label", "values"], path);
    identifier(field.id, `${path}.id`);
    if (fields.has(field.id)) fail(`${path}.id`, "字段标识重复");
    fields.add(field.id);
    if (field.label !== undefined) nonempty(field.label, `${path}.label`);
    array(field.values, `${path}.values`);
    const seen = new Set<string>();
    field.values.forEach((value, j) => {
      const key = canonical(value as JsonValue);
      if (seen.has(key)) fail(`${path}.values[${j}]`, "候选值重复");
      seen.add(key);
    });
  });
  const rules = new Set<string>();
  model.rules.forEach((inputRule, i) => {
    const path = `model.rules[${i}]`;
    const rule = record(inputRule, path);
    keys(rule, ["id", "message", "when", "assert"], path);
    identifier(rule.id, `${path}.id`);
    if (rules.has(rule.id)) fail(`${path}.id`, "规则标识重复");
    rules.add(rule.id);
    nonempty(rule.message, `${path}.message`);
    if (rule.when !== undefined) validateCondition(rule.when, fields, `${path}.when`);
    validateCondition(rule.assert, fields, `${path}.assert`);
  });
  return cloneJson(input) as ConfigurationModel;
}

export function evaluate(condition: Condition, values: Record<string, JsonValue>): boolean {
  switch (condition.op) {
    case "all": return condition.conditions.every((c) => evaluate(c, values));
    case "any": return condition.conditions.some((c) => evaluate(c, values));
    case "not": return !evaluate(condition.condition, values);
  }
  const actual = values[condition.field]!;
  switch (condition.op) {
    case "eq": return canonical(actual) === canonical(condition.value);
    case "neq": return canonical(actual) !== canonical(condition.value);
    case "in": return condition.values.some((v) => canonical(actual) === canonical(v));
    case "includes": return Array.isArray(actual) && actual.some((v) => canonical(v) === canonical(condition.value));
    case "lt": return typeof actual === "number" && actual < condition.value;
    case "lte": return typeof actual === "number" && actual <= condition.value;
    case "gt": return typeof actual === "number" && actual > condition.value;
    case "gte": return typeof actual === "number" && actual >= condition.value;
    case "length": {
      const length = typeof actual === "string" ? Array.from(actual).length : Array.isArray(actual) ? actual.length : undefined;
      return length !== undefined && (condition.min === undefined || length >= condition.min) && (condition.max === undefined || length <= condition.max);
    }
  }
}
