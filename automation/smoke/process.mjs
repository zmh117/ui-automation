import { spawn } from "node:child_process";

// 仅管理本次创建的子进程；等待 close 后才返回，确保中断时报告与浏览器能收尾。
export function runProcess(command, args, { cwd, env = process.env, signal, inherit = false, timeoutMs = 60000, maxBytes = 16 * 1024 * 1024 } = {}) {
  if (signal?.aborted) return Promise.reject(new Error("运行已中断"));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", bytes = 0, problem, timer, forceTimer;
    const stop = (reason, sig = "SIGTERM") => {
      problem ??= reason;
      child.kill(sig);
      forceTimer ??= setTimeout(() => child.kill("SIGKILL"), 5000);
    };
    const abort = () => stop(new Error("运行已中断"), "SIGINT");
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    if (timeoutMs) timer = setTimeout(() => stop(new Error(`子进程超过 ${timeoutMs} 毫秒，已停止`)), timeoutMs);
    function receive(chunk, isError) {
      bytes += chunk.length;
      if (bytes > maxBytes) return stop(new Error("子进程输出超过上限，已停止"));
      if (isError) stderr += chunk.toString(); else stdout += chunk.toString();
    }
    child.stdout?.on("data", (chunk) => receive(chunk, false));
    child.stderr?.on("data", (chunk) => receive(chunk, true));
    child.on("error", (error) => { problem = error; });
    child.on("close", (code, sig) => {
      clearTimeout(timer); clearTimeout(forceTimer);
      signal?.removeEventListener("abort", abort);
      if (problem) reject(problem);
      else resolve({ code, signal: sig, stdout, stderr });
    });
  });
}
