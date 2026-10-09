import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = "https://github.com/microsoft/pict.git";
const revision = "d529bb1535b725c8f29704f183b23dd344895d02"; // v3.7.4
const target = resolve(root, ".tools/pict");
function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${command} 执行失败：${result.error?.message ?? result.stderr ?? result.stdout}`);
  return result.stdout.trim();
}
let staging;
try {
  if (existsSync(target)) {
    const info = JSON.parse(readFileSync(resolve(target, "installation.json"), "utf8"));
    const sha = createHash("sha256").update(readFileSync(resolve(target, "pict"))).digest("hex");
    if (info.revision !== revision || info.sha256 !== sha) throw new Error("已有 PICT 安装与固定版本不符，请检查 .tools/pict 或通过 PICT_BIN 指定二进制；不会覆盖现有安装");
    console.log(`PICT 已就绪：${resolve(target, "pict")}`);
  } else {
    mkdirSync(resolve(root, ".tools"), { recursive: true });
    staging = mkdtempSync(resolve(root, ".tools/pict-build-"));
    const source = resolve(staging, "source");
    console.log("下载微软 PICT v3.7.4 固定源码，仅安装到本项目 .tools 目录……");
    run("git", ["clone", "--depth", "1", "--branch", "v3.7.4", repository, source], staging);
    if (run("git", ["rev-parse", "HEAD"], source) !== revision) throw new Error("上游标签与固定源码提交不一致，停止安装");
    console.log("编译 PICT……");
    const buildEnv = { ...process.env };
    if (process.platform === "darwin") {
      const sdk = run("xcrun", ["--show-sdk-path"], source);
      const headers = resolve(sdk, "usr/include/c++/v1");
      if (existsSync(resolve(headers, "vector")))
        buildEnv.CPLUS_INCLUDE_PATH = [headers, buildEnv.CPLUS_INCLUDE_PATH].filter(Boolean).join(":");
      buildEnv.SDKROOT = sdk;
    }
    run("make", ["-j2"], source, buildEnv);
    const binary = resolve(source, "pict");
    const sha256 = createHash("sha256").update(readFileSync(binary)).digest("hex");
    mkdirSync(target);
    copyFileSync(binary, resolve(target, "pict"));
    chmodSync(resolve(target, "pict"), 0o755);
    copyFileSync(resolve(source, "LICENSE.TXT"), resolve(target, "LICENSE.TXT"));
    writeFileSync(resolve(target, "installation.json"), JSON.stringify({ repository, tag: "v3.7.4", revision, sha256, platform: process.platform, arch: process.arch }, null, 2));
    console.log(`PICT 安装完成：${resolve(target, "pict")}\n源码提交：${revision}\n二进制 SHA-256：${sha256}`);
  }
} catch (error) {
  console.error(`PICT 安装失败：${error.message}`);
  process.exitCode = 1;
} finally {
  if (staging) rmSync(staging, { recursive: true, force: true });
}
