import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

const out =
  process.env.MES_RUN_DIR ?? resolve("output", `direct-${Date.now()}`);
const catalogScope = process.env.MES_TEST_SCOPE ?? "all";
if (!["all", "discovery"].includes(catalogScope)) throw new Error("未知执行范围");
export default defineConfig({
  testDir: "./tests",
  testMatch: catalogScope === "discovery" ? "**/discovery.spec.ts" : "**/*.spec.ts",
  fullyParallel: true,
  workers: 4,
  retries: 0,
  timeout: 30000 + Number(process.env.MES_SLOW_MO ?? 0) * 200,
  expect: { timeout: 4000 },
  outputDir: resolve(out, "artifacts"),
  reporter: [
    ["./reporter.ts"],
    ["dot"],
    ["html", { outputFolder: resolve(out, "html"), open: "never" }],
  ],
  use: {
    baseURL: process.env.PLAYGROUND_URL ?? "http://127.0.0.1:5173",
    browserName: "chromium",
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    actionTimeout: 5000,
    navigationTimeout: 10000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: { slowMo: Number(process.env.MES_SLOW_MO ?? 0) },
  },
});
