import type { Reporter, FullConfig, Suite, TestCase, TestResult, FullResult, TestError } from '@playwright/test/reporter';
import { mkdirSync, readFileSync, existsSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, relative, basename } from 'node:path';
import type { MesWorkflowCase } from './cases';
import { plannedExecution, mesStepPlan, executionView, finalizeRecordedExecution } from './execution-model';

const scenarioOf = (test: TestCase): MesWorkflowCase => JSON.parse(test.annotations.find(a => a.type === 'mes-case')!.description!);
function playwrightSteps(steps: TestResult['steps']): unknown[] {
  return steps.map(s => ({ title: s.title, category: s.category, startedAt: s.startTime.toISOString(), durationMs: s.duration,
    error: s.error?.message ?? null, steps: playwrightSteps(s.steps) }));
}

/** MES 用例只有指定场景的覆盖，不使用练习站枚举覆盖率。 */
export default class MesReporter implements Reporter {
  dir = '';
  tests: TestCase[] = [];
  ended = new Map<string, TestResult['status']>();
  errors: string[] = [];
  planOnly = false;
  filtered = false;
  records = new Map<string, ReturnType<MesReporter['resultRecord']>>();
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
      schemaVersion: 2, suite: 'mes', scope: this.filtered ? 'filtered-mes-cases' : 'specified-mes-cases',
      planned: this.tests.length,
      cases: this.tests.map(t => ({ id: t.id, caseId: scenarioOf(t).id, title: t.title, case: scenarioOf(t), steps: mesStepPlan(scenarioOf(t)) })),
    }, null, 2));
  }
  onTestEnd(test: TestCase, result: TestResult) {
    this.ended.set(test.id, result.status);
    const record = this.resultRecord(test, result); this.records.set(test.id, record);
    appendFileSync(resolve(this.dir, 'results.jsonl'), JSON.stringify(record) + '\n');
  }
  resultRecord(test: TestCase, result?: TestResult) {
    const scenario = scenarioOf(test);
    let execution = plannedExecution(scenario, test.id), executionFile: string | null = null;
    if (result && result.status !== 'skipped') {
      try {
        const files = [...new Set(test.annotations.filter(a => a.type === 'mes-execution-file').map(a => a.description!).filter(Boolean))];
        const attachment = result.attachments.find(a => a.name === 'MES 每步执行记录');
        if (files.length > 1) throw new Error('标准用例出现多份执行记录，不能静默选取一次');
        const path = files[0] ?? attachment?.path;
        if (!path) throw new Error('用例未进入记录器或记录文件缺失；计划步骤不表示已执行');
        execution = finalizeRecordedExecution(JSON.parse(readFileSync(path, 'utf8')), scenario, test.id);
        executionFile = relative(this.dir, path);
        execution.issues.push(...test.annotations.filter(a => a.type === 'mes-evidence-error').map(a => a.description ?? '附件保存失败'));
        if (result.status !== 'passed' && execution.status === 'passed') execution.issues.push('业务步骤完成后测试仍失败；请检查 Playwright 错误和收尾步骤');
        if (result.status === 'passed' && execution.status !== 'passed') execution.issues.push('测试状态与业务执行记录不一致，不能据测试通过判定路径完成');
      } catch (error) { execution.status = 'unavailable'; execution.issues.push(String(error)); }
    }
    return {
      schemaVersion: 2, id: test.id, caseId: scenario.id, title: test.title,
      requirements: scenario.requirements, status: result?.status ?? 'not-run',
      startedAt: result?.startTime.toISOString() ?? null, durationMs: result?.duration ?? null,
      errors: result?.errors.map(e => e.message) ?? [],
      executionFile, execution: executionView(execution), steps: playwrightSteps(result?.steps ?? []),
      attachments: result?.attachments.map(a => ({ name: a.name, contentType: a.contentType,
        path: a.path ? relative(this.dir, a.path) : undefined, body: a.body?.toString('utf8') })) ?? [],
    };
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
    const cases = this.tests.map(t => this.records.get(t.id) ?? this.resultRecord(t));
    writeFileSync(resolve(this.dir, 'execution.json'), JSON.stringify({
      schemaVersion: 1, artifactType: 'mes-execution-report', runId: basename(this.dir), generatedAt: new Date().toISOString(),
      mode: summary.mode, scope: summary.scope, businessVerdict: 'not-inferred', summary, cases,
      limitations: ['仅包含当前标准 MES 工作流套件实际执行的步骤；不表示全业务覆盖。',
        'before/after 为各自 capturedAt 的只读观察，截图是测试收尾状态，均非每个动作的原子瞬间。',
        'not-run 不属于实际路径；unavailable/interrupted 为证据缺口；断言通过不等于所有需求已满足。',
        '操作路径和需求正文供 Agent 独立分析；本程序没有调用 Agent，也没有生成业务审查结论。'],
    }, null, 2));
    writeFileSync(resolve(this.dir, '中文测试报告.md'), [
      '# MES 工作流测试报告', '',
      `结果：${this.planOnly ? (this.errors.length ? '计划生成失败' : '仅生成计划，未执行') : allPassed ? '指定用例全部通过' : '未全部通过'}。`, '',
      `计划 ${planned}，执行 ${attempted}，通过 ${passed}，失败 ${count('failed')}，超时 ${count('timedOut')}，中断 ${count('interrupted')}，跳过 ${skipped}，未运行 ${notRun}。`, '',
      summary.boundary, '',
      '需求、用例、操作路径及每步前后状态见 execution.json；逐项结果与低层步骤见 results.jsonl。成功/失败的截图和 trace 见 HTML 报告及 artifacts。', '',
      ...this.tests.map(t => `- ${t.title}: ${this.ended.get(t.id) ?? '未运行'}`), '',
      ...this.errors.map(e => `错误：${e}`), '',
    ].join('\n'));
  }
}
