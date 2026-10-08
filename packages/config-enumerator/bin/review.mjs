#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { compileReviewedModel } from "../dist/discovery/index.js";

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.length === 1 && args[0] === "--help") {
    console.log("用法：config-review --report <report.json> --review <已确认.json> --out <新目录>\n校验明确确认与报告来源，生成 model.json 和 mapping.json；不打开浏览器或执行枚举。");
    return;
  }
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (!["--report", "--review", "--out"].includes(name) || Object.hasOwn(options, name)) throw new Error(`未知或重复参数：${name}`);
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`${name} 缺少值`);
    options[name] = value;
  }
  if (!options["--report"] || !options["--review"] || !options["--out"]) throw new Error("必须提供 --report、--review 和 --out");
  const report = JSON.parse(readFileSync(resolve(options["--report"]), "utf8"));
  const review = JSON.parse(readFileSync(resolve(options["--review"]), "utf8"));
  const result = await compileReviewedModel(report, review);
  const out = resolve(options["--out"]);
  mkdirSync(out);
  writeFileSync(join(out, "model.json"), JSON.stringify(result.model, null, 2) + "\n", { flag: "wx" });
  writeFileSync(join(out, "mapping.json"), JSON.stringify(result.mapping, null, 2) + "\n", { flag: "wx" });
  console.log(`已生成确认模型：${join(out, "model.json")}；尚未执行枚举。`);
}
main().catch((error) => { console.error(`确认转换失败：${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
