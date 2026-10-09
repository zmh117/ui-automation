import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonical, fingerprint, generateGroup, groupKey, hash, pictIdentity, validateWay } from "./pict.mjs";

export const executionKey = (meta) => canonical([meta.route, meta.candidate.id]);
export function catalogGroups(plan) {
  if (!Array.isArray(plan.cases) || !plan.cases.length || plan.planned !== plan.cases.length || plan.coverage !== "group-exhaustive-and-explicit-behaviors") throw new Error("冒烟来源必须是完整有限目录，不能使用筛选或冒烟结果再次抽样");
  const groups = new Map(), unique = new Map(), keys = new Set();
  for (const row of plan.cases) {
    const meta = row.metadata?.[0], c = meta?.candidate;
    if (!c?.id || !meta.route || meta.modelVersion !== plan.modelVersion || !Number.isSafeInteger(meta.paths) || meta.paths < 1) throw new Error("候选目录元数据不完整或版本不一致");
    const key = executionKey(meta);
    if (keys.has(key)) throw new Error("同一页面的候选执行标识重复");
    keys.add(key);
    if (c.classification === "behavior") continue;
    if (unique.has(c.id)) {
      if (canonical(unique.get(c.id)) !== canonical(c)) throw new Error(`两个页面的候选定义不一致：${c.id}`);
      continue;
    }
    unique.set(c.id, c);
    const group = groupKey(c);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(c);
  }
  if (!groups.size) throw new Error("完整目录中没有配置候选组");
  return groups;
}

export async function createSmokeSelection(plan, { way = 2, binary, directory, signal }) {
  way = validateWay(way);
  const inputGroups = catalogGroups(plan), groups = [];
  const engine = pictIdentity(binary);
  for (const [id, candidates] of inputGroups) {
    const safeDirectory = `group-${groups.length + 1}`;
    const group = await generateGroup(candidates, { way, binary, directory: resolve(directory, "pict", safeDirectory), signal });
    groups.push({ ...group, evidence: `pict/${safeDirectory}` });
  }
  const selectedIds = new Set(groups.flatMap((group) => group.rows.map((r) => r.candidate.id)));
  const cases = plan.cases.filter((row) => row.metadata[0].candidate.classification === "behavior" || selectedIds.has(row.metadata[0].candidate.id));
  const selection = {
    schemaVersion: 1, kind: "pict-smoke", modelVersion: plan.modelVersion,
    requestedWay: way, seed: 1, catalogFingerprint: hash(plan.cases), engine,
    fullPlanned: plan.planned, planned: cases.length,
    configCandidates: groups.reduce((n, g) => n + g.totalCandidates, 0),
    selectedConfigCandidates: selectedIds.size,
    selectedValid: groups.reduce((n, g) => n + g.selectedValid, 0),
    selectedInvalid: groups.reduce((n, g) => n + g.selectedInvalid, 0),
    behaviorExecutions: cases.filter((r) => r.metadata[0].candidate.classification === "behavior").length,
    configurationExecutions: cases.filter((r) => r.metadata[0].candidate.classification !== "behavior").length,
    groups, cases, verified: groups.every((g) => g.verified && g.supplementsVerified),
  };
  writeFileSync(resolve(directory, "smoke.json"), JSON.stringify(selection, null, 2));
  return selection;
}

export function readSmokeSelection(path = process.env.MES_SMOKE_SELECTION) {
  if (!path) return null;
  let s;
  try { s = JSON.parse(readFileSync(path, "utf8")); } catch (error) { throw new Error(`无法读取冒烟清单：${error.message}`); }
  if (s.kind !== "pict-smoke" || s.schemaVersion !== 1 || !s.verified || !Array.isArray(s.groups) || !s.groups.length || !Array.isArray(s.cases) || s.planned !== s.cases.length) throw new Error("冒烟清单格式无效或未通过覆盖核验，请重新生成");
  validateWay(s.requestedWay);
  return s;
}

export function selectCandidates(candidates, selection = readSmokeSelection()) {
  if (!selection) return candidates;
  if (!candidates.length) throw new Error("执行模型出现空候选组，请重新生成冒烟清单");
  const key = groupKey(candidates[0]);
  const group = selection.groups.find((g) => g.id === key);
  if (!group || group.fingerprint !== fingerprint(candidates)) throw new Error(`候选模型已变化：${key}；请重新生成冒烟清单`);
  const selectedIds = new Set(group.rows.map((r) => r.candidate.id));
  if (!selectedIds.size || group.rows.some((r) => !candidates.some((c) => c.id === r.candidate.id && canonical(c) === canonical(r.candidate)))) throw new Error(`冒烟候选不属于当前模型：${key}`);
  return candidates.filter((c) => selectedIds.has(c.id));
}

export function smokeOverview(selection) {
  if (!selection) return undefined;
  return {
    requestedWay: selection.requestedWay, seed: selection.seed, verified: selection.verified,
    engine: selection.engine, fullPlanned: selection.fullPlanned, planned: selection.planned,
    configCandidates: selection.configCandidates, selectedConfigCandidates: selection.selectedConfigCandidates,
    selectedValid: selection.selectedValid, selectedInvalid: selection.selectedInvalid,
    behaviorExecutions: selection.behaviorExecutions, configurationExecutions: selection.configurationExecutions,
    groups: selection.groups.map(({ rows, ...g }) => g),
  };
}

export function verifyExecutionSelection(selection, cases, filtered) {
  if (!selection) return;
  const expected = new Map(selection.cases.map((c) => [executionKey(c.metadata[0]), canonical(c.metadata)]));
  const actual = new Set();
  for (const c of cases) {
    const meta = c.metadata?.[0];
    if (!meta || expected.get(executionKey(meta)) !== canonical(c.metadata)) throw new Error("执行用例与冒烟清单不一致，请重新生成");
    actual.add(executionKey(meta));
  }
  if (!filtered && (actual.size !== expected.size || cases.length !== expected.size)) throw new Error("实际注册用例没有覆盖整个冒烟清单，请检查候选过滤或重新生成");
}
