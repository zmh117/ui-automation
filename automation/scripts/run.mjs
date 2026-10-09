import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { runProcess } from "../smoke/process.mjs";
import { resolvePictBinary, validateWay } from "../smoke/pict.mjs";
import { createSmokeSelection, verifyExecutionSelection } from "../smoke/selection.mjs";
import { writeSmokeReview } from "../smoke/review.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2), forward = [];
let slowMo = "0", suite = "full", way = 2, explicitWay = false, runDir, uiStarted = false;
const controller = new AbortController();
let interrupted;
const handlers = Object.fromEntries(["SIGINT", "SIGTERM"].map((name) => [name, () => {
  interrupted ??= name;
  controller.abort();
}]));
try {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--slow-mo") {
      slowMo = args[++i];
      if (!/^\d+$/.test(slowMo ?? "") || Number(slowMo) > 5000) throw new Error("--slow-mo 须为 0–5000 毫秒");
    } else if (arg === "--suite") {
      suite = args[++i];
      if (!["full", "smoke"].includes(suite)) throw new Error("--suite 仅支持 full 或 smoke");
    } else if (arg === "--way") {
      way = validateWay(args[++i]); explicitWay = true;
    } else if (["--headed", "--list"].includes(arg)) forward.push(arg);
    else if (["--grep", "--workers", "--project"].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} 缺少值`);
      forward.push(arg, value);
    } else throw new Error(`未知参数：${arg}`);
  }
  if (explicitWay && suite !== "smoke") throw new Error("--way 仅用于冒烟；请使用 npm run ui:smoke:plan 或 npm run test:ui:smoke");
  const binary = suite === "smoke" ? resolvePictBinary() : null;
  runDir = resolve(root, "output", new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID().slice(0, 8));
  mkdirSync(runDir, { recursive: true });
  const invocation = { args, baseURL: process.env.PLAYGROUND_URL ?? "http://127.0.0.1:5173", startedAt: new Date().toISOString(), mode: forward.includes("--list") ? "plan" : "execute", suite, ...(suite === "smoke" ? { way } : {}) };
  writeFileSync(resolve(runDir, "invocation.json"), JSON.stringify(invocation, null, 2));
  console.log(`本次报告目录：${runDir}`);
  for (const [name, handler] of Object.entries(handlers)) process.on(name, handler);
  const env = { ...process.env, MES_RUN_DIR: runDir, MES_SLOW_MO: slowMo };
  delete env.MES_SMOKE_SELECTION;
  const cli = resolve(root, "node_modules/@playwright/test/cli.js");
  if (suite === "smoke") {
    const catalogDir = resolve(runDir, "catalog");
    mkdirSync(catalogDir);
    writeFileSync(resolve(catalogDir, "invocation.json"), JSON.stringify({ ...invocation, args: ["--list"], suite: "full", mode: "plan" }, null, 2));
    console.log("读取完整候选目录（只列计划，不打开浏览器）……");
    const catalog = await runProcess(process.execPath, [cli, "test", "--list"], { cwd: root, env: { ...env, MES_RUN_DIR: catalogDir }, signal: controller.signal });
    writeFileSync(resolve(catalogDir, "runner.log"), catalog.stdout + catalog.stderr);
    if (catalog.code !== 0) throw new Error(`读取完整候选目录失败，详见 ${resolve(catalogDir, "runner.log")}`);
    const plan = JSON.parse(readFileSync(resolve(catalogDir, "plan.json"), "utf8"));
    const catalogSummary = JSON.parse(readFileSync(resolve(catalogDir, "summary.json"), "utf8"));
    if (catalogSummary.scope !== "full-confirmed-catalog" || catalogSummary.errors?.length)
      throw new Error("候选来源被筛选或收集报错，不能作为完整目录生成冒烟");
    console.log(`使用真实 PICT 生成组内 ${way}-way，并独立核验覆盖……`);
    const selection = await createSmokeSelection(plan, { way, binary, directory: runDir, signal: controller.signal });
    writeSmokeReview(selection, runDir);
    env.MES_SMOKE_SELECTION = resolve(runDir, "smoke.json");
    console.log(`冒烟选例：${selection.selectedValid} 个合法候选 + ${selection.selectedInvalid} 个非法候选；加上 ${selection.behaviorExecutions} 条操作场景，共 ${selection.planned} 次测试（原目录 ${selection.fullPlanned} 次）。`);
    console.log(`选例说明：${resolve(runDir, "冒烟选例说明.md")}`);
    // 正式操作浏览器前核对完整冒烟注册目录，不能依赖报告器异常阻止执行。
    const preflightDir = resolve(runDir, "preflight");
    mkdirSync(preflightDir);
    writeFileSync(resolve(preflightDir, "invocation.json"), JSON.stringify({ ...invocation, args: ["--list"], mode: "plan" }, null, 2));
    const preflight = await runProcess(process.execPath, [cli, "test", "--list"], { cwd: root, env: { ...env, MES_RUN_DIR: preflightDir }, signal: controller.signal });
    writeFileSync(resolve(preflightDir, "runner.log"), preflight.stdout + preflight.stderr);
    if (preflight.code !== 0) throw new Error(`冒烟注册核对失败，详见 ${resolve(preflightDir, "runner.log")}`);
    const selectedPlan = JSON.parse(readFileSync(resolve(preflightDir, "plan.json"), "utf8"));
    const selectedSummary = JSON.parse(readFileSync(resolve(preflightDir, "summary.json"), "utf8"));
    if (selectedSummary.errors?.length) throw new Error(`冒烟注册核对失败：${selectedSummary.errors.join("；")}`);
    verifyExecutionSelection(selection, selectedPlan.cases, false);
  }
  uiStarted = !forward.includes("--list");
  const result = await runProcess(process.execPath, [cli, "test", ...forward], { cwd: root, env, signal: controller.signal, inherit: true, timeoutMs: 0 });
  process.exitCode = result.code ?? 1;
} catch (error) {
  process.exitCode = interrupted === "SIGINT" ? 130 : interrupted === "SIGTERM" ? 143 : 1;
  console.error(interrupted ? "运行已中断，已通知本次子进程清理。" : `运行失败：${error.message}`);
  if (runDir && !existsSync(resolve(runDir, "summary.json")))
    writeFileSync(resolve(runDir, "generation-error.json"), JSON.stringify({ status: interrupted ? "interrupted" : "failed", error: error.message, uiStarted }, null, 2));
} finally {
  for (const [name, handler] of Object.entries(handlers)) process.off(name, handler);
  if (runDir) {
    for (const name of ["中文测试报告.md", "中文失败报告.md"]) {
      const file = resolve(runDir, name);
      if (existsSync(file)) console.log(`中文报告：${file}`);
    }
    if (existsSync(resolve(runDir, "html/index.html"))) console.log(`查看报告：npx playwright show-report "${resolve(runDir, "html")}"`);
  }
}
