import type { LocatorEvidence, ObservedControl, ObservedOption, ObservedCell, ObservedContainer, ObservedPopup, OptionCoverage, PageObservation, ScanOptions, DomAddress, EntryEvidence } from "./types.js";
import type { JsonValue } from "../types.js";

/** 同一个自包含浏览器函数供扫描和解析使用，避免两套选择器语义。 */
function browserDOM(request: ScanOptions | { resolve: DomAddress } | { visibility: Element }): PageObservation | Element | boolean | null {
  const normalize = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
  const attr = (name: string, value: string) => `[${name}="${CSS.escape(value)}"]`;
  const rootOf = (el: Element) => el.getRootNode() as Document | ShadowRoot;
  const parentOf = (el: Element): Element | null => el.assignedSlot ?? el.parentElement ?? (rootOf(el) instanceof ShadowRoot ? (rootOf(el) as ShadowRoot).host : null);
  const closest = (el: Element, selector: string): Element | null => {
    for (let n: Element | null = el; n; n = parentOf(n)) if (n.matches(selector)) return n;
    return null;
  };
  const contains = (ancestor: Element, el: Element): boolean => {
    for (let n: Element | null = el; n; n = parentOf(n)) if (n === ancestor) return true;
    return false;
  };
  const visible = (el: Element): boolean => {
    if (!el.getClientRects().length) return false;
    for (let n: Element | null = el; n; n = parentOf(n)) {
      if (n.matches('[hidden],[aria-hidden="true"],[inert]')) return false;
      const s = getComputedStyle(n);
      if (s.display === 'none' || ['hidden', 'collapse'].includes(s.visibility) || s.opacity === '0' || s.contentVisibility === 'hidden') return false;
    }
    return true;
  };
  if ('visibility' in request) return visible(request.visibility);
  const visibleText = (el: Element) => normalize(el instanceof HTMLElement ? el.innerText : el.textContent);
  const hotMenuSelector = '.htMenu.htContextMenu';
  const hotItemSelector = `${hotMenuSelector} .ht_master td`;
  const isHotItem = (el: Element) => el.matches(hotItemSelector) && !el.matches('.htSeparator') && !!el.querySelector('.htItemWrapper');
  const hotMenuShape = (el: Element) => {
    const sub = Array.from(el.classList).filter(c => c.startsWith('htContextMenuSub_'));
    return hotMenuSelector + (sub.length ? sub.map(c => '.' + CSS.escape(c)).join('') : ':not([class*="htContextMenuSub_"])');
  };
  const menuContentCache = new WeakMap<Element, { label: string; shortcut: string | null }>();
  const hotMenuContent = (el: Element) => {
    const cached = menuContentCache.get(el); if (cached) return cached;
    const wrapper = el.querySelector('.htItemWrapper');
    const shortcuts: string[] = [];
    const read = (node: Element): string => {
      if (!visible(node) || node.matches('input,textarea,script,style')) return '';
      const full = visibleText(node);
      // EBR 菜单把快捷键放在独立、右浮动的 span；不按任意尾部数字拆名称。
      if (node !== wrapper && node.children.length === 0 && getComputedStyle(node).float === 'right'
        && /^(?:(?:Ctrl|Alt|Shift|Meta|Cmd|Command)\s*\+\s*)+\S+$/i.test(full)) { shortcuts.push(full); return ''; }
      return Array.from(node.childNodes).map(child => child.nodeType === Node.TEXT_NODE ? child.textContent ?? '' : child instanceof Element ? read(child) : '').join(' ');
    };
    const result = { label: normalize(wrapper ? read(wrapper) : ''), shortcut: shortcuts.length ? shortcuts.join(' / ') : null };
    menuContentCache.set(el, result); return result;
  };
  const iconNames: Record<string, string> = { icon_xiugai: '修改', icon_bianji: '编辑', icon_edit: '编辑', icon_shanchu: '删除', icon_delete: '删除', icon_detail: '详情', icon_chakan: '查看' };
  const iconSelector = Object.keys(iconNames).map(c => 'i.' + c).join(',');
  const iconName = (el: Element) => {
    const names = new Set([el, ...Array.from(el.querySelectorAll(iconSelector))].flatMap(n => Array.from(n.classList).flatMap(c => iconNames[c] ? [iconNames[c]!] : [])));
    return names.size === 1 ? [...names][0]! : '';
  };
  const accessibleName = (el: Element): string => {
    if (isHotItem(el)) return hotMenuContent(el).label;
    const labelled = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean).map(id => rootOf(el).querySelector(attr('id', id))?.textContent ?? '').join(' ');
    if (normalize(labelled)) return normalize(labelled);
    if (el.hasAttribute('aria-label')) return normalize(el.getAttribute('aria-label'));
    if (el.getAttribute('title')) return normalize(el.getAttribute('title'));
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      if (el.labels?.length) return normalize(Array.from(el.labels).map(l => l.textContent).join(' '));
      return '';
    }
    if (el.matches(iconSelector)) return iconName(el);
    return el.matches('button,a,summary,label,legend,caption,h1,h2,h3,h4,h5,h6,[role="button"],[role="menuitem"],[role="tab"],[role="heading"]') ? visibleText(el) || iconName(el) : '';
  };
  type Step = { axis: 'descendant' | 'ancestor' | 'sibling'; selector: string; text?: string; name?: string };
  const encode = (steps: Step[]) => 'anchor=' + JSON.stringify(steps);
  const cssGuard = (css: string) => {
    const syntax = css.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
    if (!css.trim() || /xpath=|:nth-|:first-child|:last-child|:first-of-type|:last-of-type|:eq\(|^\s*\/|(?:^|\s)html\s*>|(?:^|\s)\w+(?:\s*>\s*\w+){2}/i.test(syntax)) throw new Error('禁止脆弱位置或绝对层级定位');
  };
  const stepsOf = (selector: string): Step[] => {
    if (!selector.startsWith('anchor=')) { cssGuard(selector); return [{ axis: 'descendant', selector }]; }
    const steps: unknown = JSON.parse(selector.slice(7));
    if (!Array.isArray(steps) || !steps.length || steps.length > 24) throw new Error('关联定位步骤须为 1..24 项');
    for (const step of steps) {
      if (!step || typeof step !== 'object' || !['descendant', 'ancestor', 'sibling'].includes(step.axis) || typeof step.selector !== 'string'
        || Object.keys(step).some(k => !['axis', 'selector', 'text', 'name'].includes(k))
        || ['text', 'name'].some(k => step[k] !== undefined && (typeof step[k] !== 'string' || !step[k].trim() || step[k].length > 160))) throw new Error('无效关联定位步骤');
      cssGuard(step.selector);
    }
    if (steps[0].axis !== 'descendant') throw new Error('关联定位必须从根内查询开始');
    return steps as Step[];
  };
  // 缓存仅属于这次调用，不跨快照、不复用已经脱离的 DOM 节点。
  const queryCache = new WeakMap<ParentNode, Map<string, Element[]>>();
  const query = (root: Document | ShadowRoot, selector: string): Element[] => {
    let cache = queryCache.get(root); if (!cache) queryCache.set(root, cache = new Map());
    if (cache.has(selector)) return cache.get(selector)!;
    const steps = stepsOf(selector);
    let nodes: (Document | ShadowRoot | Element)[] = [root];
    for (const step of steps) {
      const found = new Set<Element>();
      for (const n of nodes) {
        let candidates: Element[] = [];
        if (step.axis === 'descendant') candidates = Array.from(n.querySelectorAll(step.selector));
        else if (n instanceof Element && step.axis === 'sibling') candidates = Array.from((n.parentElement ?? rootOf(n)).children).filter(e => e !== n && e.matches(step.selector));
        else if (n instanceof Element) for (let p = n.parentElement; p && rootOf(p) === root; p = p.parentElement) if (p.matches(step.selector)) candidates.push(p);
        for (const el of candidates) {
          // 所有地址先排除隐藏目标/祖先，再判断唯一性；等待函数重复执行同一规则。
          if (!visible(el)) continue;
          if (step.text !== undefined && visibleText(el) !== step.text) continue;
          if (step.name !== undefined && accessibleName(el) !== step.name) continue;
          found.add(el);
        }
      }
      nodes = [...found];
      if ('resolve' in request && nodes.length > 1 && nodes.every(n => n instanceof Element && n.matches(hotMenuSelector))) {
        throw new Error('Handsontable 菜单面板不唯一，拒绝从多个面板中猜测目标');
      }
    }
    const result = nodes as Element[]; cache.set(selector, result); return result;
  };
  const resolveAddress = (address: DomAddress): Element | null => {
    let root: Document | ShadowRoot = document;
    for (const part of address.shadowPath ?? []) {
      const hosts = query(root, part);
      if (hosts.length > 1) throw new Error('Shadow 宿主定位不唯一');
      if (!hosts[0]?.shadowRoot) return null;
      root = hosts[0].shadowRoot;
    }
    const matches = query(root, address.selector);
    if (matches.length > 1) throw new Error('根内定位不唯一，拒绝自动取第一个匹配');
    return matches[0] ?? null;
  };
  if ('resolve' in request) return resolveAddress(request.resolve);
  const settings = request;
  const warnings: string[] = [];
  let truncated = false, textCuts = 0;
  const text = (value: string | null | undefined): string => {
    const result = normalize(value);
    if (result.length > settings.maxTextLength) { truncated = true; textCuts++; return result.slice(0, settings.maxTextLength); }
    return result;
  };
  const widgetSelector = '.el-select,.el-cascader,.el-date-editor,.el-input-number,.el-slider,.ivu-select,.ivu-cascader,.ivu-date-picker,.ivu-input-number,.md-select,.md-select-input,.md-select-checkbox';
  const groupSelector = '[role="radiogroup"],.el-radio-group,.ivu-radio-group,.md-radio-group';
  const radioSelector = '.el-radio,.el-radio-button,.ivu-radio-wrapper,.md-radio';
  const checkboxSelector = '.el-checkbox,.el-switch,.ivu-checkbox-wrapper,.md-checkbox';
  const formSelector = '.el-form-item,.ivu-form-item,.md-form-item,.form-item,.field,fieldset';
  const classNames = [...widgetSelector.split(','), ...formSelector.split(','), ...groupSelector.split(','), ...radioSelector.split(','), ...checkboxSelector.split(','), '.ivu-page-options-elevator', '.leftTree', '.md-input'].filter(s => s.startsWith('.')).map(s => s.slice(1));
  const dynamicId = (id: string) => /^(el-|ivu-|radix-|headlessui-|v-)|^ht_[0-9a-f]+$|^(input|select|checkbox|radio|field)[_-]?\d+$|^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id);
  const shape = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    const cls = classNames.find(c => el.classList.contains(c));
    if (cls) return '.' + cls;
    if (el.hasAttribute('role')) return tag + attr('role', el.getAttribute('role')!);
    return tag + (el instanceof HTMLInputElement && el.hasAttribute('type') ? attr('type', el.type) : '');
  };
  const atoms = (el: Element): Step[][] => {
    const tag = el.tagName.toLowerCase(), result: Step[][] = [];
    const add = (selector: string, match?: { name?: string; text?: string }) => result.push([{ axis: 'descendant', selector, ...match }]);
    const testId = el.getAttribute('data-testid'); if (testId) add(attr('data-testid', testId));
    if (el.id && !dynamicId(el.id)) add(attr('id', el.id));
    for (const k of ['name', 'data-field', 'data-prop', 'prop', 'data-row-key', 'data-column-key', 'title', 'label']) {
      const v = el.getAttribute(k); if (v && v.length <= 160 && !dynamicId(v)) add(tag + attr(k, v));
    }
    const name = accessibleName(el);
    if (name && name.length <= 160) add(shape(el), { name });
    const placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.length <= 160) add(tag + attr('placeholder', placeholder));
    if (el.matches('label,legend,caption,h1,h2,h3,h4,h5,h6,[role="heading"],.ivu-form-item-label,.el-form-item__label,.ivu-radio-wrapper,.md-radio')) {
      const t = visibleText(el); if (t && t.length <= 160) add(shape(el), { text: t });
    }
    return result;
  };
  const cues = (el: Element): Step[][] => {
    const result = atoms(el);
    // 使用子节点语义反查组件/区域；不取当前业务输入值或全容器拼接文字作锚点。
    const children = Array.from(el.querySelectorAll('label,legend,caption,h1,h2,h3,h4,h5,h6,[role="heading"],[data-testid],input[id],input[name],.ivu-form-item-label,.el-form-item__label'));
    for (const child of children.slice(0, 16)) {
      if (!visible(child) || child.closest(formSelector) && child.closest(formSelector) !== el && !el.matches(widgetSelector)) continue;
      for (const cue of atoms(child).slice(0, 3)) result.push([...cue, { axis: 'ancestor', selector: shape(el) }]);
    }
    // 命名组件容器本身也是锚点，例如分页跳转区；不退化为匿名 div 层级。
    if (classNames.some(c => el.classList.contains(c))) result.push([{ axis: 'descendant', selector: shape(el) }]);
    return result;
  };
  const localCache = new WeakMap<Element, Omit<LocatorEvidence, 'shadowPath'>>();
  const boundaryCache = new WeakMap<Element, Step[] | null>();
  const localLocator = (el: Element): Omit<LocatorEvidence, 'shadowPath'> => {
    const known = localCache.get(el); if (known) return known;
    const root = rootOf(el);
    const boundary = el.parentElement?.closest('tr[data-row-key],[role="row"][data-row-key],[role="dialog"],dialog,[role="region"],[role="group"],form[aria-label],section[aria-label]');
    if (boundary && !boundaryCache.has(boundary)) {
      boundaryCache.set(boundary, cues(boundary).find(path => {
        const matches = query(root, encode(path));
        return matches.length === 1 && matches[0] === boundary;
      }) ?? null);
    }
    const scope = boundary ? boundaryCache.get(boundary) : null;
    const accept = (steps: Step[], basis: LocatorEvidence['basis']) => {
      // 即使当前名称全局唯一，也优先绑定所属区域，避免打开同名弹框后身份漂移。
      if (scope && basis !== 'test-id' && basis !== 'id'
        && JSON.stringify(steps.slice(0, scope.length)) !== JSON.stringify(scope)) steps = [...scope, ...steps];
      if (steps.length > 24) return null;
      const only = steps[0]!;
      const selector = steps.length === 1 && only.text === undefined && only.name === undefined ? only.selector : encode(steps);
      const matches = query(root, selector);
      if (matches.length !== 1 || matches[0] !== el) return null;
      const hit = { selector, basis, unique: true }; localCache.set(el, hit); return hit;
    };
    if (el === document.body) { const hit = { selector: 'body', basis: 'semantic' as const, unique: true }; localCache.set(el, hit); return hit; }
    if (el.matches(hotMenuSelector) || isHotItem(el)) {
      const panel = el.matches(hotMenuSelector) ? el : el.closest(hotMenuSelector)!;
      // 必须先有唯一可见面板；不靠菜单内某个偶然唯一的词推断它属于哪张表。
      const panelSteps: Step[] = [{ axis: 'descendant', selector: hotMenuShape(panel) }];
      const panels = query(root, encode(panelSteps));
      const name = isHotItem(el) ? accessibleName(el) : '';
      if (panels.length === 1 && panels[0] === panel && (el === panel || name && name.length <= 160)) {
        const path = el === panel ? panelSteps : [...panelSteps, { axis: 'descendant' as const, selector: '.ht_master td', name }];
        const hit = accept(path, el === panel ? 'semantic' : 'relation'); if (hit) return hit;
      }
      const missing = { selector: '', basis: 'unresolved' as const, unique: false, reason: 'Handsontable 菜单面板或精确名称不唯一，或名称为空/超长；未使用随机 ID 和序号' };
      localCache.set(el, missing); return missing;
    }
    const own = atoms(el);
    for (const steps of own) {
      const basis = steps[0]!.selector.startsWith('[data-testid=') ? 'test-id' : steps[0]!.selector.startsWith('[id=') ? 'id' : 'semantic';
      const hit = accept(steps, basis); if (hit) return hit;
    }
    for (const steps of cues(el).filter(s => s.length > 1)) { const hit = accept(steps, 'relation'); if (hit) return hit; }
    // 同层顺序无关的兄弟关系，不使用 +、nth、XPath [1]。
    const siblingPaths: Step[][] = [];
    for (const sibling of Array.from((el.parentElement ?? rootOf(el)).children).filter(e => e !== el && visible(e)).slice(0, 16)) {
      for (const cue of atoms(sibling).slice(0, 3)) siblingPaths.push([...cue, { axis: 'sibling', selector: shape(el) }]);
    }
    for (const path of siblingPaths) { const hit = accept(path, 'relation'); if (hit) return hit; }
    let tails: Step[][] = [...own, [{ axis: 'descendant' as const, selector: shape(el) }], ...siblingPaths].slice(0, 12);
    for (let parent = el.parentElement, depth = 0; parent && parent !== document.body && depth < 8; parent = parent.parentElement, depth++) {
      const anchors = cues(parent).slice(0, 12);
      const combinations: Step[][] = [];
      for (const anchor of anchors) for (const tail of tails) {
        const path = [...anchor, ...tail]; if (path.length > 24) continue;
        const hit = accept(path, 'relation'); if (hit) return hit;
        combinations.push(path);
      }
      // 保留最近字段标签作为相对路径，再用上层命名区域消除同名歧义。
      if (combinations.length) tails = [...combinations.slice(0, 8), ...tails.slice(0, 4)];
    }
    const unresolved = { selector: '', basis: 'unresolved' as const, unique: false, reason: '缺少可唯一回查的稳定属性或父子/兄弟语义锚点' };
    localCache.set(el, unresolved); return unresolved;
  };
  const locatorCache = new WeakMap<Element, LocatorEvidence>();
  const locator = (el: Element): LocatorEvidence => {
    const known = locatorCache.get(el); if (known) return known;
    const shadowPath: string[] = []; let root = rootOf(el), failed = false;
    while (root instanceof ShadowRoot) { const host = localLocator(root.host); shadowPath.unshift(host.selector); failed ||= !host.unique; root = rootOf(root.host); }
    const local = localLocator(el);
    const result: LocatorEvidence = failed ? { selector: '', shadowPath, basis: 'unresolved', unique: false, reason: '开放 Shadow 宿主缺少可靠定位' } : { ...local, shadowPath };
    locatorCache.set(el, result); return result;
  };
  const deepQuery = (root: Element | ShadowRoot, selector: string, depth = root instanceof ShadowRoot ? locator(root.host).shadowPath.length + 1 : locator(root).shadowPath.length): Element[] => {
    const found = Array.from(root.querySelectorAll(selector));
    const elements = [...(root instanceof Element ? [root] : []), ...Array.from(root.querySelectorAll("*"))];
    for (const element of elements) if (element.shadowRoot && visible(element)) {
      if (depth >= settings.maxShadowDepth) { truncated = true; warnings.push(`Shadow 深度预算不足：${localLocator(element).selector}`); }
      else found.push(...deepQuery(element.shadowRoot, selector, depth + 1));
    }
    return found;
  };
  const framePath = settings.framePath.map(a => ({ selector: a.selector, shadowPath: a.shadowPath ?? [] }));
  const context = { url: location.href, framePath };
  let observationSequence = 0;
  const unresolvedIds = new WeakMap<Element, number>();
  const identity = (hint: LocatorEvidence, element: Element) => {
    if (!hint.unique && !unresolvedIds.has(element)) unresolvedIds.set(element, ++observationSequence);
    return JSON.stringify([framePath, hint.shadowPath, hint.unique ? hint.selector : { unresolvedObservation: unresolvedIds.get(element) }]);
  };
  const label = (element: Element): string => {
    if (isHotItem(element)) return text(hotMenuContent(element).label);
    if (element.matches('button,a,summary,[role="button"],[role="menuitem"]') || element.matches(iconSelector)) {
      const actionName = accessibleName(element); if (actionName) return text(actionName);
    }
    const labelled = element.getAttribute("aria-labelledby")?.split(/\s+/).map((id) => rootOf(element).querySelector(attr("id", id))?.textContent ?? "").join(" ");
    if (labelled?.trim()) return text(labelled);
    const aria = element.getAttribute("aria-label");
    if (aria) return text(aria);
    if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
      if (element.labels?.length) return text(Array.from(element.labels).map((x) => x.textContent).join(" "));
    }
    const inner = element.querySelector<HTMLInputElement>("input[aria-label],input[id]");
    if (inner) {
      const result = inner.getAttribute("aria-label") || (inner.labels?.length ? Array.from(inner.labels).map((x) => x.textContent).join(" ") : "");
      if (result) return text(result);
    }
    if (element.id) {
      const linked = rootOf(element).querySelector(`label${attr("for", element.id)}`);
      if (linked) return text(linked.textContent);
    }
    const near = element.closest("label") ?? element.closest(formSelector)?.querySelector("label,.ivu-form-item-label,.el-form-item__label,legend");
    return text(near?.textContent || element.getAttribute("placeholder") || element.getAttribute("title") || element.textContent || element.getAttribute("name") || element.tagName);
  };
  const dialogSelector = '[role="dialog"],[role="alertdialog"],dialog,.ivu-modal,.ivu-drawer-content';
  const isHotRoot = (el: Element) => el.matches('.handsontable') && !closest(el, '.htMenu') && Array.from(el.children).some(c => c.matches('.ht_master'));
  const hotRoot = (el: Element): Element | null => { for (let n: Element | null = el; n; n = parentOf(n)) if (isHotRoot(n)) return n; return null; };
  const tableSelector = '.ivu-table-wrapper,.vxe-table';
  const containerKind = (el: Element): ObservedContainer['kind'] | null => {
    if (el.matches(hotMenuSelector)) return 'panel';
    if (closest(el, '.htMenu') && el.matches('table,tr,[role="row"]')) return null;
    if (isHotRoot(el)) return 'table';
    if (hotRoot(el) && el.matches('table,tr,[role="row"]')) return null;
    if (el.matches(dialogSelector)) return 'dialog';
    if (el.matches('form,.ivu-form,.el-form')) return 'form';
    if (el.matches(tableSelector)) return 'table';
    if (el.matches('table,[role="grid"],[role="table"],[role="treegrid"]') && !closest(parentOf(el) ?? el, tableSelector)) return 'table';
    if (el.matches('tr,[role="row"]')) return 'row';
    if (el.matches('[role="listbox"],[role="menu"],.ivu-select-dropdown,.md-down,.el-select-dropdown')) return 'panel';
    return el.matches('[role="region"],section[aria-label],[role="tabpanel"],fieldset') ? 'region' : null;
  };
  const containerCache = new WeakMap<Element, ObservedContainer[]>();
  const containers = (el: Element): ObservedContainer[] => {
    const known = containerCache.get(el); if (known) return known;
    const result: ObservedContainer[] = [];
    for (let parent = parentOf(el); parent; parent = parentOf(parent)) {
      const kind = containerKind(parent);
      if (!kind || !visible(parent)) continue;
      const hint = locator(parent);
      // 容器名称不拼接其全部表单值、整表数据或敏感输入。
      result.unshift({ key: identity(hint, parent), kind, label: text(accessibleName(parent) || parent.getAttribute('data-testid') || kind), locator: hint });
    }
    containerCache.set(el, result); return result;
  };
  const disabled = (element: Element) => element.matches(":disabled") || closest(element, '[aria-disabled="true"],[inert]') !== null
    || isHotItem(element) && element.matches('.htDisabled,.htSelectionDisabled');
  const scopeRoots = settings.scopes.map((address, i) => {
    if ((address.shadowPath?.length ?? 0) > settings.maxShadowDepth) throw new Error("指定 Shadow 扫描区域超过深度预算");
    let root: Element | null;
    try { root = resolveAddress(address); } catch (error) {
      if (error instanceof Error && error.message.includes('不唯一')) throw new Error(`扫描区域不唯一：${error.message}`);
      throw error;
    }
    if (!root && i === 0 && settings.scopes.length === 1) throw new Error(`扫描区域不存在或不可见：${address.selector}`);
    return root;
  }).filter((root): root is Element => !!root && visible(root));
  // 模态弹框可能把原编辑器设为 inert/aria-hidden，仍应扫描已关联的可见弹框。
  if (!scopeRoots.length) throw new Error("扫描区域不可见：没有可读取的原区域或关联弹框");
  const controlQuery = 'input:not([type="hidden"]),textarea,select,button,a,summary,[role="link"],[role="menuitem"],[role="checkbox"],[role="radio"],[role="switch"],[role="combobox"],[role="textbox"],[role="spinbutton"],[role="slider"],[role="tab"],[role="button"],[contenteditable="true"],' + iconSelector + ',' + hotItemSelector;
  const raw = scopeRoots.flatMap((root) => [...(root.matches(controlQuery) ? [root] : []), ...deepQuery(root, controlQuery)]);
  const roots = new Set<Element>();
  const canonicalCache = new WeakMap<Element, Element>();
  for (const element of new Set(raw)) {
    if (closest(element, '[data-discovery-ignore="true"]')) continue;
    if (closest(element, '.htMenu') && !isHotItem(element)) continue;
    let candidate = canonicalCache.get(element);
    if (!candidate) {
      let component = element.closest(widgetSelector);
      // 仅合并已知组件封装；不删除任意祖先内的独立输入框。
      if (component) for (let outer = component.parentElement?.closest(widgetSelector); outer; outer = component.parentElement?.closest(widgetSelector)) component = outer;
      const nativeType = element instanceof HTMLInputElement ? element.type : '';
      const semantic = element.parentElement?.closest('[role="combobox"],[role="switch"],[role="checkbox"],[role="radio"],[role="slider"]');
      const choice = nativeType === 'radio' || element.matches('[role="radio"]') ? element.closest(radioSelector)
        : nativeType === 'checkbox' || element.matches('[role="checkbox"],[role="switch"]') ? element.closest(checkboxSelector) : null;
      const compatible = semantic && (['combobox', 'slider'].includes(semantic.getAttribute('role') ?? '') || nativeType === 'checkbox' && semantic.matches('[role="checkbox"],[role="switch"]') || nativeType === 'radio' && semantic.matches('[role="radio"]'));
      const actionOwner = element.matches(iconSelector) ? element.closest('button,a,summary,[role="button"],[role="menuitem"]') : null;
      const owner = actionOwner ?? component ?? choice ?? (compatible ? semantic : null);
      candidate = owner && scopeRoots.some(root => contains(root, owner)) ? owner : element;
      canonicalCache.set(element, candidate);
    }
    if (visible(candidate)) roots.add(candidate);
  }
  if (roots.size > settings.maxControls) { truncated = true; warnings.push(`控件数量超过上限 ${settings.maxControls}`); }
  const controls: ObservedControl[] = [];
  const groupedRadios = new Set<Element>();
  for (const element of Array.from(roots).slice(0, settings.maxControls)) {
    if (groupedRadios.has(element)) continue;
    const cutsBefore = textCuts;
    const input = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement ? element : element.querySelector<HTMLInputElement>("input,textarea,select");
    const roleElement = element.hasAttribute("role") ? element : element.querySelector("[role]");
    const role = roleElement?.getAttribute("role") ?? "";
    const nativeType = input instanceof HTMLInputElement ? input.type : "";
    let kind = role || (element instanceof HTMLButtonElement || element.tagName === "SUMMARY" || element.matches(iconSelector) ? "button" : element instanceof HTMLAnchorElement ? "link" : element instanceof HTMLSelectElement ? "select" : nativeType || "text");
    if (isHotItem(element)) kind = 'menuitem';
    if (element.matches(".el-select,.ivu-select,.md-select,.md-select-input,.md-select-checkbox")) kind = "combobox";
    if (element.matches(".el-cascader,.ivu-cascader")) kind = "cascader";
    if (element.matches(".el-input-number,.ivu-input-number")) kind = "number";
    if (element.matches(".el-slider")) kind = "slider";
    if (element.matches(".el-date-editor,.ivu-date-picker")) kind = /datetimerange|daterange|timerange/.test(element.className) ? "date-range" : /datetime/.test(element.className) ? "datetime" : /--time/.test(element.className) ? "time" : "date";
    const notes: string[] = [];
    const sensitive = nativeType === "password" || /^(current-password|new-password|one-time-code)$/.test(input?.getAttribute("autocomplete") ?? "");
    const action = ["button", "link", "menuitem", "submit", "reset", "tab"].includes(kind);
    let hint: LocatorEvidence = locator(element);
    const attributes: Record<string, string> = {};
    for (const name of ["data-testid", "type", "name", "min", "max", "step", "minlength", "maxlength", "pattern", "inputmode", "placeholder", "accept", "aria-haspopup", "aria-controls", "aria-expanded", "aria-selected", "aria-multiselectable", "href", "target"]) {
      const value = element.getAttribute(name) ?? input?.getAttribute(name) ?? roleElement?.getAttribute(name);
      if (value !== null && value !== undefined) attributes[name] = text(value);
    }
    let currentValue: JsonValue = null;
    let valueKnown = !action && !sensitive;
    let options: ObservedOption[] = [];
    let optionCoverage: OptionCoverage | null = null;
    let optionNodes: Element[] = [], popupNodes: Element[] = [];
    const popupEvidence = new Map<Element, ObservedPopup['basis']>();
    let multiple: boolean | null = element instanceof HTMLSelectElement ? element.multiple : ["combobox", "cascader"].includes(kind) ? null : false;
    if (roleElement?.hasAttribute("aria-multiselectable")) multiple = roleElement.getAttribute("aria-multiselectable") === "true";
    let fieldLabel = label(element);
    let key = identity(hint, element);
    if (sensitive) { kind = "password"; notes.push("敏感字段：不采集值，不生成取值候选"); }
    else if (kind === "file") { valueKnown = false; notes.push("文件上传需人工定义样本，本次不读取文件路径"); }
    else if (kind === "radio" || nativeType === "radio") {
      const nativeRadio = input instanceof HTMLInputElement && input.type === 'radio' ? input : null;
      const ariaGroup = element.closest(groupSelector);
      const nativeFor = (item: Element) => item instanceof HTMLInputElement ? item : item.querySelector<HTMLInputElement>('input[type="radio"]');
      const radios = Array.from(roots).filter((item) => {
        const other = nativeFor(item);
        if (ariaGroup) return !!(other?.type === 'radio' || item.getAttribute('role') === 'radio') && item.closest(groupSelector) === ariaGroup;
        if (nativeRadio?.name) return other?.type === 'radio' && other.name === nativeRadio.name && rootOf(other) === rootOf(nativeRadio) && other.form === nativeRadio.form && other.closest('[role="dialog"],[role="alertdialog"],dialog') === nativeRadio.closest('[role="dialog"],[role="alertdialog"],dialog');
        return ariaGroup ? item.getAttribute('role') === 'radio' && item.closest('[role="radiogroup"]') === ariaGroup : item === element;
      });
      radios.forEach((x) => groupedRadios.add(x));
      const group = ariaGroup ?? element.closest('fieldset') ?? nativeRadio?.form ?? element.closest('[role="dialog"],[role="alertdialog"],dialog') ?? rootOf(element).querySelector('body') ?? element.parentElement ?? element;
      const groupLocator = locator(group);
      // 单选组地址指向组本身，不把多个 radio 的集合伪装成唯一元素。
      const nativeNames = new Set(Array.from(group.querySelectorAll('input[type="radio"]')).map(el => (el as HTMLInputElement).name));
      hint = ariaGroup || group.matches('fieldset') || nativeNames.size === 1 ? { ...groupLocator, basis: groupLocator.unique ? 'radio-group' : 'unresolved' }
        : { selector: '', shadowPath: groupLocator.shadowPath, basis: 'unresolved', unique: false, reason: '多个单选组共用匿名容器，缺少稳定分组边界' };
      key = identity(hint, element);
      kind = "radio-group";
      fieldLabel = text(group.getAttribute("aria-label") || group.querySelector("legend")?.textContent || nativeRadio?.name || label(element));
      optionNodes = radios;
      options = radios.map((x) => {
        const native = nativeFor(x);
        const value = native ? native.getAttribute('value') : x.getAttribute('data-value') ?? x.getAttribute('value');
        return { label: label(x), value, valueKnown: value !== null, selected: native ? native.checked : x.getAttribute('aria-checked') === 'true', disabled: disabled(x) || !!native && disabled(native), locator: locator(x) };
      });
      const selected = options.find((x) => x.selected);
      currentValue = selected?.value ?? null;
      valueKnown = selected?.valueKnown ?? true;
    } else if (element instanceof HTMLSelectElement) {
      kind = element.multiple ? "multiselect" : "select";
      currentValue = element.multiple ? Array.from(element.selectedOptions).map((x) => x.value) : element.value;
      optionCoverage = { status: "complete", source: "native-select", observedCount: element.options.length, totalCount: element.options.length, reasons: ["原生 select 当前 DOM 选项集合；不证明远程业务全集"] };
      options = Array.from(element.options).map((x) => ({ label: text(x.label), value: x.value, valueKnown: true, selected: x.selected, disabled: x.disabled || x.parentElement instanceof HTMLOptGroupElement && x.parentElement.disabled }));
    } else if (["checkbox", "switch"].includes(kind) || nativeType === "checkbox") {
      const checked = roleElement?.getAttribute("aria-checked");
      currentValue = input instanceof HTMLInputElement ? input.checked : checked === 'true' ? true : checked === 'false' ? false : null;
      valueKnown = currentValue !== null;
      if (roleElement?.getAttribute("aria-checked") === "mixed") { currentValue = "mixed"; notes.push("不确定态需要单独确认取值与行为"); }
    } else if (["combobox", "cascader"].includes(kind)) {
      const owners = [element, ...Array.from(element.querySelectorAll("[aria-controls],[aria-owns]"))];
      const popupRoots = new Set<Element>();
      for (const owner of owners) for (const id of `${owner.getAttribute("aria-controls") ?? ""} ${owner.getAttribute("aria-owns") ?? ""}`.trim().split(/\s+/)) {
        const popup = rootOf(owner).querySelector(attr("id", id));
        if (popup && visible(popup)) { popupRoots.add(popup); popupEvidence.set(popup, 'aria'); }
      }
      if (settings.popup) {
        const opener = resolveAddress(settings.popup.opener);
        const popup = resolveAddress(settings.popup.popup);
        if (opener && popup && visible(popup) && (contains(element, opener) || contains(opener, element))) { popupRoots.add(popup); popupEvidence.set(popup, 'explicit-step'); }
      }
      // EBR/JTH src/libs/test-id.js 的明确约定：输入 base、触发器 base-trigger、所属浮层 base-panel。
      // 仅限已识别的 md/iView 组件；不按任意名称前缀猜关系，也不读取 Vue 私有状态。
      if (!popupRoots.size && element.matches('.ivu-select,.ivu-cascader,.md-select,.md-select-input,.md-select-checkbox')) {
        const bases = new Set([element, ...Array.from(element.querySelectorAll('input[data-testid],[data-testid$="-trigger"]'))]
          .filter(visible).map(node => node.getAttribute('data-testid')?.replace(/-trigger$/, '')).filter((id): id is string => !!id));
        const matches = new Set<Element>();
        for (const base of bases) {
          const candidates = query(rootOf(element), attr('data-testid', base + '-panel'));
          const inputs = query(rootOf(element), attr('data-testid', base));
          const owners = inputs.length ? inputs : query(rootOf(element), attr('data-testid', base + '-trigger'));
          if (candidates.length === 1 && owners.length === 1 && contains(element, owners[0]!)) matches.add(candidates[0]!);
        }
        if (matches.size === 1) { const popup = [...matches][0]!; popupRoots.add(popup); popupEvidence.set(popup, 'test-id-contract'); }
        else if (matches.size > 1) notes.push('组件 test-id 对应多个面板，未建立归属关系');
      }
      const optionElements = new Set<Element>();
      for (const popup of popupRoots) {
        if (popup.hasAttribute("aria-multiselectable")) multiple = popup.getAttribute("aria-multiselectable") === "true";
        const selectDropdown = popup.closest('.el-select-dropdown');
        if (selectDropdown) multiple = selectDropdown.classList.contains('is-multiple');
        for (const option of deepQuery(popup, '[role="option"],[role="menuitem"],[role="menuitemcheckbox"],[role="treeitem"],.el-cascader-node,.ivu-select-item:not(.select-all),ul.md-down-ul > li')) if (visible(option)) optionElements.add(option);
      }
      optionNodes = Array.from(optionElements); popupNodes = Array.from(popupRoots);
      options = optionNodes.map((x) => {
        const value = x.getAttribute("data-value") ?? x.getAttribute("value");
        return { label: text(x.textContent), value, valueKnown: value !== null, selected: x.getAttribute("aria-selected") === "true" || x.getAttribute("aria-checked") === "true", disabled: disabled(x), locator: locator(x) };
      });
      // 页面显示文本不能冒充组件 v-model 的业务值。
      currentValue = element.matches(".el-select") ? text(element.textContent) : input?.value ?? text(element.textContent);
      valueKnown = false;
      notes.push("当前值是显示内容；业务值映射及多选语义需确认", "下拉仅覆盖已渲染选项，远程、分页或虚拟列表不保证穷尽");
      if (multiple === null) notes.push("当前 DOM 未公开单选/多选语义，不默认认定为单选");
      if (!options.length) notes.push("尚未观察到选项，需要指定展开入口或组件适配");
    } else if (kind === "slider") {
      const thumbs = Array.from(element.querySelectorAll('[role="slider"]'));
      if (element.getAttribute('role') === 'slider') thumbs.unshift(element);
      const values = thumbs.map((thumb) => thumb.getAttribute('aria-valuenow')).map((value) => value !== null && Number.isFinite(Number(value)) ? Number(value) : null);
      currentValue = values.length === 1 ? values[0]! : values;
      valueKnown = values.length > 0 && values.every((value) => value !== null);
      for (const name of ['aria-valuemin', 'aria-valuemax']) {
        const value = thumbs[0]?.getAttribute(name);
        if (value !== null && value !== undefined) attributes[name] = value;
      }
    } else if (kind === "date-range") {
      currentValue = Array.from(element.querySelectorAll<HTMLInputElement>("input")).map((x) => x.value);
      notes.push("日期区间仅记录显示文本，业务格式与时区需确认");
    } else if (!action) {
      if (input) currentValue = input.value;
      else if (kind === "slider" || kind === "spinbutton") currentValue = element.getAttribute("aria-valuenow");
      else currentValue = text(element.textContent);
      if (nativeType === "number" && input instanceof HTMLInputElement && Number.isFinite(input.valueAsNumber)) currentValue = input.valueAsNumber;
      if (!input && ["slider", "spinbutton"].includes(kind) && currentValue !== null && Number.isFinite(Number(currentValue))) currentValue = Number(currentValue);
    }
    if (!optionCoverage && ["combobox", "cascader", "radio-group"].includes(kind)) {
      const sizeTexts = optionNodes.map(node => node.getAttribute("aria-setsize"));
      const sizes = sizeTexts.map(value => value !== null && /^\d+$/.test(value) ? Number(value) : null);
      const totals = new Set(sizes.filter((n): n is number => n !== null && n > 0));
      const totalCount = totals.size === 1 ? [...totals][0]! : null;
      const positions = optionNodes.map(node => Number(node.getAttribute("aria-posinset") ?? NaN));
      const busy = [...popupNodes, element].some(node => !!closest(node, '[aria-busy="true"]') || !!node.querySelector('[aria-busy="true"]'));
      const complete = !busy && totalCount !== null && sizes.every(n => n === totalCount) && positions.length === totalCount && new Set(positions).size === totalCount && positions.every(n => Number.isInteger(n) && n >= 1 && n <= totalCount);
      const partial = busy || totalCount !== null && options.length < totalCount;
      optionCoverage = {
        status: complete ? "complete" : partial ? "partial" : "unknown",
        source: totals.size ? "aria-setsize" : "rendered-dom", observedCount: options.length, totalCount,
        reasons: [busy ? "选项仍在加载" : complete ? "当前声明集合的总数与全部位置一致；不证明系统业务全集" : partial ? "只观察到声明集合的一部分" : "没有足够且一致的总数/位置证据"],
      };
    }
    if (options.length > settings.maxOptions) { truncated = true; notes.push(`选项超过上限 ${settings.maxOptions}，已截断`); options = options.slice(0, settings.maxOptions); }
    if (optionCoverage) {
      if (closest(element, '[aria-busy="true"]')) {
        optionCoverage.status = "partial"; optionCoverage.reasons.push("选项所属区域仍在加载");
      }
      if (optionCoverage.observedCount > options.length || textCuts > cutsBefore) {
        optionCoverage.status = "partial"; optionCoverage.reasons.push("选项数量或文本被采集预算截断");
      }
      optionCoverage.observedCount = options.length;
    }
    if (typeof currentValue === "string" && currentValue.length > settings.maxTextLength) {
      currentValue = currentValue.slice(0, settings.maxTextLength); valueKnown = false; truncated = true; notes.push("当前值已截断，不作为完整候选值");
    }
    if (!hint.unique) { notes.push(hint.reason ?? "未找到可靠定位"); warnings.push(`未定位控件：${fieldLabel}；${hint.reason}`); }
    if (action) valueKnown = false;
    let entry: EntryEvidence | undefined;
    if (action || ['combobox', 'cascader', 'date', 'datetime', 'time', 'date-range'].includes(kind)) {
      const make = (entryKind: EntryEvidence['kind'], intent: EntryEvidence['intent'], allowed: boolean, reason: string): EntryEvidence => ({ kind: entryKind, intent, allowed, reason });
      const confirmation = (settings.confirmationEntries ?? []).find(item => {
        if (JSON.stringify((item.framePath ?? []).map(a => ({ selector: a.selector, shadowPath: a.shadowPath ?? [] }))) !== JSON.stringify(framePath)) return false;
        try { return resolveAddress(item.target) === element; } catch { return false; }
      });
      const deletion = /删除|移除|\b(delete|remove)\b/i.test(fieldLabel);
      const destructive = /保存|提交|发布|重置|确认|确定|取消|关闭|返回|启用|停用|禁用|执行|启动|停止|审核|审批|撤回|撤销|复制|导入|导出|下载|打印|上传|\b(save|submit|publish|reset|confirm|cancel|close|back|apply|ok|enable|disable|run|start|stop|approve|revoke|copy|import|export|download|print|upload)\b/i.test(fieldLabel);
      if (destructive) entry = make('open-entry', 'expand', false, '可能修改数据或结束当前界面，只采集不点击');
      else if (deletion) entry = confirmation ? { ...make('open-confirmation', 'delete', true, '已配置仅打开确认弹框，弹框为探索终点'), expected: confirmation.expected } : make('open-confirmation', 'delete', false, '删除入口未配置预期确认弹框，只采集不点击');
      else if (kind === 'tab') entry = make('activate-tab', 'expand', attributes['aria-selected'] !== 'true', attributes['aria-selected'] === 'true' ? '标签页已经选中' : '标签页展示入口');
      else if (['combobox', 'cascader', 'date', 'datetime', 'time', 'date-range'].includes(kind) || attributes['aria-haspopup'] === 'listbox' || attributes['aria-haspopup'] === 'menu') entry = make('open-dropdown', 'expand', attributes['aria-expanded'] !== 'true', '展开选项，不选择值');
      else if (/^(新增|新建|添加)|^(add|new|create)(\b|\s)/i.test(fieldLabel)) entry = make('open-entry', 'create', true, '新增表单入口');
      else if (/^(修改|编辑)|^edit\b/i.test(fieldLabel)) entry = make('open-entry', 'edit', true, '编辑表单入口');
      else if (/^(详情|查看|预览|展示|打开|展开|配置|高级配置|更多)|^(view|details?|preview|open|expand|more)\b/i.test(fieldLabel) || attributes['aria-haspopup'] === 'dialog' || attributes['aria-expanded'] === 'false' && !!attributes['aria-controls']) entry = make('open-entry', 'view', true, '展示入口');
      else entry = make('open-entry', 'expand', false, '无法确认是展示功能，只采集不点击');
      if (!hint.unique) { entry.allowed = false; entry.reason = hint.reason ?? '缺少唯一可靠定位'; }
      if (disabled(element) || !!input && disabled(input)) { entry.allowed = false; entry.reason = '入口禁用'; }
      if (element instanceof HTMLButtonElement && element.form && element.type === 'submit' || ['submit', 'reset', 'file'].includes(nativeType)) { entry.allowed = false; entry.reason = '禁止提交表单或文件操作'; }
      if (element instanceof HTMLAnchorElement && (element.hasAttribute('download') || !/^(https?:|#|\/|\.\/|\.\.\/)/i.test(element.getAttribute('href') ?? '#') && element.getAttribute('href')?.includes(':'))) { entry.allowed = false; entry.reason = '不执行下载或脚本协议链接'; }
      if (isHotItem(element)) { entry.allowed = false; entry.reason = 'Handsontable 菜单仅采集；执行或展开须由明确测试步骤控制'; }
    }
    const menuPanel = isHotItem(element) ? element.closest(hotMenuSelector)! : null;
    if (menuPanel) notes.push('仅观察已展开菜单；业务命令键、源表格和父菜单归属未知，不能根据文字或位置推断');
    const actionRow = action && !menuPanel ? closest(element, 'tr,[role="row"]') : null;
    controls.push({ key, context, optionCoverage, category: action ? "action" : "field", kind, label: fieldLabel, locator: hint, currentValue, valueKnown,
      disabled: kind === 'radio-group' ? options.every((option) => option.disabled) : disabled(element) || !!input && disabled(input), readOnly: input?.hasAttribute("readonly") ?? false,
      required: element.getAttribute("aria-required") === "true" || input?.hasAttribute("required") === true,
      multiple, attributes, options, notes, containers: containers(element),
      ...(menuPanel ? { menu: { component: 'handsontable' as const, panelKind: Array.from(menuPanel.classList).some(c => c.startsWith('htContextMenuSub_')) ? 'submenu' as const : 'context-menu' as const,
        hasSubmenu: element.classList.contains('htSubmenu'), shortcut: hotMenuContent(element).shortcut ? text(hotMenuContent(element).shortcut) : null,
        ownerTable: null, parentItem: null } } : {}),
      targets: element.matches(widgetSelector) ? Array.from(element.querySelectorAll('input:not([type="hidden"]),textarea,.ivu-select-selection,.ivu-select-arrow,.ivu-input-icon,.el-select__wrapper')).filter(visible).map(locator).filter(l => l.unique) : [],
      popups: [...popupEvidence].map(([node, basis]) => { const address = locator(node); return { key: identity(address, node), locator: address, basis }; }),
      ...(entry ? { entry } : {}), ...(actionRow ? { row: { locator: locator(actionRow), key: actionRow.getAttribute('data-row-key') } } : {}), dialog: closest(element, dialogSelector) ? locator(closest(element, dialogSelector)!) : null });
  }
  const scoped = (query: string) => [...new Set(scopeRoots.flatMap(root => [...(root.matches(query) ? [root] : []), ...deepQuery(root, query)]))].filter(el => visible(el) && !closest(el, '[data-discovery-ignore="true"]'));
  const dialogs = scoped(dialogSelector).map(el => ({ label: label(el), locator: locator(el), context, containers: containers(el) }));
  const regionNodes = settings.includeRegions ? scoped('form,.ivu-form,.el-form,[role="region"],section[aria-label],[role="tabpanel"],[role="menu"],[role="listbox"],details,.el-drawer,.ivu-drawer,' + hotMenuSelector) : [];
  if (regionNodes.length > settings.maxControls) truncated = true;
  const regions = regionNodes.slice(0, settings.maxControls).map(el => ({ label: text(accessibleName(el) || el.getAttribute('data-testid') || containerKind(el) || el.tagName.toLowerCase()), kind: el.matches(hotMenuSelector) ? 'menu' : el.getAttribute('role') ?? (containerKind(el) === 'form' ? 'form' : el.tagName.toLowerCase()), locator: locator(el), context, displayText: settings.includeRegionText === false ? '' : text(visibleText(el)), containers: containers(el) }));
  const frames = scoped("iframe").map(locator);
  const workflowRoots = scoped('[data-workflow="mes"]');
  if (workflowRoots.length > settings.maxControls) { truncated = true; warnings.push('工作流数量超过容器预算'); }
  const workflowTargets = workflowRoots.slice(0, settings.maxControls).map(el => ({ key: identity(locator(el), el), locator: locator(el), context, containers: containers(el) }));
  const hotRoots = scoped('.handsontable').filter(isHotRoot);
  if (hotRoots.length > settings.maxControls) { truncated = true; warnings.push('Handsontable 数量超过容器预算'); }
  const handsontableTargets = hotRoots.slice(0, settings.maxControls).map(el => ({ key: identity(locator(el), el), locator: locator(el), context, containers: containers(el) }));
  const cellNodes = scoped('td,th,[role="cell"],[role="gridcell"],[role="columnheader"],[role="rowheader"]').filter(el => !hotRoot(el) && !closest(el, '.htMenu'));
  const cells: ObservedCell[] = [];
  if (cellNodes.length > settings.maxCells) { truncated = true; warnings.push(`单元格数量超过上限 ${settings.maxCells}`); }
  for (const cell of cellNodes.slice(0, settings.maxCells)) {
    const table = closest(cell, tableSelector) ?? closest(cell, 'table,[role="grid"],[role="table"],[role="treegrid"]');
    const row = closest(cell, 'tr,[role="row"]');
    if (!table || !row) continue;
    const siblings = Array.from(row.querySelectorAll('td,th,[role="cell"],[role="gridcell"],[role="columnheader"],[role="rowheader"]')).filter(el => closest(el, 'tr,[role="row"]') === row);
    const declaredIndex = Number(cell.getAttribute("aria-colindex"));
    const columnIndex = Number.isInteger(declaredIndex) && declaredIndex > 0 ? declaredIndex : siblings.slice(0, siblings.indexOf(cell)).reduce((n, el) => n + (Number(el.getAttribute("colspan")) || 1), 1);
    const headers = Array.from(table.querySelectorAll('thead th,[role="columnheader"]')).filter(el => (closest(el, tableSelector) ?? closest(el, 'table,[role="grid"],[role="table"],[role="treegrid"]')) === table);
    const header = headers.find((el, i) => (Number(el.getAttribute("aria-colindex")) || i + 1) === columnIndex);
    const columnLabel = text(header instanceof HTMLElement ? header.innerText : header?.textContent);
    const fullText = (cell instanceof HTMLElement ? cell.innerText : cell.textContent ?? "").replace(/\s+/g, " ").trim();
    const displayTruncated = fullText.length > settings.maxTextLength;
    const notes: string[] = [];
    let businessValue: JsonValue = null, valueKnown = false;
    const rawValue = cell.getAttribute("data-discovery-value");
    if (rawValue !== null) {
      try {
        if (rawValue.length > settings.maxTextLength) { truncated = true; throw new Error("显式业务值超过文本预算"); }
        const parsed: unknown = JSON.parse(rawValue);
        const valid = (v: unknown): boolean => v === null || typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v) || Array.isArray(v) && v.every(valid) || typeof v === 'object' && v !== null && Object.values(v).every(valid);
        if (rawValue.length <= settings.maxTextLength && valid(parsed)) { businessValue = parsed as JsonValue; valueKnown = true; }
        else notes.push("显式业务值超限或不是有限 JSON 值，未采集");
      } catch { notes.push("显式业务值超限或不是合法 JSON，未采集"); }
    }
    if (!valueKnown) notes.push("未获得业务值，不能从显示文本反推");
    if (displayTruncated) notes.push("显示文本已截断");
    const hint = locator(cell);
    const rowIndex = Number(row.getAttribute("aria-rowindex")) || (row instanceof HTMLTableRowElement ? row.rowIndex + 1 : null);
    cells.push({ key: identity(hint, cell), context, locator: hint, table: locator(table), row: locator(row),
      rowKey: row.getAttribute("data-row-key"), rowIndex,
      columnKey: cell.getAttribute("data-column-key"), columnIndex, columnLabel,
      displayText: text(fullText), displayTruncated, businessValue, valueKnown,
      valueSource: valueKnown ? "explicit-dom-json" : "unknown", notes, containers: containers(cell) });
  }
  return { url: location.href, controls, cells, dialogs, frames, regions, handsontableTargets, workflowTargets, pageLabels: [text(document.title), ...scoped('h1,h2,[role="heading"]').map(el => text(visibleText(el)))], warnings: [...new Set(warnings)], truncated, unresolvedControls: controls.filter(c => !c.locator.unique).length };
}

// 类型化入口共享同一个函数体，Playwright 序列化后也不依赖模块闭包。
export const scanDocument = browserDOM as (settings: ScanOptions) => PageObservation;
export const resolveDomElement = browserDOM as (request: { resolve: DomAddress }) => Element | null;
/** Frame 协调器对已取得的宿主节点复用同一可见性规则。 */
export const checkDomVisibility = browserDOM as (request: { visibility: Element }) => boolean;
