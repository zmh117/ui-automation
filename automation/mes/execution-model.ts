import type { MesWorkflowCase } from './cases';
import type { DomAddress } from '@mes-ui/config-enumerator/discovery';

export interface MesStepPlan {
  id: string; title: string; action: string; requirementIds: string[];
  target: unknown; expected: unknown;
}
export interface MesState {
  capturedAt: string; pageUrl: string; frameUrl: string; framePath: DomAddress[];
  status: 'observed' | 'unavailable'; error?: string;
  targets: { name: string; address: DomAddress; state: 'observed' | 'not-visible-or-absent' | 'unavailable'; value?: unknown; error?: string }[];
}
export interface MesStepRecord extends MesStepPlan {
  sequence: number; status: 'not-run' | 'running' | 'passed' | 'failed' | 'interrupted';
  startedAt: string | null; finishedAt: string | null; durationMs: number | null;
  actionAttempted: boolean; actionCompleted: boolean; observations: number;
  before: MesState | null; after: MesState | null; actual: unknown;
  error: { message: string; stack?: string } | null;
}
export interface MesExecution {
  schemaVersion: 1; artifactType: 'mes-case-execution'; executionId: string | null; testId: string;
  caseId: string; title: string; requirements: MesWorkflowCase['requirements'];
  startedAt: string | null; finishedAt: string | null;
  status: 'not-run' | 'running' | 'passed' | 'failed' | 'interrupted' | 'unavailable';
  businessVerdict: 'not-inferred'; steps: MesStepRecord[]; issues: string[];
}

/** 基础步骤使用 $ 前缀，与用户步骤编号空间分开；空需求引用不表示业务覆盖。 */
export function mesStepPlan(c: MesWorkflowCase): MesStepPlan[] {
  return [
    { id: '$navigate', title: '进入用例页面', action: 'navigate', requirementIds: [], target: { url: c.url }, expected: { loadState: 'domcontentloaded' } },
    ...(c.framePath ?? []).map((address, i) => ({ id: `$frame.${i + 1}`, title: `进入第 ${i + 1} 层 Frame`, action: 'enter-frame', requirementIds: [], target: address, expected: { frameAvailable: true } })),
    ...(c.open ?? []).map(s => ({ id: s.id, title: s.title, action: 'click-and-wait', requirementIds: s.requirementIds ?? [], target: s.target, expected: { visible: s.expected } })),
    { id: '$workflow.ready', title: '等待工作流画布', action: 'wait-visible', requirementIds: [], target: c.workflow, expected: { visible: true } },
    { id: '$workflow.resolve', title: '按当前业务关系定位节点', action: 'resolve-node', requirementIds: [], target: { workflow: c.workflow, query: c.node }, expected: { matches: 1 } },
    { id: '$workflow.click', title: '点击已匹配的工作流节点', action: 'click-node', requirementIds: [], target: { workflow: c.workflow, query: c.node }, expected: { clickCompleted: true } },
    { id: '$panel.ready', title: '等待节点配置面板', action: 'wait-visible', requirementIds: [], target: c.expectedPanel, expected: { visible: true } },
    ...c.checks.map(s => ({ id: s.id, title: s.title, action: 'assert', requirementIds: s.requirementIds, target: s.target,
      expected: { kind: s.kind, value: s.expected, comparisonValue: s.kind === 'text' ? s.expected.replace(/\s+/g, ' ').trim() : s.expected } })),
  ];
}

export function plannedExecution(c: MesWorkflowCase, testId: string): MesExecution {
  return {
    schemaVersion: 1, artifactType: 'mes-case-execution', executionId: null, testId, caseId: c.id, title: c.title,
    requirements: structuredClone(c.requirements), startedAt: null, finishedAt: null, status: 'not-run', businessVerdict: 'not-inferred', issues: [],
    steps: mesStepPlan(c).map((s, i) => ({ ...structuredClone(s), sequence: i + 1, status: 'not-run',
      startedAt: null, finishedAt: null, durationMs: null, before: null, after: null, actual: null, error: null,
      actionAttempted: false, actionCompleted: false, observations: 0 })),
  };
}

export function executionView(record: MesExecution) {
  const attempted = record.steps.filter(s => s.startedAt !== null);
  const stateComplete = (s: MesState | null) => !!s && s.status === 'observed' && s.targets.every(t => t.state !== 'unavailable'
    && !(t.value && typeof t.value === 'object' && 'truncated' in t.value && t.value.truncated));
  return { ...record,
    operationPath: attempted.map(s => ({ sequence: s.sequence, stepId: s.id, title: s.title, action: s.action, status: s.status,
      beforeUrl: s.before?.pageUrl ?? null, afterUrl: s.after?.pageUrl ?? null, framePath: s.after?.framePath ?? s.before?.framePath ?? [], target: s.target })),
    evidenceComplete: record.status === 'passed' || record.status === 'failed'
      ? record.issues.length === 0 && attempted.length > 0 && attempted.every(s => stateComplete(s.before) && stateComplete(s.after)) : false,
  };
}

/** reporter 正常收尾时才收敛 running；不能给未结束的步骤伪造结束时间或成功结果。 */
export function finalizeRecordedExecution(value: unknown, c: MesWorkflowCase, testId: string): MesExecution {
  const record = value as MesExecution;
  const planned = plannedExecution(c, testId);
  if (record?.schemaVersion !== 1 || record.artifactType !== 'mes-case-execution' || record.testId !== testId || record.caseId !== c.id
    || !['not-run', 'running', 'passed', 'failed', 'interrupted', 'unavailable'].includes(record.status)
    || !Array.isArray(record.issues) || !Array.isArray(record.steps)
    || JSON.stringify(record.requirements) !== JSON.stringify(c.requirements)
    || record.steps.length !== planned.steps.length
    || record.steps.some((s, i) => s.id !== planned.steps[i]!.id || s.sequence !== i + 1
      || s.action !== planned.steps[i]!.action || s.title !== planned.steps[i]!.title
      || JSON.stringify(s.target) !== JSON.stringify(planned.steps[i]!.target)
      || !['not-run', 'running', 'passed', 'failed', 'interrupted'].includes(s.status)
      || JSON.stringify(s.expected) !== JSON.stringify(planned.steps[i]!.expected)
      || JSON.stringify(s.requirementIds) !== JSON.stringify(planned.steps[i]!.requirementIds))) throw new Error('执行记录与当前用例/需求/步骤计划不匹配');
  const result = structuredClone(record);
  if (result.status === 'running' || result.steps.some(s => s.status === 'running')) {
    result.status = 'interrupted'; result.issues.push('执行记录未正常结束，保留最近落盘状态；未推断中断时的页面结果');
    for (const step of result.steps) if (step.status === 'running') step.status = 'interrupted';
  }
  return result;
}
