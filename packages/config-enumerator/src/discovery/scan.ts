import type { LocatorEvidence, ObservedControl, ObservedOption, ObservedCell, OptionCoverage, PageObservation, ScanOptions, DomAddress } from "./types.js";
import type { JsonValue } from "../types.js";

/** 完整序列化到每个 Frame 执行，不读取 Vue 实例。 */
export function scanDocument(settings: ScanOptions): PageObservation {
  const warnings: string[] = [];
  let truncated = false, textCuts = 0;
  const text = (value: string | null | undefined): string => {
    const result = (value ?? "").replace(/\s+/g, " ").trim();
    if (result.length > settings.maxTextLength) { truncated = true; textCuts++; return result.slice(0, settings.maxTextLength); }
    return result;
  };
  const parentOf = (element: Element): Element | null => element.parentElement ?? (element.getRootNode() instanceof ShadowRoot ? (element.getRootNode() as ShadowRoot).host : null);
  const closest = (element: Element, selector: string): Element | null => {
    for (let node: Element | null = element; node; node = parentOf(node)) if (node.matches(selector)) return node;
    return null;
  };
  const contains = (ancestor: Element, element: Element): boolean => {
    for (let node: Element | null = element; node; node = parentOf(node)) if (node === ancestor) return true;
    return false;
  };
  const visible = (element: Element): boolean => {
    if (!element.getClientRects().length) return false;
    for (let node: Element | null = element; node; node = parentOf(node)) {
      if (node.matches('[hidden],[aria-hidden="true"],[inert]')) return false;
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
    }
    return true;
  };
  const attr = (name: string, value: string) => `[${name}="${CSS.escape(value)}"]`;
  const rootOf = (element: Element) => element.getRootNode() as Document | ShadowRoot;
  const localLocator = (element: Element): Omit<LocatorEvidence, "shadowPath"> => {
    const root = rootOf(element);
    const testId = element.getAttribute("data-testid");
    if (testId && root.querySelectorAll(attr("data-testid", testId)).length === 1) return { selector: attr("data-testid", testId), basis: "test-id", unique: true };
    if (element.id && !/^(el-|radix-|headlessui-)/.test(element.id) && root.querySelectorAll(attr("id", element.id)).length === 1) return { selector: attr("id", element.id), basis: "id", unique: true };
    const componentClass = ["el-select", "el-cascader", "el-date-editor", "el-slider", "el-input-number"].find((name) => element.classList.contains(name));
    const stableChild = Array.from(element.querySelectorAll('input[id]')).find((child) => !/^(el-|radix-|headlessui-)/.test(child.id) && root.querySelectorAll(attr("id", child.id)).length === 1);
    if (componentClass && stableChild) return { selector: `.${componentClass}:has(${attr("id", stableChild.id)})`, basis: "id", unique: true };
    const parts: string[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const parent = node.parentNode as ParentNode;
      const index = Array.from(parent.children).indexOf(node) + 1;
      parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
    }
    const selector = parts.join(" > ");
    return { selector, basis: "structure", unique: root.querySelectorAll(selector).length === 1 };
  };
  const locator = (element: Element): LocatorEvidence => {
    const shadowPath: string[] = [];
    let root = rootOf(element);
    while (root instanceof ShadowRoot) { shadowPath.unshift(localLocator(root.host).selector); root = rootOf(root.host); }
    return { ...localLocator(element), shadowPath };
  };
  const resolveAddress = (address: DomAddress): Element | null => {
    let root: Document | ShadowRoot = document;
    for (const selector of address.shadowPath ?? []) {
      const hosts: NodeListOf<Element> = root.querySelectorAll(selector);
      if (hosts.length > 1) throw new Error(`Shadow 宿主定位不唯一：${selector}`);
      if (!hosts[0]?.shadowRoot) return null;
      root = hosts[0].shadowRoot;
    }
    const matches = root.querySelectorAll(address.selector);
    if (matches.length > 1) throw new Error(`扫描区域不唯一：${address.selector}`);
    return matches[0] ?? null;
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
  const identity = (hint: LocatorEvidence) => JSON.stringify([framePath, hint.shadowPath, hint.selector]);
  const label = (element: Element): string => {
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
    const near = element.closest("label") ?? element.closest(".field")?.querySelector(":scope > label");
    return text(near?.textContent || element.getAttribute("placeholder") || element.getAttribute("title") || element.textContent || element.getAttribute("name") || element.tagName);
  };
  const disabled = (element: Element) => element.matches(":disabled") || closest(element, '[aria-disabled="true"],[inert]') !== null;
  const scopeRoots = settings.scopes.map((address, i) => {
    if ((address.shadowPath?.length ?? 0) > settings.maxShadowDepth) throw new Error("指定 Shadow 扫描区域超过深度预算");
    const root = resolveAddress(address);
    if (!root && i === 0) throw new Error(`扫描区域不存在：${address.selector}`);
    return root;
  }).filter((root): root is Element => !!root && visible(root));
  // 模态弹框可能把原编辑器设为 inert/aria-hidden，仍应扫描已关联的可见弹框。
  if (!scopeRoots.length) throw new Error("扫描区域不可见：没有可读取的原区域或关联弹框");
  const query = 'input:not([type="hidden"]),textarea,select,button,[role="checkbox"],[role="radio"],[role="switch"],[role="combobox"],[role="textbox"],[role="spinbutton"],[role="slider"],[role="tab"],[role="button"],[contenteditable="true"]';
  const raw = scopeRoots.flatMap((root) => [...(root.matches(query) ? [root] : []), ...deepQuery(root, query)]);
  const roots = new Set<Element>();
  for (const element of raw) {
    if (closest(element, '[data-discovery-ignore="true"]')) continue;
    const component = element.closest(".el-slider") ?? element.closest(".el-select,.el-cascader,.el-date-editor,.el-input-number");
    const semantic = element.parentElement?.closest('[role="combobox"],[role="switch"],[role="checkbox"],[role="radio"],[role="slider"]');
    const candidate = component && scopeRoots.some(root => contains(root, component)) ? component : semantic && scopeRoots.some(root => contains(root, semantic)) ? semantic : element;
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
    let kind = role || (element instanceof HTMLButtonElement ? "button" : element instanceof HTMLSelectElement ? "select" : nativeType || "text");
    if (element.matches(".el-select")) kind = "combobox";
    if (element.matches(".el-cascader")) kind = "cascader";
    if (element.matches(".el-input-number")) kind = "number";
    if (element.matches(".el-slider")) kind = "slider";
    if (element.matches(".el-date-editor")) kind = /datetimerange|daterange|timerange/.test(element.className) ? "date-range" : /datetime/.test(element.className) ? "datetime" : /--time/.test(element.className) ? "time" : "date";
    const notes: string[] = [];
    const sensitive = nativeType === "password" || /^(current-password|new-password|one-time-code)$/.test(input?.getAttribute("autocomplete") ?? "");
    const action = ["button", "submit", "reset", "tab"].includes(kind);
    const hint: LocatorEvidence = locator(element);
    const attributes: Record<string, string> = {};
    for (const name of ["type", "name", "min", "max", "step", "minlength", "maxlength", "pattern", "inputmode", "placeholder", "accept", "aria-haspopup", "aria-expanded", "aria-multiselectable"]) {
      const value = element.getAttribute(name) ?? input?.getAttribute(name) ?? roleElement?.getAttribute(name);
      if (value !== null && value !== undefined) attributes[name] = text(value);
    }
    let currentValue: JsonValue = null;
    let valueKnown = !action && !sensitive;
    let options: ObservedOption[] = [];
    let optionCoverage: OptionCoverage | null = null;
    let optionNodes: Element[] = [], popupNodes: Element[] = [];
    let multiple: boolean | null = element instanceof HTMLSelectElement ? element.multiple : ["combobox", "cascader"].includes(kind) ? null : false;
    if (roleElement?.hasAttribute("aria-multiselectable")) multiple = roleElement.getAttribute("aria-multiselectable") === "true";
    let fieldLabel = label(element);
    let key = identity(hint);
    if (sensitive) { kind = "password"; notes.push("敏感字段：不采集值，不生成取值候选"); }
    else if (kind === "file") { valueKnown = false; notes.push("文件上传需人工定义样本，本次不读取文件路径"); }
    else if (kind === "radio" || nativeType === "radio") {
      const nativeRadio = input instanceof HTMLInputElement && input.type === 'radio' ? input : null;
      const ariaGroup = element.closest('[role="radiogroup"]');
      const nativeFor = (item: Element) => item instanceof HTMLInputElement ? item : item.querySelector<HTMLInputElement>('input[type="radio"]');
      const radios = Array.from(roots).filter((item) => {
        const other = nativeFor(item);
        if (nativeRadio?.name) return other?.type === 'radio' && other.name === nativeRadio.name && rootOf(other) === rootOf(nativeRadio) && other.form === nativeRadio.form && other.closest('[role="dialog"],dialog') === nativeRadio.closest('[role="dialog"],dialog');
        return ariaGroup ? item.getAttribute('role') === 'radio' && item.closest('[role="radiogroup"]') === ariaGroup : item === element;
      });
      radios.forEach((x) => groupedRadios.add(x));
      const group = ariaGroup ?? element.closest('fieldset') ?? nativeRadio?.form ?? element.closest('[role="dialog"],dialog') ?? rootOf(element).querySelector('body') ?? element.parentElement ?? element;
      const groupLocator = locator(group);
      hint.selector = nativeRadio?.name ? `${groupLocator.selector} input[type="radio"]${attr("name", nativeRadio.name)}` : ariaGroup ? `${groupLocator.selector} [role="radio"]` : hint.selector;
      hint.basis = "radio-group";
      hint.unique = rootOf(element).querySelectorAll(hint.selector).length === radios.length;
      key = identity(hint);
      kind = "radio-group";
      fieldLabel = text(group.getAttribute("aria-label") || group.querySelector("legend")?.textContent || nativeRadio?.name || label(element));
      optionNodes = radios;
      options = radios.map((x) => {
        const native = nativeFor(x);
        const value = native ? native.getAttribute('value') : x.getAttribute('data-value') ?? x.getAttribute('value');
        return { label: label(x), value, valueKnown: value !== null, selected: native ? native.checked : x.getAttribute('aria-checked') === 'true', disabled: disabled(x) || !!native && disabled(native) };
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
        if (popup && visible(popup)) popupRoots.add(popup);
      }
      if (settings.popup) {
        const opener = resolveAddress(settings.popup.opener);
        const popup = resolveAddress(settings.popup.popup);
        if (opener && popup && visible(popup) && (contains(element, opener) || contains(opener, element))) popupRoots.add(popup);
      }
      const optionElements = new Set<Element>();
      for (const popup of popupRoots) {
        if (popup.hasAttribute("aria-multiselectable")) multiple = popup.getAttribute("aria-multiselectable") === "true";
        const selectDropdown = popup.closest('.el-select-dropdown');
        if (selectDropdown) multiple = selectDropdown.classList.contains('is-multiple');
        for (const option of deepQuery(popup, '[role="option"],[role="menuitem"],[role="menuitemcheckbox"],[role="treeitem"],.el-cascader-node')) if (visible(option)) optionElements.add(option);
      }
      optionNodes = Array.from(optionElements); popupNodes = Array.from(popupRoots);
      options = optionNodes.map((x) => {
        const value = x.getAttribute("data-value") ?? x.getAttribute("value");
        return { label: text(x.textContent), value, valueKnown: value !== null, selected: x.getAttribute("aria-selected") === "true" || x.getAttribute("aria-checked") === "true", disabled: disabled(x) };
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
    if (hint.basis === "structure") notes.push("使用结构性定位，建议补充稳定 testid 并确认定位");
    if (action) valueKnown = false;
    controls.push({ key, context, optionCoverage, category: action ? "action" : "field", kind, label: fieldLabel, locator: hint, currentValue, valueKnown,
      disabled: kind === 'radio-group' ? options.every((option) => option.disabled) : disabled(element) || !!input && disabled(input), readOnly: input?.hasAttribute("readonly") ?? false,
      required: element.getAttribute("aria-required") === "true" || input?.hasAttribute("required") === true,
      multiple, attributes, options, notes, dialog: closest(element, '[role="dialog"],dialog') ? locator(closest(element, '[role="dialog"],dialog')!) : null });
  }
  const scoped = (query: string) => [...new Set(scopeRoots.flatMap(root => [...(root.matches(query) ? [root] : []), ...deepQuery(root, query)]))].filter(el => visible(el) && !closest(el, '[data-discovery-ignore="true"]'));
  const dialogs = scoped('[role="dialog"],dialog').map(el => ({ label: label(el), locator: locator(el), context }));
  const frames = scoped("iframe").map(locator);
  const cellNodes = scoped('td,th,[role="cell"],[role="gridcell"],[role="columnheader"],[role="rowheader"]');
  const cells: ObservedCell[] = [];
  if (cellNodes.length > settings.maxCells) { truncated = true; warnings.push(`单元格数量超过上限 ${settings.maxCells}`); }
  for (const cell of cellNodes.slice(0, settings.maxCells)) {
    const table = closest(cell, 'table,[role="grid"],[role="table"],[role="treegrid"]');
    const row = closest(cell, 'tr,[role="row"]');
    if (!table || !row) continue;
    const siblings = Array.from(row.querySelectorAll('td,th,[role="cell"],[role="gridcell"],[role="columnheader"],[role="rowheader"]')).filter(el => closest(el, 'tr,[role="row"]') === row);
    const declaredIndex = Number(cell.getAttribute("aria-colindex"));
    const columnIndex = Number.isInteger(declaredIndex) && declaredIndex > 0 ? declaredIndex : siblings.slice(0, siblings.indexOf(cell)).reduce((n, el) => n + (Number(el.getAttribute("colspan")) || 1), 1);
    const headers = Array.from(table.querySelectorAll('thead th,[role="columnheader"]')).filter(el => closest(el, 'table,[role="grid"],[role="table"],[role="treegrid"]') === table);
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
    cells.push({ key: identity(hint), context, locator: hint, table: locator(table), row: locator(row),
      rowKey: row.getAttribute("data-row-key"), rowIndex,
      columnKey: cell.getAttribute("data-column-key"), columnIndex, columnLabel,
      displayText: text(fullText), displayTruncated, businessValue, valueKnown,
      valueSource: valueKnown ? "explicit-dom-json" : "unknown", notes });
  }
  return { url: location.href, controls, cells, dialogs, frames, warnings: [...new Set(warnings)], truncated };
}
