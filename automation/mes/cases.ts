import { readFileSync } from 'node:fs';
import { validateWorkflowNodeQuery, type DomAddress, type WorkflowNodeQuery } from '@mes-ui/config-enumerator/discovery';

export type MesCheck = { target: DomAddress } & (
  { kind: 'value' | 'text'; expected: string } | { kind: 'checked'; expected: boolean }
);
export interface MesWorkflowCase {
  id: string;
  title: string;
  url: string;
  framePath?: DomAddress[];
  open?: { target: DomAddress; expected: DomAddress }[];
  workflow: DomAddress;
  node: WorkflowNodeQuery;
  expectedPanel: DomAddress;
  checks: MesCheck[];
}
export interface MesCasePlan { schemaVersion: 1; cases: MesWorkflowCase[] }

function object(value: unknown, fields: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象`);
  if (Object.keys(value).some(k => !fields.includes(k))) throw new Error(`${label} 含未知字段`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 10000) throw new Error(`${label} 必须是非空且不超限的字符串`);
}
function list(value: unknown, label: string, max: number): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label} 必须是数组且不超过 ${max} 项`);
}
function address(value: unknown, label: string) {
  const a = object(value, ['selector', 'shadowPath'], label);
  text(a.selector, `${label}.selector`);
  if (a.shadowPath !== undefined) {
    list(a.shadowPath, `${label}.shadowPath`, 10);
    a.shadowPath.forEach(s => text(s, `${label}.shadowPath`));
  }
}
export function parseMesCases(value: unknown): MesCasePlan {
  const plan = object(value, ['schemaVersion', 'cases'], 'MES 用例文件');
  if (plan.schemaVersion !== 1) throw new Error('MES 用例 schemaVersion 必须为 1');
  list(plan.cases, 'cases', 500);
  if (!plan.cases.length) throw new Error('至少提供一个 MES 用例');
  const ids = new Set<string>();
  for (const item of plan.cases) {
    const c = object(item, ['id', 'title', 'url', 'framePath', 'open', 'workflow', 'node', 'expectedPanel', 'checks'], 'MES 用例');
    text(c.id, 'id'); text(c.title, 'title'); text(c.url, 'url');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(c.id) || ids.has(c.id)) throw new Error('用例 id 须为唯一的字母、数字、点、横线或下划线（最多 100 字符）');
    ids.add(c.id);
    const url = new URL(c.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('url 须为不含账号密码的 HTTP(S) 地址');
    address(c.workflow, 'workflow'); address(c.expectedPanel, 'expectedPanel');
    validateWorkflowNodeQuery(c.node);
    if (c.framePath !== undefined) {
      list(c.framePath, 'framePath', 10);
      c.framePath.forEach(a => address(a, 'framePath'));
    }
    if (c.open !== undefined) {
      list(c.open, 'open', 20);
      c.open.forEach(step => {
        const s = object(step, ['target', 'expected'], 'open 步骤');
        address(s.target, 'open.target'); address(s.expected, 'open.expected');
      });
    }
    list(c.checks, 'checks', 50);
    if (!c.checks.length) throw new Error('必须提供独立预期 checks，不能仅以点击成功作为通过');
    c.checks.forEach(check => {
      const a = object(check, ['target', 'kind', 'expected'], 'check');
      address(a.target, 'check.target');
      if (!['value', 'text', 'checked'].includes(a.kind as string)) throw new Error('check.kind 仅支持 value、text、checked');
      if (typeof a.expected !== (a.kind === 'checked' ? 'boolean' : 'string')) throw new Error('check.expected 类型不匹配');
    });
  }
  return value as MesCasePlan;
}

export function loadMesCases(path = process.env.MES_CASES_FILE): MesCasePlan {
  if (!path) throw new Error('MES 套件需要 --cases <用例 JSON 文件>');
  return parseMesCases(JSON.parse(readFileSync(path, 'utf8')));
}
