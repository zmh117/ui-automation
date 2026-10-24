import type { ElementHandle, Frame } from 'playwright';
import { findElement } from './dom.js';
import { fingerprintReport } from './discover.js';
import type { DiscoveryReport, DocumentContext, DomAddress, LocatorEvidence, ObservedContainer } from './types.js';

export interface WorkflowNode {
  id: string; name: string; type: string; testId: string | null; next: string[];
}
export interface WorkflowReading {
  schemaVersion: 1; artifactType: 'workflow-observation'; url: string;
  status: 'observed' | 'incomplete'; rootTestId: string | null;
  nodes: WorkflowNode[]; edges: { from: string; to: string }[]; issues: string[];
}
export interface WorkflowTarget {
  key: string; locator: LocatorEvidence; context: DocumentContext; containers: ObservedContainer[];
}
export interface WorkflowObservation extends WorkflowTarget { reading: WorkflowReading }
export interface WorkflowReadOptions { maxNodes?: number; maxTextLength?: number }
export interface WorkflowNodeCriteria { name?: string; type?: string }
export interface WorkflowNodeQuery extends WorkflowNodeCriteria {
  predecessor?: WorkflowNodeCriteria; successor?: WorkflowNodeCriteria;
}
type Request = WorkflowReadOptions & { expected?: WorkflowReading; nodeId?: string };

/** Self-contained DOM reader. Explicit metadata only, with no Vue/private instance access. */
function workflowDOM(root: Element, request: Request = {}): WorkflowReading | Element {
  const maxNodes = request.maxNodes ?? 500, maxText = request.maxTextLength ?? 500;
  if (!Number.isInteger(maxNodes) || maxNodes < 0 || maxNodes > 5000 || !Number.isInteger(maxText) || maxText < 1 || maxText > 10000) throw new Error('工作流读取预算无效');
  const parent = (el: Element): Element | null => el.assignedSlot ?? el.parentElement ?? ((el.getRootNode() as ShadowRoot).host || null);
  const visible = (el: Element) => {
    if (!el.isConnected || !el.getClientRects().length) return false;
    for (let n: Element | null = el; n; n = parent(n)) {
      const s = getComputedStyle(n);
      if (n.matches('[hidden],[aria-hidden="true"],[inert],[data-discovery-ignore="true"]') || s.display === 'none' || ['hidden', 'collapse'].includes(s.visibility) || s.opacity === '0' || s.contentVisibility === 'hidden') return false;
    }
    return true;
  };
  if (!root.matches('[data-workflow="mes"]') || !visible(root)) throw new Error('工作流入口无效或不可见');
  const issues = new Set<string>();
  const elements = Array.from(root.querySelectorAll('[data-workflow-node-id]')).filter(el => el.closest('[data-workflow="mes"]') === root);
  if (elements.length > maxNodes) issues.add('节点数量超过读取预算');
  if (elements.some(el => !visible(el))) issues.add('存在隐藏节点，当前图不完整');
  const text = (el: Element, attribute: string) => {
    const value = el.getAttribute(attribute) ?? '';
    if (value.length > maxText) issues.add('节点属性超出文本预算');
    return value.slice(0, maxText);
  };
  const nodes = elements.filter(visible).slice(0, maxNodes).map(el => {
    const id = text(el, 'data-workflow-node-id'), name = text(el, 'data-workflow-node-name'), type = text(el, 'data-workflow-node-type');
    if (!id.trim() || !type.trim()) issues.add('节点缺少 ID 或类型');
    let next: string[] = [];
    const raw = el.getAttribute('data-workflow-next');
    try {
      if (raw === null || raw.length > 100000) throw new Error();
      const list: unknown = JSON.parse(raw);
      if (!Array.isArray(list) || list.length > 5000 || list.some(v => !['string', 'number'].includes(typeof v) || !String(v).trim() || String(v).length > maxText)) throw new Error();
      next = list.map(String);
    } catch { issues.add('节点连接元数据缺失、无效或超限'); }
    return { id, name, type, testId: el.getAttribute('data-testid'), next };
  });
  const counts = new Map<string, number>();
  nodes.forEach(n => counts.set(n.id, (counts.get(n.id) ?? 0) + 1));
  if ([...counts.values()].some(n => n > 1)) issues.add('工作流内节点 ID 重复');
  const edges = nodes.flatMap(n => [...new Set(n.next)].map(to => ({ from: n.id, to })));
  if (edges.some(e => !counts.has(e.to))) issues.add('连接指向未观察到的节点');
  const reading: WorkflowReading = { schemaVersion: 1, artifactType: 'workflow-observation', url: location.href,
    status: issues.size ? 'incomplete' : 'observed', rootTestId: root.getAttribute('data-testid'), nodes, edges, issues: [...issues] };
  if (request.expected) {
    if (JSON.stringify(reading) !== JSON.stringify(request.expected)) throw new Error('工作流已变化，旧观察不可执行；请重新采集并确认业务目标');
    const matches = elements.filter(el => visible(el) && el.getAttribute('data-workflow-node-id') === request.nodeId);
    if (reading.status !== 'observed' || matches.length !== 1) throw new Error('节点不可唯一定位');
    return matches[0]!;
  }
  return reading;
}
export const readWorkflowDOM = workflowDOM as (root: Element, options?: WorkflowReadOptions) => WorkflowReading;

export async function readWorkflow(frame: Frame, address: DomAddress, options: WorkflowReadOptions = {}): Promise<WorkflowReading> {
  const root = await findElement(frame, address);
  if (!root) throw new Error('未找到唯一可见工作流');
  try { return await root.evaluate(readWorkflowDOM, options); }
  finally { await root.dispose(); }
}

function validateCriteria(value: unknown, relation = false): asserts value is WorkflowNodeQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('业务节点条件必须是对象');
  const criteria = value as WorkflowNodeQuery;
  const allowed = relation ? ['name', 'type'] : ['name', 'type', 'predecessor', 'successor'];
  if (Object.keys(value).some(k => !allowed.includes(k))) throw new Error('节点查询只允许业务名称、类型与相邻关系，不允许动态 ID');
  if (!criteria.name && !criteria.type) throw new Error('至少提供节点业务名称或类型');
  for (const k of ['name', 'type'] as const) if (criteria[k] !== undefined && (typeof criteria[k] !== 'string' || !criteria[k]!.trim())) throw new Error('业务条件必须是非空字符串');
  if (criteria.predecessor !== undefined) validateCriteria(criteria.predecessor, true);
  if (criteria.successor !== undefined) validateCriteria(criteria.successor, true);
}

/** Validate case files before opening a browser; shares the execution query contract. */
export function validateWorkflowNodeQuery(value: unknown): asserts value is WorkflowNodeQuery {
  validateCriteria(value);
}

/** Pure JSON lookup for analysis/assertions. No ID from a previous run is accepted as a query. */
export function requireWorkflowNode(reading: WorkflowReading, query: WorkflowNodeQuery): WorkflowNode {
  validateCriteria(query);
  if (reading.schemaVersion !== 1 || reading.artifactType !== 'workflow-observation' || reading.status !== 'observed' || reading.issues.length) throw new Error('工作流观察不完整，不能用于执行定位');
  const ids = new Set(reading.nodes.map(n => n.id));
  if (ids.size !== reading.nodes.length || reading.nodes.some(n => !n.id.trim() || !n.type.trim() || n.next.some(id => !ids.has(id)))) throw new Error('工作流节点 ID 或连接不完整');
  const match = (node: WorkflowNode, c: WorkflowNodeCriteria) => (c.name === undefined || node.name === c.name) && (c.type === undefined || node.type === c.type);
  // Derive connections from nodes, so an edited edges summary cannot change the match.
  const found = reading.nodes.filter(n => match(n, query)
    && (!query.predecessor || reading.nodes.some(p => p.next.includes(n.id) && match(p, query.predecessor!)))
    && (!query.successor || reading.nodes.some(s => n.next.includes(s.id) && match(s, query.successor!))));
  if (found.length !== 1) throw new Error(found.length ? `业务节点匹配有歧义：${found.length} 个候选，请补充类型或前后关系` : '当前工作流未找到符合业务条件的节点');
  return found[0]!;
}

/** Obtain a handle only if the same visible graph is still present. Caller must dispose it. */
export async function resolveWorkflowNode(frame: Frame, address: DomAddress, query: WorkflowNodeQuery, options: WorkflowReadOptions = {}) {
  const root = await findElement(frame, address);
  if (!root) throw new Error('未找到唯一可见工作流');
  try {
    const reading = await root.evaluate(readWorkflowDOM, options), node = requireWorkflowNode(reading, query);
    // Recheck the root's identity too: replacing the entire canvas must not use an old handle.
    const current = await findElement(frame, address);
    if (!current) throw new Error('工作流已变化或不再唯一');
    try { if (!await root.evaluate((el, other) => el === other, current)) throw new Error('工作流已替换，请重新采集'); }
    finally { await current.dispose(); }
    const handle = await root.evaluateHandle(workflowDOM, { ...options, expected: reading, nodeId: node.id });
    const element = handle.asElement() as ElementHandle<Element> | null;
    if (!element) { await handle.dispose(); throw new Error('业务节点不可执行'); }
    return { reading, node, element };
  } finally { await root.dispose(); }
}

/** Every call reads the current graph. Never retries clicks or accepts a saved JSON as an action target. */
export async function clickWorkflowNode(frame: Frame, address: DomAddress, query: WorkflowNodeQuery, options: WorkflowReadOptions & { timeoutMs?: number } = {}) {
  const result = await resolveWorkflowNode(frame, address, query, options);
  try { await result.element.click({ timeout: options.timeoutMs ?? 5000 }); return { reading: result.reading, node: result.node }; }
  finally { await result.element.dispose(); }
}

export async function createWorkflowReport(report: DiscoveryReport) {
  if (report.schemaVersion !== 3 || report.artifactType !== 'page-discovery' || report.reportId !== await fingerprintReport(report)) throw new Error('发现报告格式或指纹不匹配');
  return { schemaVersion: 1 as const, artifactType: 'workflow-observations' as const, reportId: report.reportId,
    usage: '当前快照分析与断言；执行必须重新采集，不能复用动态 ID',
    snapshots: report.snapshots.map(s => ({ snapshotId: s.id, pageUrl: s.url, workflows: s.workflows ?? [] })) };
}
