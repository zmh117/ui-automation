import { cloneJson, evaluate, parseModel } from "./model.js";
import type { ConfigurationCase, Enumeration, EnumerationOptions, EnumerationStatus, JsonValue } from "./types.js";

/** 惰性遍历有限笛卡尔积。业务规则只分类，不过滤任何候选。 */
export function createEnumeration(input: unknown, options: EnumerationOptions = {}): Enumeration {
  const model = parseModel(input);
  const { signal, maxCases } = options;
  let limit: bigint | undefined;
  if (maxCases !== undefined) {
    if ((typeof maxCases !== "number" && typeof maxCases !== "bigint") ||
        (typeof maxCases === "number" && !Number.isSafeInteger(maxCases)) || maxCases < 1) {
      throw new RangeError("maxCases 必须是正安全整数或正 bigint");
    }
    limit = BigInt(maxCases);
  }
  const total = model.fields.reduce((n, field) => n * BigInt(field.values.length), 1n);
  let status: EnumerationStatus = "ready";
  let generated = 0n;
  let valid = 0n;
  let invalid = 0n;
  function* iterate(): Generator<ConfigurationCase, void, unknown> {
    const indices = model.fields.map(() => 0);
    status = "running";
    try {
      while (generated < total) {
        if (signal?.aborted) { status = "cancelled"; return; }
        if (limit !== undefined && generated >= limit) { status = "limited"; return; }
        const values: Record<string, JsonValue> = Object.fromEntries(model.fields.map((field, i) => [field.id, cloneJson(field.values[indices[i]!]!)]));
        const violations = model.rules
          .filter((rule) => (!rule.when || evaluate(rule.when, values)) && !evaluate(rule.assert, values))
          .map((rule) => ({ ruleId: rule.id, message: rule.message }));
        generated++;
        if (violations.length) invalid++; else valid++;
        // 在交付最后一条时即标明生成完成，不依赖消费方再调用一次 next()。
        if (generated === total) status = "completed";
        else if (limit !== undefined && generated === limit) status = "limited";
        yield {
          id: `${model.id}@${model.version}#${generated}`,
          ordinal: generated.toString(),
          values,
          classification: violations.length ? "invalid" : "valid",
          violations,
        };
        // 混合进制索引等价于固定顺序的深度优先枚举，避免递归栈和全集缓存。
        for (let i = indices.length - 1; i >= 0; i--) {
          indices[i] = indices[i]! + 1;
          if (indices[i]! < model.fields[i]!.values.length) break;
          indices[i] = 0;
        }
      }
      status = "completed";
    } finally {
      if (status === "running") status = "cancelled";
    }
  }
  return {
    cases: iterate(),
    getSummary: () => ({
      modelId: model.id,
      modelVersion: model.version,
      status,
      complete: status === "completed",
      totalCandidates: total.toString(),
      generated: generated.toString(),
      valid: valid.toString(),
      invalid: invalid.toString(),
      remaining: (total - generated).toString(),
    }),
  };
}
