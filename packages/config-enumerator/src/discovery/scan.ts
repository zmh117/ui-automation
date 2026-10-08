import type { LocatorEvidence, ObservedControl, ObservedOption, PageObservation, ScanOptions } from "./types.js";
import type { JsonValue } from "../types.js";

/** 该函数完整序列化到页面执行；不要引用函数外的运行时变量或 Vue 实例。 */
export function scanDocument(settings: ScanOptions): PageObservation {
  const warnings: string[] = [];
  let truncated = false;
  const text = (value: string | null | undefined): string => {
    const result = (value ?? "").replace(/\s+/g, " ").trim();
    if (result.length > settings.maxTextLength) { truncated = true; return result.slice(0, settings.maxTextLength); }
    return result;
  };
  const visible = (element: Element): boolean => {
    if (element.closest('[hidden],[aria-hidden="true"],[inert]')) return false;
    const style = getComputedStyle(element);
    return style.visibility !== "hidden" && style.visibility !== "collapse" && element.getClientRects().length > 0;
  };
  const attr = (name: string, value: string) => `[${name}="${CSS.escape(value)}"]`;
  const cssPath = (element: Element): string => {
    const parts: string[] = [];
    let current: Element | null = element;
    while (current && current !== document.documentElement) {
      const parent: Element | null = current.parentElement;
      const index = parent ? Array.from(parent.children).indexOf(current) + 1 : 1;
      parts.unshift(`${current.tagName.toLowerCase()}:nth-child(${index})`);
      current = parent;
    }
    return `html > ${parts.join(" > ")}`;
  };
  const locator = (element: Element) => {
    const testId = element.getAttribute("data-testid");
    if (testId && document.querySelectorAll(attr("data-testid", testId)).length === 1) return { selector: attr("data-testid", testId), basis: "test-id" as const, unique: true };
    if (element.id && !/^(el-|radix-|headlessui-)/.test(element.id) && document.querySelectorAll(attr("id", element.id)).length === 1) return { selector: attr("id", element.id), basis: "id" as const, unique: true };
    const componentClass = ["el-select", "el-cascader", "el-date-editor", "el-slider", "el-input-number"].find((name) => element.classList.contains(name));
    const stableChild = Array.from(element.querySelectorAll('input[id]')).find((child) => !/^(el-|radix-|headlessui-)/.test(child.id) && document.querySelectorAll(attr("id", child.id)).length === 1);
    if (componentClass && stableChild) return { selector: `.${componentClass}:has(${attr("id", stableChild.id)})`, basis: "id" as const, unique: true };
    const selector = cssPath(element);
    return { selector, basis: "structure" as const, unique: document.querySelectorAll(selector).length === 1 };
  };
  const label = (element: Element): string => {
    const labelled = element.getAttribute("aria-labelledby")?.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
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
      const linked = document.querySelector(`label${attr("for", element.id)}`);
      if (linked) return text(linked.textContent);
    }
    const near = element.closest("label") ?? element.closest(".field")?.querySelector(":scope > label");
    return text(near?.textContent || element.getAttribute("placeholder") || element.getAttribute("title") || element.textContent || element.getAttribute("name") || element.tagName);
  };
  const disabled = (element: Element) => element.matches(":disabled") || element.closest('[aria-disabled="true"],[inert]') !== null;
  const scopeRoots = document.querySelectorAll(settings.scopeSelector);
  if (scopeRoots.length > 1) throw new Error(`扫描区域不唯一：${settings.scopeSelector}`);
  const root = scopeRoots[0];
  if (!root) throw new Error(`扫描区域不存在：${settings.scopeSelector}`);
  const query = 'input:not([type="hidden"]),textarea,select,button,[role="checkbox"],[role="radio"],[role="switch"],[role="combobox"],[role="textbox"],[role="spinbutton"],[role="slider"],[role="tab"],[role="button"],[contenteditable="true"]';
  const raw = Array.from(root.querySelectorAll(query));
  if (root.matches(query)) raw.unshift(root);
  const roots = new Set<Element>();
  for (const element of raw) {
    if (element.closest('[data-discovery-ignore="true"]')) continue;
    const component = element.closest(".el-slider") ?? element.closest(".el-select,.el-cascader,.el-date-editor,.el-input-number");
    const semantic = element.parentElement?.closest('[role="combobox"],[role="switch"],[role="checkbox"],[role="radio"],[role="slider"]');
    const candidate = component && root.contains(component) ? component : semantic && root.contains(semantic) ? semantic : element;
    if (visible(candidate)) roots.add(candidate);
  }
  if (roots.size > settings.maxControls) { truncated = true; warnings.push(`控件数量超过上限 ${settings.maxControls}`); }
  const controls: ObservedControl[] = [];
  const groupedRadios = new Set<Element>();
  for (const element of Array.from(roots).slice(0, settings.maxControls)) {
    if (groupedRadios.has(element)) continue;
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
    let multiple: boolean | null = element instanceof HTMLSelectElement ? element.multiple : ["combobox", "cascader"].includes(kind) ? null : false;
    if (roleElement?.hasAttribute("aria-multiselectable")) multiple = roleElement.getAttribute("aria-multiselectable") === "true";
    let fieldLabel = label(element);
    let key = hint.selector;
    if (sensitive) { kind = "password"; notes.push("敏感字段：不采集值，不生成取值候选"); }
    else if (kind === "file") { valueKnown = false; notes.push("文件上传需人工定义样本，本次不读取文件路径"); }
    else if (kind === "radio" || nativeType === "radio") {
      const nativeRadio = input instanceof HTMLInputElement && input.type === 'radio' ? input : null;
      const ariaGroup = element.closest('[role="radiogroup"]');
      const nativeFor = (item: Element) => item instanceof HTMLInputElement ? item : item.querySelector<HTMLInputElement>('input[type="radio"]');
      const radios = Array.from(roots).filter((item) => {
        const other = nativeFor(item);
        if (nativeRadio?.name) return other?.type === 'radio' && other.name === nativeRadio.name && other.form === nativeRadio.form && other.closest('[role="dialog"],dialog') === nativeRadio.closest('[role="dialog"],dialog');
        return ariaGroup ? item.getAttribute('role') === 'radio' && item.closest('[role="radiogroup"]') === ariaGroup : item === element;
      });
      radios.forEach((x) => groupedRadios.add(x));
      const group = ariaGroup ?? element.closest('fieldset') ?? nativeRadio?.form ?? element.closest('[role="dialog"],dialog') ?? root;
      const groupLocator = locator(group);
      hint.selector = nativeRadio?.name ? `${groupLocator.selector} input[type="radio"]${attr("name", nativeRadio.name)}` : ariaGroup ? `${groupLocator.selector} [role="radio"]` : hint.selector;
      hint.basis = "radio-group";
      hint.unique = document.querySelectorAll(hint.selector).length === radios.length;
      key = hint.selector;
      kind = "radio-group";
      fieldLabel = text(group.getAttribute("aria-label") || group.querySelector("legend")?.textContent || nativeRadio?.name || label(element));
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
        const popup = document.getElementById(id);
        if (popup && visible(popup)) popupRoots.add(popup);
      }
      if (settings.dropdownSelector && settings.popupSelector) {
        const opener = document.querySelector(settings.dropdownSelector);
        const popup = document.querySelector(settings.popupSelector);
        if (opener && popup && (opener === element || element.contains(opener) || opener.contains(element))) popupRoots.add(popup);
      }
      const optionElements = new Set<Element>();
      for (const popup of popupRoots) {
        if (popup.hasAttribute("aria-multiselectable")) multiple = popup.getAttribute("aria-multiselectable") === "true";
        const selectDropdown = popup.closest('.el-select-dropdown');
        if (selectDropdown) multiple = selectDropdown.classList.contains('is-multiple');
        for (const option of Array.from(popup.querySelectorAll('[role="option"],[role="menuitem"],[role="menuitemcheckbox"],[role="treeitem"],.el-cascader-node'))) if (visible(option)) optionElements.add(option);
      }
      options = Array.from(optionElements).map((x) => {
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
    if (options.length > settings.maxOptions) { truncated = true; notes.push(`选项超过上限 ${settings.maxOptions}，已截断`); options = options.slice(0, settings.maxOptions); }
    if (typeof currentValue === "string" && currentValue.length > settings.maxTextLength) {
      currentValue = currentValue.slice(0, settings.maxTextLength); valueKnown = false; truncated = true; notes.push("当前值已截断，不作为完整候选值");
    }
    if (hint.basis === "structure") notes.push("使用结构性定位，建议补充稳定 testid 并确认定位");
    if (action) valueKnown = false;
    controls.push({ key, category: action ? "action" : "field", kind, label: fieldLabel, locator: hint, currentValue, valueKnown,
      disabled: kind === 'radio-group' ? options.every((option) => option.disabled) : disabled(element) || !!input && disabled(input), readOnly: input?.hasAttribute("readonly") ?? false,
      required: element.getAttribute("aria-required") === "true" || input?.hasAttribute("required") === true,
      multiple, attributes, options, notes, dialog: element.closest('[role="dialog"],dialog')?.getAttribute("aria-label") ?? null });
  }
  if (document.querySelector("iframe")) warnings.push("存在 iframe，本次仅扫描主文档");
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"],dialog')).filter(visible).map(label);
  return { url: location.href, controls, visibleDialogs: dialogs, warnings, truncated };
}
