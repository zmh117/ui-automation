import type { Frame } from 'playwright';
import { findElement } from './dom.js';
import { fingerprintReport } from './discover.js';
import type { DiscoveryReport, DocumentContext, DomAddress, LocatorEvidence, ObservedContainer } from './types.js';

export interface HandsontableTarget {
  key: string; locator: LocatorEvidence; context: DocumentContext; containers: ObservedContainer[];
}
export interface HandsontableCell {
  key: string; pane: string; renderedRow: number; renderedColumn: number;
  headers: { row: string | null; column: string | null; uniqueInPane: boolean };
  identityBasis: 'snapshot-only';
  displayText: string; displayTruncated: boolean;
  businessValue: null; valueKnown: false; valueSource: 'unknown';
  merge: { rowSpan: number; colSpan: number };
  format: Record<string, string> | null;
  parts: {
    kind: string; text: string; value: string | boolean | null; valueKnown: boolean;
    checked: boolean | null; disabled: boolean; readOnly: boolean | null;
    loaded: boolean | null; format: Record<string, string> | null;
  }[];
  contentTruncated: boolean; duplicateOf: string | null; notes: string[];
}
export interface HandsontableReading {
  status: 'observed' | 'limited' | 'unavailable';
  cells: HandsontableCell[];
  coverage: {
    scope: 'rendered-dom'; totalCells: null; allDataCovered: false;
    renderedDataCells: number; inspectedCells: number; observedCells: number; skippedHiddenCells: number;
    truncated: boolean; reasons: string[];
  };
  elapsedMs: number;
}
export interface HandsontableObservation extends HandsontableTarget, HandsontableReading {}
export interface HandsontableReadOptions { maxCells?: number; maxTextLength?: number; includeStyles?: boolean }

/** 自包含，只读 DOM；不访问 Vue/Handsontable 私有实例，不触发滚动、重绘或编辑。 */
export function readHandsontableDOM(root: Element, options: HandsontableReadOptions = {}): HandsontableReading {
  const start = performance.now();
  const maxCells = options.maxCells ?? 300, maxText = options.maxTextLength ?? 500;
  if (!Number.isInteger(maxCells) || maxCells < 0 || maxCells > 5000 || !Number.isInteger(maxText) || maxText < 1 || maxText > 10000) throw new Error('Handsontable 读取预算无效');
  const parent = (el: Element): Element | null => el.assignedSlot ?? el.parentElement ?? ((el.getRootNode() as ShadowRoot).host || null);
  const visibility = new WeakMap<Element, boolean>();
  const allowed = (el: Element): boolean => {
    const cached = visibility.get(el); if (cached !== undefined) return cached;
    const s = getComputedStyle(el), p = parent(el);
    const result = el.isConnected && !el.matches('[hidden],[aria-hidden="true"],[inert],[data-discovery-ignore="true"]')
      && s.display !== 'none' && !['hidden', 'collapse'].includes(s.visibility) && s.opacity !== '0' && s.contentVisibility !== 'hidden' && (!p || allowed(p));
    visibility.set(el, result); return result;
  };
  const visible = (el: Element) => el.getClientRects().length > 0 && allowed(el);
  if (!visible(root)) throw new Error('Handsontable 根节点不存在或不可见');
  const isRoot = (el: Element) => el.matches('.handsontable') && Array.from(el.children).some(c => c.matches('.ht_master'));
  if (!isRoot(root)) throw new Error('目标不是支持的 Handsontable 根节点（需要直属 ht_master）');
  const owner = (el: Element): Element | null => { for (let n: Element | null = el; n; n = parent(n)) if (isRoot(n)) return n; return null; };
  const reasons = new Set<string>(['只观察当前渲染 DOM；未加载任务、未渲染行列与隐藏区域不属于已验证范围', '标题与渲染位置仅用于当前快照，未验证稳定业务身份', '未读取原始业务值、数值格式配置或后端结果']);
  let truncated = false;
  const clip = (text: string) => { if (text.length > maxText) truncated = true; return text.slice(0, maxText); };
  // 避免 textContent 把隐藏后代/密码等代理输入带入报告；保留换行与前后缀。
  const text = (el: Element): string => {
    if (!visible(el)) return '';
    if (el.matches('input,textarea,select,script,style')) return '';
    let result = '', afterBlock = false;
    for (const node of Array.from(el.childNodes)) {
      if (node instanceof Element && !visible(node)) continue;
      const part = node.nodeType === Node.TEXT_NODE ? node.textContent ?? '' : node instanceof Element ? node.tagName === 'BR' ? '\n' : text(node) : '';
      if (!part) continue;
      const block = node instanceof Element && /^(block|flex|grid|table|list-item)/.test(getComputedStyle(node).display);
      if ((block || afterBlock) && result && !result.endsWith('\n') && !part.startsWith('\n')) result += '\n';
      result += part; afterBlock = block;
    }
    return result;
  };
  const properties = ['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-align', 'vertical-align', 'white-space', 'text-decoration-line', 'border-top', 'border-right', 'border-bottom', 'border-left'];
  const style = (el: Element) => { if (options.includeStyles === false) return null; const css = getComputedStyle(el); return Object.fromEntries(properties.map(p => [p, css.getPropertyValue(p)])); };
  const cells: HandsontableCell[] = [];
  let renderedDataCells = 0, inspectedCells = 0, skippedHiddenCells = 0;
  const tables = Array.from(root.querySelectorAll<HTMLTableElement>('table.htCore')).filter(t => owner(t) === root);
  const paneOf = (table: Element) => Array.from(table.closest('.ht_master,[class*="ht_clone_"]')?.classList ?? []).find(c => c === 'ht_master' || c.startsWith('ht_clone_')) ?? 'unknown';
  // 6.x 把主表表头设为 visibility:hidden，真正可见的标题在固定区域。
  // 只从已知对应 pane 的可见标题按屏幕轴对齐读取，不读取隐藏标题的文本。
  const headerPanes: Record<string, { row: string[]; column: string[] }> = {
    ht_master: { row: ['ht_clone_left'], column: ['ht_clone_top'] },
    ht_clone_top: { row: ['ht_clone_top_left_corner'], column: [] },
    ht_clone_bottom: { row: ['ht_clone_bottom_left_corner'], column: [] },
    ht_clone_left: { row: [], column: ['ht_clone_top_left_corner'] },
  };
  const visibleHeaders = tables.flatMap(table => Array.from(table.querySelectorAll<HTMLTableCellElement>('th')).filter(visible).map(th => ({
    pane: paneOf(table), axis: th.closest('thead') ? 'column' : 'row', rect: th.getBoundingClientRect(),
    span: th.closest('thead') ? th.colSpan : th.rowSpan, label: text(th).trim(),
  })));
  const alignedHeader = (td: Element, pane: string, axis: 'row' | 'column'): string | null => {
    const names = headerPanes[pane]?.[axis] ?? [], rect = td.getBoundingClientRect();
    const matches = visibleHeaders.filter(h => names.includes(h.pane) && h.axis === axis && h.span === 1 && h.label && Math.abs(axis === 'row' ? h.rect.top - rect.top : h.rect.left - rect.left) <= 1.01);
    return matches.length === 1 ? matches[0]!.label : null;
  };
  const paneCounts = new Map<string, number>();
  for (const table of tables) {
    const paneName = paneOf(table);
    const count = paneCounts.get(paneName) ?? 0; paneCounts.set(paneName, count + 1);
    const pane = count ? `${paneName}:${count}` : paneName;
    const rows = Array.from(table.tBodies).flatMap(body => Array.from(body.rows));
    const headings = table.tHead?.rows.length === 1 ? Array.from(table.tHead.rows[0]!.cells) : [];
    // HOT 6.x 保留被合并覆盖的 TD 槽位；cellIndex 对应同一 pane 的表头槽位。
    const columnLabels = headings.map(h => visible(h) && h.colSpan === 1 ? text(h).trim() : '');
    const rowLabels = rows.map(row => { const hs = Array.from(row.cells).filter(c => c.tagName === 'TH'); return hs.length === 1 && visible(hs[0]!) ? text(hs[0]!).trim() : ''; });
    for (const [ri, row] of rows.entries()) for (const td of Array.from(row.cells).filter(c => c.tagName === 'TD')) {
      renderedDataCells++;
      if (!visible(td)) { skippedHiddenCells++; continue; }
      if (inspectedCells >= maxCells) { truncated = true; reasons.add('单元格读取预算不足'); continue; }
      inspectedCells++;
      const ci = td.cellIndex, rowHeader = rowLabels[ri] || alignedHeader(td, paneName, 'row'), columnHeader = columnLabels[ci] || alignedHeader(td, paneName, 'column');
      const fullText = text(td), partElements = Array.from(td.querySelectorAll('input,textarea,select,button,a,img,.control-text,[role="checkbox"],[role="radio"]')).filter(el => owner(el) === root && visible(el));
      let contentTruncated = fullText.length > maxText || partElements.length > 16;
      const parts = partElements.slice(0, 16).map(el => {
        const nativeInput = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
        const secret = el instanceof HTMLInputElement && el.type === 'password' || /^(current-password|new-password|one-time-code)$/.test(el.getAttribute('autocomplete') ?? '');
        const check = el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type);
        const partText = text(el), value = nativeInput && !secret ? check ? (el as HTMLInputElement).checked : el.value : null;
        if (partText.length > maxText || typeof value === 'string' && value.length > maxText) contentTruncated = true;
        return { kind: el.tagName.toLowerCase(), text: clip(partText), value: typeof value === 'string' ? clip(value) : value,
          valueKnown: nativeInput && !secret, checked: check ? (el as HTMLInputElement).checked : el.hasAttribute('aria-checked') ? el.getAttribute('aria-checked') === 'true' : null,
          disabled: el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true',
          readOnly: nativeInput ? el.hasAttribute('readonly') : null,
          loaded: el instanceof HTMLImageElement ? el.complete && el.naturalWidth > 0 : null, format: style(el) };
      });
      truncated ||= contentTruncated;
      const uniqueTitle = (axis: 'row' | 'column', title: string | null, own: boolean) => {
        const names = own ? [paneName] : headerPanes[paneName]?.[axis] ?? [];
        return !!title && visibleHeaders.filter(h => names.includes(h.pane) && h.axis === axis && h.label === title).length === 1;
      };
      const uniqueInPane = uniqueTitle('row', rowHeader, !!rowLabels[ri]) && uniqueTitle('column', columnHeader, !!columnLabels[ci]);
      cells.push({ key: `${pane}:r${ri}:c${ci}`, pane, renderedRow: ri, renderedColumn: ci,
        headers: { row: rowHeader ? clip(rowHeader) : null, column: columnHeader ? clip(columnHeader) : null, uniqueInPane: uniqueInPane && rowHeader!.length <= maxText && columnHeader!.length <= maxText },
        identityBasis: 'snapshot-only', displayText: clip(fullText), displayTruncated: fullText.length > maxText,
        businessValue: null, valueKnown: false, valueSource: 'unknown', merge: { rowSpan: td.rowSpan, colSpan: td.colSpan },
        format: style(td), parts, contentTruncated, duplicateOf: null,
        notes: uniqueInPane ? [] : ['标题缺失、重复或结构不支持，只能记录当前 pane 的渲染位置'] });
    }
  }
  // 同名标题映射到不同渲染槽位时保留歧义；该检查不把标题提升为业务身份。
  const headerSlots = new Map<string, Set<number>>();
  for (const c of cells) for (const axis of ['row', 'column'] as const) {
    const key = JSON.stringify([c.pane, axis, c.headers[axis]]), slots = headerSlots.get(key) ?? new Set<number>();
    slots.add(axis === 'row' ? c.renderedRow : c.renderedColumn); headerSlots.set(key, slots);
  }
  for (const c of cells) if (['row', 'column'].some(axis => (headerSlots.get(JSON.stringify([c.pane, axis, c.headers[axis as 'row' | 'column']]))?.size ?? 0) !== 1)) {
    c.headers.uniqueInPane = false; c.notes.push('同名标题对应多个渲染槽位');
  }
  // 同一个标题坐标跨 pane 相同才建立副本联系；冲突不能选第一个冒充成功。
  const groups = new Map<string, HandsontableCell[]>();
  for (const cell of cells) if (cell.headers.uniqueInPane) {
    const key = JSON.stringify([cell.headers.row, cell.headers.column]);
    const group = groups.get(key) ?? []; group.push(cell); groups.set(key, group);
  }
  const signature = (c: HandsontableCell) => JSON.stringify([c.displayText, c.merge, c.format, c.parts]);
  for (const group of groups.values()) if (group.length > 1) {
    if (group.every(c => !c.contentTruncated && signature(c) === signature(group[0]!))) {
      const primary = group.find(c => c.pane === 'ht_master') ?? group[0]!;
      for (const cell of group) if (cell !== primary) cell.duplicateOf = primary.key;
    } else { reasons.add('相同标题坐标存在副本冲突或截断'); for (const cell of group) cell.notes.push('相同标题坐标副本不一致，禁止自动选择'); }
  }
  if (!tables.length || !cells.length) reasons.add('未观察到可读数据格，不能断言表格为空');
  if (truncated) reasons.add('预算或文本/子内容截断，未采集部分不可用于断言');
  return { status: truncated ? 'limited' : 'observed', cells,
    coverage: { scope: 'rendered-dom', totalCells: null, allDataCovered: false, renderedDataCells, inspectedCells, observedCells: cells.length, skippedHiddenCells, truncated, reasons: [...reasons] },
    elapsedMs: Math.round((performance.now() - start) * 100) / 100 };
}

/** address 必须定位到 HotTable 根节点；复用 Frame/Shadow 与唯一可见性检查。 */
export async function readHandsontable(frame: Frame, address: DomAddress, options: HandsontableReadOptions = {}): Promise<HandsontableReading> {
  const root = await findElement(frame, address);
  if (!root) throw new Error('Handsontable 外层定位不存在或不可见');
  try { return await root.evaluate(readHandsontableDOM, options); }
  finally { await root.dispose(); }
}

/** 从一个快照按标题查找；多个无一致副本证明的候选必须失败，不返回第一项。 */
export function requireHandsontableCell(reading: HandsontableReading, query: { rowHeader: string; columnHeader: string; pane?: string }): HandsontableCell {
  const matches = reading.cells.filter(c => c.headers.row === query.rowHeader && c.headers.column === query.columnHeader && (!query.pane || c.pane === query.pane));
  const primary = query.pane ? matches : matches.filter(c => !c.duplicateOf);
  if (primary.length !== 1 || !primary[0]!.headers.uniqueInPane || primary[0]!.contentTruncated) throw new Error('单元格未观察、标题不唯一、内容截断或固定区域副本存在歧义');
  return primary[0]!;
}

export async function createHandsontableReport(report: DiscoveryReport) {
  if (report.schemaVersion !== 3 || report.artifactType !== 'page-discovery' || report.reportId !== await fingerprintReport(report)) throw new Error('发现报告格式或指纹不匹配');
  return { schemaVersion: 1 as const, artifactType: 'handsontable-observations' as const, reportId: report.reportId,
    expectedValues: 'not-inferred' as const,
    snapshots: report.snapshots.map(s => ({ snapshotId: s.id, sceneId: s.sceneId, pageUrl: s.url, tables: s.handsontables ?? [] })),
  };
}
