import { canonical, cloneJson } from '../model.js';
import type { JsonValue } from '../types.js';
import { fingerprintReport } from './discover.js';
import { createDiscoveryDraft } from './model-draft.js';
import type { DiscoveryReport, DiscoverySnapshot, DocumentContext, DomAddress, LocatorEvidence, ObservedContainer } from './types.js';

export type UiElementKind = 'page' | 'document' | 'form' | 'dialog' | 'table' | 'row' | 'region' | 'panel' | 'field' | 'action' | 'cell' | 'option' | 'workflow' | 'workflow-node';
export type UiRelationKind = 'contains' | 'has-option' | 'has-popup' | 'opens' | 'mirrors' | 'connects-to';
export interface UiObservation {
  snapshotId: string; source: string; label: string; state: JsonValue;
}
export interface UiElement {
  id: string; kinds: UiElementKind[]; pageUrl: string; context: DocumentContext | null;
  locator: LocatorEvidence | null; locatable: boolean;
  identityBasis: 'page' | 'document' | 'locator' | 'option-value' | 'snapshot-only';
  observations: UiObservation[];
}
export interface UiRelationEvidence {
  snapshotId: string;
  basis: 'document' | 'dom-containment' | 'observed-options' | 'aria' | 'explicit-step' | 'test-id-contract' | 'verified-transition' | 'handsontable-dom' | 'workflow-dom';
  detail?: string;
}
export interface UiRelation {
  from: string; to: string; kind: UiRelationKind; evidence: UiRelationEvidence[];
}
export interface UiElementModel {
  schemaVersion: 1; artifactType: 'ui-element-model'; reportId: string;
  status: 'observed' | 'partial'; businessRules: 'not-inferred';
  snapshots: { id: string; sceneId: string; pageUrl: string; afterStep: number; path: DiscoverySnapshot['path'] | null }[];
  elements: UiElement[]; relations: UiRelation[];
  configurationFields: { sourceId: string; elementId: string }[];
  limitations: string[];
}

// 只规范简单属性选择器的引号；不尝试重写 CSS/anchor 的语义。
function addressKey(address: DomAddress): string {
  const simple = (selector: string) => selector.trim().replace(/^#([a-zA-Z_][\w-]*)$/, '[id="$1"]').replace(/\[(data-testid|id)=([\w.-]+)\]/g, '[$1="$2"]')
    .replace(/\[(data-testid|id)='([\w.-]+)'\]/g, '[$1="$2"]');
  return canonical({ selector: simple(address.selector), shadowPath: (address.shadowPath ?? []).map(simple) });
}
function contextKey(context: DocumentContext): string {
  return canonical({ url: context.url, framePath: context.framePath.map(addressKey) });
}
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value));

/** 仅转换指纹完整的观察报告；不打开页面、不执行动作、不推断业务依赖。 */
export async function createUiElementModel(report: DiscoveryReport): Promise<UiElementModel> {
  if (report.schemaVersion !== 3 || report.artifactType !== 'page-discovery' || report.reportId !== await fingerprintReport(report)) throw new Error('发现报告格式或指纹不匹配');
  if (new Set(report.snapshots.map(s => s.id)).size !== report.snapshots.length) throw new Error('快照标识重复，不能建立可靠关系');
  const nodes = new Map<string, UiElement>();
  const edges = new Map<string, UiRelation>();
  const observations = new Map<string, Set<string>>();
  const targets = new Map<string, Set<UiElement>>();
  const limitations = new Set(report.limitations);
  let incomplete = report.status !== 'completed';
  const locatorIdentity = (pageUrl: string, context: DocumentContext, locator: DomAddress) => canonical({ pageUrl, context: contextKey(context), address: addressKey(locator) });
  const add = (identity: string, kind: UiElementKind, snapshot: DiscoverySnapshot, context: DocumentContext | null, locator: LocatorEvidence | null, basis: UiElement['identityBasis'], source: string, label: string, state: unknown = {}) => {
    let node = nodes.get(identity);
    if (!node) {
      node = { id: identity, kinds: [], pageUrl: snapshot.url, context: cloneJson(context), locator: cloneJson(locator), locatable: !!locator?.unique && !!locator.selector, identityBasis: basis, observations: [] };
      nodes.set(identity, node); observations.set(identity, new Set());
    }
    if (!node.kinds.includes(kind)) node.kinds.push(kind);
    const observation = { snapshotId: snapshot.id, source, label, state: json(state) };
    const key = canonical(observation);
    if (!observations.get(identity)!.has(key)) { node.observations.push(observation); observations.get(identity)!.add(key); }
    return node;
  };
  const relate = (from: UiElement, to: UiElement, kind: UiRelationKind, evidence: UiRelationEvidence) => {
    if (from.id === to.id && kind !== 'connects-to') return;
    const key = canonical([from.id, to.id, kind]);
    let edge = edges.get(key);
    if (!edge) { edge = { from: from.id, to: to.id, kind, evidence: [] }; edges.set(key, edge); }
    if (!edge.evidence.some(item => canonical(json(item)) === canonical(json(evidence)))) edge.evidence.push(evidence);
  };
  const pageNode = (s: DiscoverySnapshot) => add(canonical({ page: s.url }), 'page', s, null, null, 'page', 'page', s.url);
  const documentNode = (s: DiscoverySnapshot, context: DocumentContext) => {
    const doc = add(canonical({ pageUrl: s.url, document: contextKey(context) }), 'document', s, context, null, 'document', 'document', context.url);
    relate(pageNode(s), doc, 'contains', { snapshotId: s.id, basis: 'document' }); return doc;
  };
  const element = (s: DiscoverySnapshot, context: DocumentContext, locator: LocatorEvidence, key: string, kind: UiElementKind, source: string, label: string, state: unknown = {}) => {
    const stable = locator.unique && !!locator.selector;
    if (!stable) incomplete = true;
    const identity = stable ? locatorIdentity(s.url, context, locator) : canonical({ snapshot: s.id, context: contextKey(context), unresolved: key });
    return add(identity, kind, s, context, locator, stable ? 'locator' : 'snapshot-only', source, label, state);
  };
  const attach = (node: UiElement, s: DiscoverySnapshot, context: DocumentContext, containers?: ObservedContainer[]) => {
    let parent = documentNode(s, context);
    for (const container of containers ?? []) {
      const next = element(s, context, container.locator, container.key, container.kind, 'container', container.label);
      relate(parent, next, 'contains', { snapshotId: s.id, basis: 'dom-containment' }); parent = next;
    }
    relate(parent, node, 'contains', { snapshotId: s.id, basis: containers?.length ? 'dom-containment' : 'document' });
  };

  for (const s of report.snapshots) {
    pageNode(s);
    if (s.truncated || s.unresolvedControls || s.documents.some(d => d.status !== 'scanned')) incomplete = true;
    for (const warning of s.warnings) limitations.add(`${s.id}：${warning}`);
    for (const doc of s.documents) documentNode(s, doc.context);
    for (const [index, c] of s.controls.entries()) {
      const { context, locator, key, containers, popups, options, ...state } = c;
      const node = element(s, context, locator, key, c.category, `controls[${index}]`, c.label, state);
      for (const address of [locator, ...(c.targets ?? [])].filter(l => l.unique && l.selector)) {
        const targetKey = canonical([s.id, locatorIdentity(s.url, context, address)]);
        if (!targets.has(targetKey)) targets.set(targetKey, new Set());
        targets.get(targetKey)!.add(node);
      }
      attach(node, s, context, containers);
      if (containers === undefined) { incomplete = true; limitations.add('报告缺少容器链证据，部分结构关系需重新扫描。'); }
      if (c.dialog && !containers?.some(x => x.kind === 'dialog')) {
        const dialog = element(s, context, c.dialog, `dialog:${key}`, 'dialog', 'control.dialog', '所属弹框');
        relate(dialog, node, 'contains', { snapshotId: s.id, basis: 'dom-containment' });
      }
      if (c.row && !containers?.some(x => x.kind === 'row')) {
        const row = element(s, context, c.row.locator, `row:${key}`, 'row', 'control.row', c.row.key ?? '记录行');
        relate(row, node, 'contains', { snapshotId: s.id, basis: 'dom-containment' });
      }
      for (const popup of popups ?? []) {
        const panel = element(s, context, popup.locator, popup.key, 'panel', 'control.popups', '选项面板');
        relate(node, panel, 'has-popup', { snapshotId: s.id, basis: popup.basis });
      }
      if (c.optionCoverage && c.optionCoverage.status !== 'complete') { incomplete = true; limitations.add('部分控件选项集合不完整或未知；模型仅包含已观察选项。'); }
      const counts = new Map<string, number>();
      for (const option of options) if (option.valueKnown) counts.set(canonical(option.value), (counts.get(canonical(option.value)) ?? 0) + 1);
      for (const [i, option] of options.entries()) {
        const stableValue = node.identityBasis === 'locator' && option.valueKnown && counts.get(canonical(option.value)) === 1;
        const locator = option.locator;
        const choice = locator?.unique && locator.selector
          ? element(s, context, locator, `${key}:option:${i}`, 'option', `controls[${index}].options[${i}]`, option.label, option)
          : add(canonical(stableValue ? { owner: node.id, option: option.value } : { owner: node.id, snapshot: s.id, optionObservation: i }), 'option', s, context, null,
            stableValue ? 'option-value' : 'snapshot-only', `controls[${index}].options[${i}]`, option.label, option);
        relate(node, choice, 'has-option', { snapshotId: s.id, basis: 'observed-options' });
      }
    }
    for (const [i, c] of s.cells.entries()) {
      const { context, locator, key, containers, table, row, ...state } = c;
      const node = element(s, context, locator, key, 'cell', `cells[${i}]`, c.columnLabel, state);
      attach(node, s, context, containers);
      if (containers === undefined) {
        const tableNode = element(s, context, table, `table:${key}`, 'table', 'cell.table', '表格');
        const rowNode = element(s, context, row, `row:${key}`, 'row', 'cell.row', c.rowKey ?? '记录行');
        relate(tableNode, rowNode, 'contains', { snapshotId: s.id, basis: 'dom-containment' });
        relate(rowNode, node, 'contains', { snapshotId: s.id, basis: 'dom-containment' });
      }
    }
    for (const [i, table] of (s.handsontables ?? []).entries()) {
      const { cells, containers, locator, context, key, ...state } = table;
      const source = `handsontables[${i}]`;
      const tableNode = element(s, context, locator, key, 'table', source, 'Handsontable', state);
      attach(tableNode, s, context, containers);
      incomplete = true;
      limitations.add('Handsontable 仅含当前渲染 DOM，单元格身份限当前快照；不代表整份批记录覆盖或原始业务值');
      const rows = new Map<string, UiElement>(), cellNodes = new Map<string, UiElement>();
      const identity = (part: string) => canonical({ snapshot: s.id, context: contextKey(context), table: key, part });
      for (const [ci, cell] of cells.entries()) {
        const rowKey = `${cell.pane}:r${cell.renderedRow}`;
        let row = rows.get(rowKey);
        if (!row) {
          row = add(identity(rowKey), 'row', s, context, null, 'snapshot-only', source, cell.headers.row ?? rowKey, json({ pane: cell.pane, renderedRow: cell.renderedRow }));
          rows.set(rowKey, row); relate(tableNode, row, 'contains', { snapshotId: s.id, basis: 'handsontable-dom' });
        }
        const node = add(identity(cell.key), 'cell', s, context, null, 'snapshot-only', `${source}.cells[${ci}]`, cell.headers.column ?? cell.key, json(cell));
        cellNodes.set(cell.key, node); relate(row, node, 'contains', { snapshotId: s.id, basis: 'handsontable-dom' });
      }
      for (const cell of cells) if (cell.duplicateOf && cellNodes.has(cell.duplicateOf)) relate(cellNodes.get(cell.key)!, cellNodes.get(cell.duplicateOf)!, 'mirrors', { snapshotId: s.id, basis: 'handsontable-dom', detail: 'unique-headers-and-equal-content-format-span' });
    }
    for (const [i, dialog] of s.dialogs.entries()) {
      const node = element(s, dialog.context, dialog.locator, `dialogs[${i}]`, 'dialog', `dialogs[${i}]`, dialog.label);
      attach(node, s, dialog.context, dialog.containers);
    }
    for (const [i, workflow] of (s.workflows ?? []).entries()) {
      const source = `workflows[${i}]`, reading = workflow.reading;
      const graph = element(s, workflow.context, workflow.locator, workflow.key, 'workflow', source, '工作流', { status: reading.status, issues: reading.issues });
      attach(graph, s, workflow.context, workflow.containers);
      if (reading.status !== 'observed') incomplete = true;
      const members = new Map<string, UiElement[]>();
      for (const [ni, node] of reading.nodes.entries()) {
        // A recreated workflow may reuse the same integer ID for a different node.
        const member = add(canonical({ snapshot: s.id, graph: graph.id, nodeObservation: ni }), 'workflow-node', s, workflow.context, null,
          'snapshot-only', `${source}.nodes[${ni}]`, node.name, json(node));
        members.set(node.id, [...(members.get(node.id) ?? []), member]);
        relate(graph, member, 'contains', { snapshotId: s.id, basis: 'workflow-dom' });
      }
      for (const edge of reading.edges) {
        const from = members.get(edge.from), to = members.get(edge.to);
        if (from?.length === 1 && to?.length === 1) relate(from[0]!, to[0]!, 'connects-to', { snapshotId: s.id, basis: 'workflow-dom' });
      }
      limitations.add('工作流节点 ID 仅属于当前工作流快照；执行时必须重新采集并按业务条件唯一匹配，连线不等同于已确认业务断言。');
    }
    for (const [i, region] of (s.regions ?? []).entries()) {
      const kind = ['listbox', 'menu'].includes(region.kind) ? 'panel' : ['form', 'dialog', 'table', 'row', 'panel'].includes(region.kind) ? region.kind as UiElementKind : 'region';
      const node = element(s, region.context, region.locator, `regions[${i}]`, kind, `regions[${i}]`, region.label);
      attach(node, s, region.context, region.containers);
    }
  }

  // 找不到唯一、已观察端点时只记录缺口；计划/动作名称不能替代实际目标证据。
  const lookup = (s: DiscoverySnapshot, context: DocumentContext, address: DomAddress) => {
    const identity = locatorIdentity(s.url, context, address);
    const candidates = new Set(targets.get(canonical([s.id, identity])));
    const node = nodes.get(identity);
    if (node?.observations.some(o => o.snapshotId === s.id)) candidates.add(node);
    return candidates.size === 1 ? [...candidates][0] : undefined;
  };
  const opened = (before: DiscoverySnapshot | undefined, after: DiscoverySnapshot, context: DocumentContext, opener: DomAddress, targets: DomAddress[], destinationContext = context) => {
    const source = before && lookup(before, context, opener);
    const targetsFound = targets.map(address => lookup(after, destinationContext, address)).filter((node): node is UiElement => !!node);
    if (!source || !targetsFound.length) { incomplete = true; limitations.add(`${after.id}：已发生的打开动作缺少可匹配的元素端点，未猜测关系。`); return; }
    for (const target of targetsFound) relate(source, target, 'opens', { snapshotId: after.id, basis: 'verified-transition', detail: `from:${before!.id}` });
  };
  for (const scene of report.plan.scenes) {
    const snapshots = report.snapshots.filter(s => s.sceneId === scene.id && !s.path?.length);
    for (const after of snapshots) {
      if (after.afterStep <= 0) continue;
      const step = scene.steps[after.afterStep - 1];
      const before = snapshots.find(s => s.afterStep === after.afterStep - 1);
      if (!step || !before) continue;
      const path = (scene.framePath ?? []).map(addressKey);
      const context = before.documents.find(d => canonical(d.context.framePath.map(addressKey)) === canonical(path) && d.status === 'scanned')?.context;
      if (context) opened(before, after, context, step.target, [step.expected]);
    }
  }
  for (const result of report.exploration?.results ?? []) {
    if (result.status !== 'explored' || !result.snapshotId) continue;
    const after = report.snapshots.find(s => s.id === result.snapshotId);
    const hop = result.path.at(-1);
    if (!after || !hop?.destination) continue;
    const prefix = result.path.slice(0, -1);
    const before = report.snapshots.find(s => s.sceneId === result.sceneId && canonical(json(s.path ?? [])) === canonical(json(prefix))
      && (prefix.length > 0 || s.afterStep === report.plan.scenes.find(scene => scene.id === result.sceneId)?.steps.length));
    if (hop.destination.kind === 'navigation' || hop.destination.kind === 'popup') {
      const source = before && lookup(before, hop.source, hop.target);
      const destinationContext = { url: hop.destination.frameUrl, framePath: hop.source.framePath };
      const target = hop.destination.kind === 'navigation' && hop.source.framePath.length > 0 && before?.url === after.url
        ? documentNode(after, destinationContext) : pageNode(after);
      if (source) relate(source, target, 'opens', { snapshotId: after.id, basis: 'verified-transition', detail: `from:${before!.id}` });
      else { incomplete = true; limitations.add(`${after.id}：导航入口缺少可靠端点。`); }
    } else {
      const destinationContext = { url: hop.destination.frameUrl, framePath: hop.source.framePath };
      const control = lookup(after, destinationContext, hop.target);
      const panels = hop.destination.kind === 'dropdown' && control
        ? [...edges.values()].filter(e => e.kind === 'has-popup' && e.from === control.id && e.evidence.some(x => x.snapshotId === after.id))
          .map(e => nodes.get(e.to)!.locator).filter((l): l is LocatorEvidence => !!l) : [];
      opened(before, after, hop.source, hop.target, panels.length ? panels : hop.destination.scope, destinationContext);
    }
  }
  for (const s of report.snapshots) for (const association of s.associations) {
    if (!association.parentDialog) continue;
    const parent = lookup(s, association.context, association.parentDialog), child = lookup(s, association.context, association.dialog);
    if (parent && child) relate(parent, child, 'contains', { snapshotId: s.id, basis: 'verified-transition', detail: 'parent-dialog' });
  }

  const draft = await createDiscoveryDraft(report);
  const fieldLinks = draft.fields.flatMap(field => {
    const node = nodes.get(locatorIdentity(field.url, field.context, field.locator));
    return node ? [{ sourceId: field.sourceId, elementId: node.id }] : [];
  });
  const ids = new Map(await Promise.all([...nodes.keys()].map(async key => {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
    return [key, 'ui_' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')] as const;
  })));
  if (new Set(ids.values()).size !== ids.size) throw new Error('UI 元素标识冲突');
  limitations.add('模型仅代表指定扫描范围和状态，不等于完整业务规格、因果依赖或测试通过。');
  return {
    schemaVersion: 1, artifactType: 'ui-element-model', reportId: report.reportId, status: incomplete ? 'partial' : 'observed', businessRules: 'not-inferred',
    snapshots: report.snapshots.map(s => ({ id: s.id, sceneId: s.sceneId, pageUrl: s.url, afterStep: s.afterStep, path: cloneJson(s.path ?? null) })),
    elements: [...nodes.values()].map(node => ({ ...node, id: ids.get(node.id)!, kinds: node.kinds.sort() })).sort((a, b) => a.id.localeCompare(b.id)),
    relations: [...edges.values()].map(edge => ({ ...edge, from: ids.get(edge.from)!, to: ids.get(edge.to)! })).sort((a, b) => canonical([a.from, a.kind, a.to]).localeCompare(canonical([b.from, b.kind, b.to]))),
    configurationFields: fieldLinks.map(link => ({ ...link, elementId: ids.get(link.elementId)! })), limitations: [...limitations],
  };
}

export function findUiRelations(model: UiElementModel, elementId: string, options: { direction?: 'incoming' | 'outgoing' | 'both'; kind?: UiRelationKind; snapshotId?: string } = {}): UiRelation[] {
  if (!model.elements.some(node => node.id === elementId)) throw new Error(`未知 UI 元素：${elementId}`);
  const direction = options.direction ?? 'both';
  return model.relations.filter(edge => (!options.kind || edge.kind === options.kind)
    && (!options.snapshotId || edge.evidence.some(e => e.snapshotId === options.snapshotId))
    && (direction !== 'incoming' && edge.from === elementId || direction !== 'outgoing' && edge.to === elementId));
}

export function renderUiElementModel(model: UiElementModel): string {
  const clean = (value: unknown) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '\\|').replace(/[\r\n]/g, ' ');
  const nodes = new Map(model.elements.map(node => [node.id, node]));
  const name = (id: string) => {
    const node = nodes.get(id)!;
    return clean(`${node.observations[0]?.label || node.kinds.join('/')} · ${node.locator?.selector || node.id}`);
  };
  const kinds: Record<UiRelationKind, string> = { contains: '包含', 'has-option': '具有选项', 'has-popup': '关联浮层', opens: '已观察打开', mirrors: '固定区域副本', 'connects-to': '工作流后继' };
  return ['# UI 元素关系模型', '', `状态：${model.status}；元素：${model.elements.length}；关系：${model.relations.length}；关联配置字段：${model.configurationFields.length}。`,
    '', '身份限定到完整页面 URL、Frame、Shadow 和可靠定位；逐状态值及禁用属性见 ui-model.json 的 observations。未定位项仅作单次观察。模型不授权点击，也不推断业务依赖。',
    '', '## 关系', '', '| 来源 | 联系 | 目标 | 快照与依据 |', '|---|---|---|---|',
    ...model.relations.map(edge => `| ${name(edge.from)} | ${kinds[edge.kind]} | ${name(edge.to)} | ${clean(edge.evidence.map(e => `${e.snapshotId}:${e.basis}`).join('；'))} |`),
    '', '## 限制', '', ...model.limitations.map(item => `- ${clean(item)}`), ''].join('\n');
}
