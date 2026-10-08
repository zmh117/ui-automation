#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { discoverPage, parseDiscoveryPlan, createDiscoveryDraft, createReviewTemplate, renderDiscoveryReport } from "../dist/discovery/index.js";

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.length === 1 && args[0] === "--help") {
    console.log("用法：config-discover --plan <计划.json> --out <新目录> [--channel chrome|chromium|msedge] [--headed]\n只扫描和执行指定展开入口，不选择业务选项或保存。退出码：0 指定计划完成，2 部分发现，130 取消，1 错误。");
    return;
  }
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (!["--plan", "--out", "--channel", "--headed"].includes(name) || Object.hasOwn(options, name)) throw new Error(`未知或重复参数：${name}`);
    if (name === "--headed") { options[name] = true; continue; }
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`${name} 缺少值`);
    options[name] = value;
  }
  if (!options["--plan"] || !options["--out"]) throw new Error("必须提供 --plan 和 --out");
  const channel = options["--channel"] ?? "chrome";
  if (!["chrome", "chromium", "msedge"].includes(channel)) throw new Error("不支持的浏览器 channel");
  const plan = parseDiscoveryPlan(JSON.parse(readFileSync(resolve(options["--plan"]), "utf8")));
  const out = resolve(options["--out"]);
  if (existsSync(out)) throw new Error("输出目录已存在，不覆盖已有发现报告");
  let chromium;
  try { ({ chromium } = await import("playwright")); }
  catch { throw new Error("页面发现需要 Playwright：请安装 playwright@1.63.0；只使用枚举核心无需安装"); }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  let browser;
  try {
    browser = await chromium.launch({ headless: !options["--headed"], ...(channel === "chromium" ? {} : { channel }) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    console.error(`开始发现 ${plan.scenes.length} 个指定场景，使用独立浏览器上下文。`);
    const report = await discoverPage(page, plan, { signal: controller.signal });
    const draft = await createDiscoveryDraft(report);
    const review = createReviewTemplate(draft);
    mkdirSync(out);
    for (const [name, content] of [["report.json", report], ["draft-model.json", draft], ["review-template.json", review]]) writeFileSync(join(out, name), JSON.stringify(content, null, 2) + "\n", { flag: "wx" });
    writeFileSync(join(out, "report.md"), renderDiscoveryReport(report, draft), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, snapshots: report.snapshots.length, fields: draft.fields.length, scenes: report.scenes, reportId: report.reportId, out }, null, 2));
    process.exitCode = report.status === "completed" ? 0 : report.status === "cancelled" ? 130 : 2;
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
    await browser?.close();
  }
}
main().catch((error) => { console.error(`发现失败：${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
