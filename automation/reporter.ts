import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  FullResult,
} from "@playwright/test/reporter";
import {
  mkdirSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { writeChineseReports } from "./reporting/chinese-report.mjs";

export default class Results implements Reporter {
  dir = "";
  tests: TestCase[] = [];
  ended = new Map<string, string>();
  errors: string[] = [];
  planOnly = false;
  filtered = false;
  direct = false;
  meta(t: TestCase) {
    return t.annotations
      .filter((a) => a.type === "case")
      .map((a) => JSON.parse(a.description!))[0];
  }
  onBegin(config: FullConfig, suite: Suite) {
    this.dir =
      process.env.MES_RUN_DIR ??
      resolve(
        config.projects[0]?.outputDir ??
          resolve(config.rootDir, "output/direct/artifacts"),
        "..",
      );
    mkdirSync(this.dir, { recursive: true });
    const invocation = resolve(this.dir, "invocation.json");
    this.direct = !existsSync(invocation);
    const invocationData = existsSync(invocation)
      ? JSON.parse(readFileSync(invocation, "utf8"))
      : {};
    this.planOnly =
      invocationData.mode === "plan" || process.argv.includes("--list");
    const grep = Array.isArray(config.grep) ? config.grep : [config.grep];
    this.filtered = Boolean(
      invocationData.args?.includes("--grep") ||
        config.grepInvert ||
        grep.some((pattern) => pattern.source !== ".*"),
    );
    this.tests = suite.allTests();
    writeFileSync(
      resolve(this.dir, "plan.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          modelVersion: "2026-10-07.1",
          coverage: "group-exhaustive-and-explicit-behaviors",
          planned: this.tests.length,
          cases: this.tests.map((t) => ({
            id: t.id,
            title: t.titlePath(),
            metadata: t.annotations
              .filter((a) => a.type === "case")
              .map((a) => JSON.parse(a.description!)),
          })),
        },
        null,
        2,
      ),
    );
  }
  onError(error: { message?: string }) {
    this.errors.push(error.message ?? "未知执行错误");
  }
  onTestEnd(test: TestCase, result: TestResult) {
    this.ended.set(test.id, result.status);
    const steps = (items: TestResult["steps"]): unknown[] =>
      items.map((s) => ({
        title: s.title,
        category: s.category,
        duration: s.duration,
        error: s.error?.message,
        steps: steps(s.steps),
      }));
    appendFileSync(
      resolve(this.dir, "results.jsonl"),
      JSON.stringify({
        id: test.id,
        title: test.titlePath(),
        metadata: test.annotations
          .filter((a) => a.type === "case")
          .map((a) => JSON.parse(a.description!)),
        status: result.status,
        duration: result.duration,
        errors: result.errors.map((e) => e.message),
        steps: steps(result.steps),
        attachments: result.attachments.map((a) => ({
          name: a.name,
          contentType: a.contentType,
          path: a.path,
          text: a.body?.toString("utf8"),
        })),
      }) + "\n",
    );
  }
  onEnd(result: FullResult) {
    const counts = {
      passed: 0,
      failed: 0,
      timedOut: 0,
      skipped: 0,
      interrupted: 0,
      notRun: 0,
    };
    for (const t of this.tests) {
      const status = this.ended.get(t.id);
      if (status) counts[status as keyof typeof counts]++;
      else counts.notRun++;
    }
    const complete =
      !this.planOnly &&
      !this.errors.length &&
      this.tests.length > 0 &&
      counts.notRun === 0 &&
      counts.skipped === 0 &&
      counts.interrupted === 0;
    const groups: Record<string, Record<string, number>> = {};
    for (const t of this.tests) {
      const m = this.meta(t);
      if (!m) continue;
      const key = `${m.route} :: ${m.region}`;
      const row = (groups[key] ??= {
        planned: 0,
        passed: 0,
        failed: 0,
        timedOut: 0,
        skipped: 0,
        interrupted: 0,
        notRun: 0,
        valid: 0,
        invalid: 0,
        behavior: 0,
        plannedPaths: 0,
        passedPaths: 0,
      });
      row.planned!++;
      row[this.ended.get(t.id) ?? "notRun"]!++;
      row[m.candidate.classification ?? "behavior"]!++;
      row.plannedPaths! += m.paths;
      if (this.ended.get(t.id) === "passed") row.passedPaths! += m.paths;
    }
    writeFileSync(
      resolve(this.dir, "summary.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          modelVersion: "2026-10-07.1",
          mode: this.planOnly ? "plan" : "execute",
          scope: this.direct
            ? "direct-unverified-selection"
            : this.filtered
              ? "filtered"
              : "full-confirmed-catalog",
          status: result.status,
          planned: this.tests.length,
          uniqueCandidates: new Set(
            this.tests.map((t) => this.meta(t)?.candidate.id),
          ).size,
          plannedPaths: Object.values(groups).reduce(
            (sum, g) => sum + g.plannedPaths!,
            0,
          ),
          passedPaths: Object.values(groups).reduce(
            (sum, g) => sum + g.passedPaths!,
            0,
          ),
          attempted:
            counts.passed +
            counts.failed +
            counts.timedOut +
            counts.interrupted,
          ...counts,
          complete,
          coverageComplete: complete && !this.filtered && !this.direct,
          allPassed: complete && counts.passed === this.tests.length,
          errors: this.errors,
          groups,
          duration: result.duration,
          finishedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  }

  async onExit() {
    // 等所有报告器完成 onEnd，HTML 与 trace 入口此时也已就绪。
    writeChineseReports(this.dir);
  }
}
