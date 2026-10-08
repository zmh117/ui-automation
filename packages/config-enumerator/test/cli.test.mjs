import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const cli = fileURLToPath(new URL("../bin/enumerate.mjs", import.meta.url));
const model = fileURLToPath(new URL("../examples/abcd.json", import.meta.url));
const invoke = (args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });

function folder(t) {
  const dir = mkdtempSync(join(tmpdir(), "config-enumerator-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("完整 CLI 导出可重放的模型、16 行候选及校验和", (t) => {
  const out = join(folder(t), "full");
  const result = invoke(["--model", model, "--out", out]);
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  const bytes = readFileSync(join(out, "cases.jsonl"));
  const rows = bytes.toString().trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(rows.length, 16);
  assert.equal(manifest.exportComplete, true);
  assert.equal(manifest.summary.valid, "9");
  assert.equal(manifest.summary.invalid, "7");
  assert.equal(manifest.execution, "not-performed");
  assert.equal(manifest.modelSha256, createHash("sha256").update(readFileSync(join(out, "model.json"))).digest("hex"));
  assert.equal(manifest.casesSha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(invoke(["--model", model, "--out", out]).status, 1);
  assert.deepEqual(readFileSync(join(out, "cases.jsonl")), bytes);
});

test("预算导出明确非成功完成，保留非法行", (t) => {
  const out = join(folder(t), "partial");
  const result = invoke(["--model", model, "--out", out, "--max-cases", "3"]);
  assert.equal(result.status, 2, result.stderr);
  const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  assert.equal(manifest.exportComplete, false);
  assert.equal(manifest.written, "3");
  assert.equal(manifest.summary.invalid, "1");
  assert.equal(manifest.summary.status, "limited");
});

test("错误模型和错误参数不创建输出目录", (t) => {
  const dir = folder(t);
  const invalid = join(dir, "invalid.json");
  writeFileSync(invalid, JSON.stringify({ id: "broken", version: "1", fields: [], rules: [] }));
  const out = join(dir, "out");
  for (const args of [
    ["--model", invalid, "--out", out],
    ["--model", model, "--out", out, "--max-cases", "0"],
    ["--model", model, "--out", out, "--unknown", "x"],
    ["--model", model, "--out", out, "--out", out],
  ]) {
    assert.equal(invoke(args).status, 1);
    assert.equal(existsSync(out), false);
  }
  assert.match(invoke(["--help"]).stdout, /不执行 UI/);
});

test("SIGINT 取消大空间导出并保留未完成清单", { timeout: 10000 }, async (t) => {
  const dir = folder(t);
  const large = join(dir, "large.json");
  const out = join(dir, "cancelled");
  writeFileSync(large, JSON.stringify({ id: "large", version: "1", fields: Array.from({ length: 40 }, (_, i) => ({ id: `f${i}`, values: [false, true] })), rules: [] }));
  const child = spawn(process.execPath, [cli, "--model", large, "--out", out], { stdio: ["ignore", "ignore", "pipe"] });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  let interrupted = false;
  child.stderr.on("data", () => { if (!interrupted) { interrupted = true; child.kill("SIGINT"); } });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  assert.equal(code, 130);
  const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  assert.equal(manifest.exportComplete, false);
  assert.equal(manifest.summary.status, "cancelled");
  assert.equal(manifest.written, manifest.summary.generated);
  assert.ok(BigInt(manifest.summary.remaining) > 0n);
});

test("候选写入失败时区分生成数和成功写入数，不声明完整导出", (t) => {
  const dir = folder(t);
  const fault = join(dir, "write-fault.mjs");
  const out = join(dir, "failed");
  writeFileSync(fault, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const original = fs.writeFileSync;
let rows = 0;
fs.writeFileSync = function(target, ...args) {
  if (typeof target === 'number' && ++rows === 3) throw new Error('模拟磁盘写入失败');
  return original.call(this, target, ...args);
};
syncBuiltinESMExports();\n`);
  const result = spawnSync(process.execPath, ["--import", fault, cli, "--model", model, "--out", out], { encoding: "utf8" });
  assert.equal(result.status, 1);
  const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  assert.equal(manifest.exportComplete, false);
  assert.equal(manifest.summary.generated, "3");
  assert.equal(manifest.written, "2");
  assert.equal(manifest.casesSha256, null);
  assert.match(manifest.exportError, /模拟磁盘写入失败/);
});
