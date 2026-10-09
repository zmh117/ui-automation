import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, delimiter } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { runProcess } from "./process.mjs";

export const automationRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const maxProjectionWork = 2000000;
export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
export const hash = (value) => createHash("sha256").update(canonical(value)).digest("hex");
export function validateWay(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error("--way 必须是正整数，例如 1、2、3；不接受 0、小数或超出安全整数范围的数值");
  return Number(value);
}
export function groupKey(candidate) {
  const match = candidate.id?.match(/^(.+)@[^@]+#\d+$/);
  if (!match) throw new Error(`配置候选缺少模型标识：${candidate.id}`);
  return match[1];
}
export function fingerprint(candidates) { return hash(candidates); }

export function inspectGroup(candidates) {
  if (!Array.isArray(candidates) || !candidates.length || candidates.length > 100000) throw new Error("候选组必须包含 1–100000 条完整候选");
  const id = groupKey(candidates[0]), fields = Object.keys(candidates[0].values ?? {});
  if (!fields.length || fields.length > 20) throw new Error(`${id} 字段数必须在 1–20 之间`);
  const seen = new Set(), ids = new Set(), domains = fields.map(() => new Map());
  for (const c of candidates) {
    if (groupKey(c) !== id || !["valid", "invalid"].includes(c.classification) || !Array.isArray(c.violations)) throw new Error(`${id} 候选分类或规则信息不完整`);
    if (c.classification === "valid" && c.violations.length || c.classification === "invalid" && !c.violations.length) throw new Error(`${id} 合法性与违规信息不一致`);
    if (canonical(Object.keys(c.values).sort()) !== canonical([...fields].sort())) throw new Error(`${id} 候选字段不一致`);
    const key = canonical(c.values);
    if (seen.has(key) || ids.has(c.id)) throw new Error(`${id} 候选值或 ID 重复`);
    seen.add(key); ids.add(c.id);
    fields.forEach((field, i) => domains[i].set(canonical(c.values[field]), c.values[field]));
  }
  if (domains.reduce((total, domain) => total * BigInt(domain.size), 1n) !== BigInt(candidates.length)) throw new Error(`${id} 输入不是完整有限候选目录，不能据此证明覆盖`);
  return { id, fields, domains: domains.map((domain) => [...domain.values()]), candidates, legal: candidates.filter((c) => c.classification === "valid") };
}

export function buildPictModel(candidates, requestedWay) {
  const info = inspectGroup(candidates), way = Math.min(validateWay(requestedWay), info.fields.length);
  const domains = info.fields.map((field) => [...new Map(info.legal.map((c) => [canonical(c.values[field]), c.values[field]])).values()]);
  const mapping = info.fields.map((field, i) => ({ parameter: `P${i}`, field, values: domains[i].map((value, j) => ({ token: `V${j}`, value })) }));
  if (!info.legal.length) return { ...info, effectiveWay: way, mapping, model: null };
  const tokenOf = (index, value) => mapping[index].values.find((v) => canonical(v.value) === canonical(value))?.token;
  const constraints = candidates.filter((c) => c.classification === "invalid").flatMap((c) => {
    const tokens = info.fields.map((f, i) => tokenOf(i, c.values[f]));
    if (tokens.some((token) => token === undefined)) return [];
    return [`${tokens.map((token, i) => `[P${i}] <> "${token}"`).join(" OR ")};`];
  });
  const model = ["# Encoded finite legal configuration model", ...mapping.map((p) => `${p.parameter}: ${p.values.map((v) => v.token).join(", ")}`), "", ...constraints, ""].join("\n");
  return { ...info, effectiveWay: way, mapping, model };
}

export function parsePictRows(stdout, encoded) {
  const lines = stdout.trim().split(/\r?\n/), header = lines.shift()?.split("\t");
  if (canonical(header) !== canonical(encoded.mapping.map((p) => p.parameter))) throw new Error(`${encoded.id} PICT 表头不匹配`);
  const legalByValue = new Map(encoded.legal.map((c) => [canonical(c.values), c]));
  const seen = new Set();
  return lines.filter((l) => l.trim()).map((line) => {
    const tokens = line.split("\t");
    if (tokens.length !== encoded.fields.length) throw new Error(`${encoded.id} PICT 输出列数不正确`);
    const values = Object.fromEntries(tokens.map((token, i) => {
      const match = encoded.mapping[i].values.find((v) => v.token === token);
      if (!match) throw new Error(`${encoded.id} PICT 返回未知值 ${token}`);
      return [encoded.fields[i], match.value];
    }));
    const candidate = legalByValue.get(canonical(values));
    if (!candidate) throw new Error(`${encoded.id} PICT 返回非法或不在原目录中的配置`);
    if (seen.has(candidate.id)) throw new Error(`${encoded.id} PICT 返回重复配置`);
    seen.add(candidate.id);
    return candidate;
  });
}

function combinations(fields, size, limit) {
  const output = [];
  function visit(start, prefix) {
    if (prefix.length === size) {
      output.push(prefix);
      if (output.length > limit) throw new Error("n-way 核验工作量超过 200 万次投影，请缩小分组或有限值域");
      return;
    }
    for (let i = start; i <= fields.length - size + prefix.length; i++) visit(i + 1, [...prefix, fields[i]]);
  }
  visit(0, []);
  return output;
}
export function verifyTupleCoverage(legal, selected, fields, way) {
  const legalById = new Map(legal.map((c) => [c.id, canonical(c)]));
  if (selected.some((c) => legalById.get(c.id) !== canonical(c))) throw new Error("n-way 核验发现非法或被改写的配置");
  if (!legal.length) return { requiredTuples: 0, coveredTuples: 0, verified: true };
  const subsets = combinations(fields, way, Math.floor(maxProjectionWork / (legal.length + selected.length)));
  let requiredTuples = 0, coveredTuples = 0;
  for (const subset of subsets) {
    const project = (c) => canonical(subset.map((field) => c.values[field]));
    const required = new Set(legal.map(project)), covered = new Set(selected.map(project));
    requiredTuples += required.size;
    coveredTuples += [...required].filter((v) => covered.has(v)).length;
  }
  if (requiredTuples !== coveredTuples) throw new Error(`n-way 覆盖不足：要求 ${requiredTuples} 个可行元组，仅覆盖 ${coveredTuples}`);
  return { requiredTuples, coveredTuples, verified: true };
}

export function addSupplements(candidates, pictRows, fields, effectiveWay) {
  const selected = new Map();
  function add(candidate, reason) {
    const row = selected.get(candidate.id) ?? { candidate, reasons: [] };
    if (!row.reasons.includes(reason)) row.reasons.push(reason);
    selected.set(candidate.id, row);
  }
  pictRows.forEach((c) => add(c, `合法 ${effectiveWay}-way`));
  const ranked = candidates.map((c, index) => ({ c, index })).sort((a, b) => a.c.violations.length - b.c.violations.length || a.index - b.index).map((x) => x.c);
  const ruleIds = [...new Set(candidates.flatMap((c) => c.violations.map((v) => v.ruleId)))];
  for (const ruleId of ruleIds) {
    const representative = ranked.find((c) => c.violations.some((v) => v.ruleId === ruleId));
    add(representative, `违规规则代表：${ruleId}${representative.violations.length > 1 ? "（无法在现有候选中单独触发）" : ""}`);
  }
  for (const field of fields) {
    const samples = [...new Set(candidates.map((c) => canonical(c.values[field])))];
    for (const sample of samples) {
      if ([...selected.values()].some(({ candidate: c }) => canonical(c.values[field]) === sample)) continue;
      add(ranked.find((c) => canonical(c.values[field]) === sample), `补充有限样本/边界：${field}`);
    }
  }
  const rows = candidates.filter((c) => selected.has(c.id)).map((c) => selected.get(c.id));
  // 独立复核补充目标，不能只凭“尝试添加过”宣称覆盖。
  for (const field of fields) for (const c of candidates)
    if (!rows.some((r) => canonical(r.candidate.values[field]) === canonical(c.values[field]))) throw new Error(`样本覆盖缺失：${field}`);
  for (const rule of ruleIds)
    if (!rows.some((r) => r.candidate.violations.some((v) => v.ruleId === rule))) throw new Error(`负向规则覆盖缺失：${rule}`);
  return { rows, ruleIds, supplementsVerified: true };
}

export function resolvePictBinary() {
  const explicit = process.env.PICT_BIN;
  const local = resolve(automationRoot, ".tools/pict/pict");
  const choices = explicit ? [resolve(explicit)] : [local, ...(process.env.PATH ?? "").split(delimiter).map((p) => resolve(p, process.platform === "win32" ? "pict.exe" : "pict"))];
  for (const path of choices) {
    try { accessSync(path, constants.X_OK); return path; } catch { /* 继续寻找实际可执行文件 */ }
  }
  throw new Error(explicit ? `PICT_BIN 指定的文件不可执行：${explicit}` : "未找到 PICT，请先在项目根目录运行 npm run pict:install，或用 PICT_BIN 指定可执行文件路径");
}
export function pictIdentity(binary) {
  const installation = resolve(dirname(binary), "installation.json");
  const provenance = existsSync(installation) ? JSON.parse(readFileSync(installation, "utf8")) : {};
  const sha256 = createHash("sha256").update(readFileSync(binary)).digest("hex");
  if (provenance.sha256 && provenance.sha256 !== sha256) throw new Error("PICT 二进制与安装指纹不一致，请检查安装");
  return { path: binary, sha256, revision: provenance.revision ?? null, tag: provenance.tag ?? null };
}
export async function generateGroup(candidates, { way, binary, directory, signal }) {
  const encoded = buildPictModel(candidates, way);
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, "mapping.json"), JSON.stringify(encoded.mapping, null, 2));
  let pictRows = [];
  if (encoded.model) {
    const modelPath = resolve(directory, "model.pict");
    writeFileSync(modelPath, encoded.model);
    const args = [modelPath, `/o:${encoded.effectiveWay}`, "/r:1", "/c"];
    const result = await runProcess(binary, args, { signal });
    writeFileSync(resolve(directory, "output.tsv"), result.stdout);
    writeFileSync(resolve(directory, "stderr.txt"), result.stderr);
    writeFileSync(resolve(directory, "command.json"), JSON.stringify({ binary, args, code: result.code, signal: result.signal }, null, 2));
    if (result.code !== 0) throw new Error(`${encoded.id} PICT 执行失败：${result.stderr.trim() || `退出码 ${result.code}`}`);
    pictRows = parsePictRows(result.stdout, encoded);
  }
  const coverage = verifyTupleCoverage(encoded.legal, pictRows, encoded.fields, encoded.effectiveWay);
  const supplements = addSupplements(candidates, pictRows, encoded.fields, encoded.effectiveWay);
  return {
    id: encoded.id, fingerprint: fingerprint(candidates), fields: encoded.fields,
    requestedWay: Number(way), effectiveWay: encoded.effectiveWay,
    totalCandidates: candidates.length, legalCandidates: encoded.legal.length,
    pictRows: pictRows.length, selected: supplements.rows.length,
    selectedValid: supplements.rows.filter((r) => r.candidate.classification === "valid").length,
    selectedInvalid: supplements.rows.filter((r) => r.candidate.classification === "invalid").length,
    status: encoded.legal.length ? "pict-generated" : "no-legal-configurations",
    ...coverage, ...supplements,
  };
}
