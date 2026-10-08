export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface Field {
  id: string;
  label?: string;
  values: JsonValue[];
}

export type Condition =
  | { op: "eq" | "neq" | "includes"; field: string; value: JsonValue }
  | { op: "in"; field: string; values: JsonValue[] }
  | { op: "lt" | "lte" | "gt" | "gte"; field: string; value: number }
  | { op: "length"; field: string; min?: number; max?: number }
  | { op: "all" | "any"; conditions: Condition[] }
  | { op: "not"; condition: Condition };

export interface Rule {
  id: string;
  message: string;
  when?: Condition;
  assert: Condition;
}

export interface ConfigurationModel {
  id: string;
  version: string;
  fields: Field[];
  rules: Rule[];
}

export interface ConfigurationCase {
  id: string;
  /** 从 1 开始的十进制顺序号，避免超过 Number.MAX_SAFE_INTEGER 后丢失精度。 */
  ordinal: string;
  values: Record<string, JsonValue>;
  classification: "valid" | "invalid";
  violations: { ruleId: string; message: string }[];
}

export interface EnumerationOptions {
  /** 省略即枚举全量；限制的是所有候选数，包含非法组合。 */
  maxCases?: number | bigint;
  signal?: AbortSignal;
}

export type EnumerationStatus = "ready" | "running" | "completed" | "limited" | "cancelled";

export interface EnumerationSummary {
  modelId: string;
  modelVersion: string;
  status: EnumerationStatus;
  complete: boolean;
  totalCandidates: string;
  generated: string;
  valid: string;
  invalid: string;
  remaining: string;
}

export interface Enumeration {
  /** 单次消费；再次遍历同一迭代器不会重新生成。 */
  cases: Generator<ConfigurationCase, void, unknown>;
  getSummary(): EnumerationSummary;
}
