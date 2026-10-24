import type { Reporter, FullConfig, Suite, TestCase, TestResult, FullResult, TestError } from '@playwright/test/reporter';
import { mkdirSync, readFileSync, existsSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** MES 用例只有指定场景的覆盖，不使用练习站枚举覆盖率。 */
export default class MesReporter implements Reporter {
  dir = '';
  tests: TestCase[] = [];
  ended = new Map<string, TestResult['status']>();
  errors: string[] = [];
  planOnly = false;
  filtered = false;
  onBegin(config: FullConfig, suite: Suite) {
    this.dir = process.env.MES_RUN_DIR ?? resolve(config.projects[0]!.outputDir, '..');
    mkdirSync(this.dir, { recursive: true });
    const file = resolve(this.dir, 'invocation.json');
    const invocation = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    this.planOnly = invocation.mode === 'plan' || process.argv.includes('--list');
    const grep = Array.isArray(config.grep) ? config.grep : [config.grep];
    this.filtered = !!config.grepInvert || grep.some(g => g.source !== '.*') || invocation.args?.includes('--grep') === true;
    this.tests = suite.allTests();
    writeFileSync(resolve(this.dir, 'plan.json'), JSON.stringify({
      schemaVersion: 1, suite: 'mes', scope: this.filtered ? 'filtered-mes-cases' : 'specified-mes-cases',
      planned: this.tests.length,
      cases: this.tests.map(t => ({ id: t.id, title: t.title, case: JSON.parse(t.annotations.find(a => a.type === 'mes-case')!.description!) })),
    }, null, 2));
  }
  onTestEnd(test: TestCase, result: TestResult) {
    this.ended.set(test.id, result.status);
    appendFileSync(resolve(this.dir, 'results.jsonl'), JSON.stringify({
      id: test.id, title: test.title, status: result.status, durationMs: result.duration,
      errors: result.errors.map(e => e.message),
      attachments: result.attachments.map(a => ({ name: a.name, contentType: a.contentType, path: a.path, body: a.body?.toString('utf8') })),
    }) + '\n');
  }
  onError(error: TestError) { this.errors.push(error.message ?? String(error)); }
  onEnd(result: FullResult) {
    if (!this.dir) { this.dir = process.env.MES_RUN_DIR ?? resolve('output', `mes-error-${Date.now()}`); mkdirSync(this.dir, { recursive: true }); }
    const count = (status: TestResult['status']) => [...this.ended.values()].filter(s => s === status).length;
    const planned = this.tests.length, notRun = planned - this.ended.size, skipped = count('skipped');
    const attempted = this.ended.size - skipped, passed = count('passed');
    const coverageComplete = !this.planOnly && planned > 0 && attempted === planned && !count('interrupted') && !this.errors.length;
    const allPassed = coverageComplete && passed === planned && result.status === 'passed';
    const summary = {
      schemaVersion: 1, suite: 'mes', mode: this.planOnly ? 'plan' : 'execute',
      scope: this.filtered ? 'filtered-mes-cases' : 'specified-mes-cases', status: result.status,
      planned, attempted, passed, failed: count('failed'), timedOut: count('timedOut'), interrupted: count('interrupted'), skipped, notRun,
      coverageComplete, allPassed, errors: this.errors,
      boundary: '仅指定用例的 UI 节点定位与面板断言；不代表全系统覆盖、保存、后端持久化或设备验收。',
    };
    writeFileSync(resolve(this.dir, 'summary.json'), JSON.stringify(summary, null, 2));
    writeFileSync(resolve(this.dir, '中文测试报告.md'), [
      '# MES 工作流测试报告', '',
      `结果：${this.planOnly ? (this.errors.length ? '计划生成失败' : '仅生成计划，未执行') : allPassed ? '指定用例全部通过' : '未全部通过'}。`, '',
      `计划 ${planned}，执行 ${attempted}，通过 ${passed}，失败 ${count('failed')}，超时 ${count('timedOut')}，中断 ${count('interrupted')}，跳过 ${skipped}，未运行 ${notRun}。`, '',
      summary.boundary, '',
      '逐项结果、当前 JSON 与匹配证据见 results.jsonl；失败截图、trace 见 HTML 报告及 artifacts。', '',
      ...this.tests.map(t => `- ${t.title}: ${this.ended.get(t.id) ?? '未运行'}`), '',
      ...this.errors.map(e => `错误：${e}`), '',
    ].join('\n'));
  }
}
