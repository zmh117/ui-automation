import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2),
  forward = [];
let slowMo = "0";
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--slow-mo") {
    slowMo = args[++i];
    if (!/^\d+$/.test(slowMo ?? "") || Number(slowMo) > 5000)
      throw new Error("--slow-mo 须为 0–5000 毫秒");
  } else if (["--headed", "--list"].includes(arg)) forward.push(arg);
  else if (["--grep", "--workers", "--project"].includes(arg)) {
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`${arg} 缺少值`);
    forward.push(arg, value);
  } else throw new Error(`未知参数：${arg}`);
}
const runDir = resolve(
  root,
  "output",
  new Date().toISOString().replace(/[:.]/g, "-") +
    "-" +
    randomUUID().slice(0, 8),
);
mkdirSync(runDir, { recursive: true });
writeFileSync(
  resolve(runDir, "invocation.json"),
  JSON.stringify(
    {
      args,
      baseURL: process.env.PLAYGROUND_URL ?? "http://127.0.0.1:5173",
      startedAt: new Date().toISOString(),
      mode: forward.includes("--list") ? "plan" : "execute",
    },
    null,
    2,
  ),
);
console.log(`本次报告目录：${runDir}`);
const child = spawn(
  process.execPath,
  [resolve(root, "node_modules/@playwright/test/cli.js"), "test", ...forward],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, MES_RUN_DIR: runDir, MES_SLOW_MO: slowMo },
  },
);
// runner 收到信号后负责清理自己的浏览器；不按进程名终止其他 Chrome。
const handlers = Object.fromEntries(
  ["SIGINT", "SIGTERM"].map((signal) => [signal, () => child.kill(signal)]),
);
for (const [signal, handler] of Object.entries(handlers))
  process.on(signal, handler);
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("close", (code, signal) => {
  for (const [name, handler] of Object.entries(handlers))
    process.off(name, handler);
  process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
  for (const name of ["中文测试报告.md", "中文失败报告.md"]) {
    const file = resolve(runDir, name);
    if (existsSync(file)) console.log(`中文报告：${file}`);
  }
  console.log(
    `查看报告：npx playwright show-report "${resolve(runDir, "html")}"`,
  );
});
