#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync } from "node:fs";
import { resolve, join } from "node:path";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { createEnumeration, parseModel } from "../dist/index.js";

const usage = `配置全量枚举（含非法组合；不执行 UI）
用法：config-enumerate --model <模型.json> --out <新目录> [--max-cases <正整数>]

输出：model.json、cases.jsonl、manifest.json。
省略 --max-cases 表示全量；已有输出目录不会被覆盖。
退出码：0 完整导出，2 达到预算未完成，130 中断，1 模型或 I/O 错误。`;

function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (!["--model", "--out", "--max-cases"].includes(name)) throw new Error(`未知参数：${name}`);
    if (Object.hasOwn(result, name)) throw new Error(`参数重复：${name}`);
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`${name} 缺少参数值`);
    result[name] = value;
  }
  if (!result["--model"] || !result["--out"]) throw new Error("必须提供 --model 和 --out");
  if (result["--max-cases"] && !/^[1-9]\d*$/.test(result["--max-cases"])) throw new Error("--max-cases 必须是正整数");
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) { console.log(usage); return; }
  const options = parseArgs(args);
  const model = parseModel(JSON.parse(readFileSync(resolve(options["--model"]), "utf8")));
  const controller = new AbortController();
  const run = createEnumeration(model, {
    signal: controller.signal,
    ...(options["--max-cases"] ? { maxCases: BigInt(options["--max-cases"]) } : {}),
  });
  const out = resolve(options["--out"]);
  // 先校验模型，且不覆写任何已有产物。父目录需要由调用方准备。
  mkdirSync(out);
  const modelText = JSON.stringify(model, null, 2) + "\n";
  writeFileSync(join(out, "model.json"), modelText, { flag: "wx" });
  const modelSha256 = createHash("sha256").update(modelText).digest("hex");
  const startedAt = new Date().toISOString();
  const casesHash = createHash("sha256");
  let written = 0n;
  let file;
  let error;
  const onInterrupt = () => controller.abort();
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onInterrupt);
  console.error(`候选总数：${run.getSummary().totalCandidates}；开始流式导出。`);
  try {
    file = openSync(join(out, "cases.jsonl"), "wx");
    for (const candidate of run.cases) {
      const line = JSON.stringify(candidate) + "\n";
      writeFileSync(file, line);
      casesHash.update(line);
      written++;
      if (written % 256n === 0n) await yieldToEventLoop();
    }
  } catch (cause) {
    error = cause;
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onInterrupt);
    if (file !== undefined) {
      try { closeSync(file); } catch (cause) { error ??= cause; }
    }
  }
  const summary = run.getSummary();
  const manifest = {
    schemaVersion: 1,
    artifactType: "configuration-candidates",
    generatorVersion: "0.2.0",
    mode: "exhaustive",
    modelSha256,
    maxCases: options["--max-cases"] ?? null,
    startedAt,
    finishedAt: new Date().toISOString(),
    summary,
    exportComplete: !error && summary.complete && written.toString() === summary.generated,
    written: written.toString(),
    casesSha256: error ? null : casesHash.digest("hex"),
    ...(error ? { exportError: error instanceof Error ? error.message : String(error) } : {}),
    execution: "not-performed",
  };
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  if (error) throw error;
  console.log(JSON.stringify(manifest, null, 2));
  process.exitCode = manifest.exportComplete ? 0 : controller.signal.aborted ? 130 : 2;
}

main().catch((error) => {
  console.error(`枚举失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
