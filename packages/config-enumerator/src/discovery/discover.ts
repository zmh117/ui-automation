import type { ElementHandle, Frame, Page } from "playwright";
import { scanDocument } from "./scan.js";
import { enterFrames, findElement, waitElement } from "./dom.js";
import type { DialogAssociation, DiscoveryPlan, DiscoveryReport, DiscoverySnapshot, DiscoveryStep, DomAddress, PopupLink, ScanOptions, SceneResult } from "./types.js";

const defaults = { maxSnapshots: 60, maxControls: 300, maxOptions: 100, maxTextLength: 500, timeoutMs: 5000, maxCells: 300, maxFrames: 20, maxFrameDepth: 4, maxShadowDepth: 8 };
function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} 必须是对象`);
  return value as Record<string, unknown>;
}
function checkKeys(value: Record<string, unknown>, allowed: string[], name: string) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${name}.${key} 是未知属性`);
}
function string(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} 必须是非空字符串`);
}
function address(value: unknown, name: string) {
  const v = object(value, name);
  checkKeys(v, ["selector", "shadowPath"], name); string(v.selector, `${name}.selector`);
  if (v.shadowPath !== undefined) {
    if (!Array.isArray(v.shadowPath) || v.shadowPath.length > 16) throw new Error(`${name}.shadowPath 须为最多 16 项的数组`);
    v.shadowPath.forEach((item, i) => string(item, `${name}.shadowPath[${i}]`));
  }
}
export function parseDiscoveryPlan(input: unknown): DiscoveryPlan {
  const plan = object(input, "plan");
  if (plan.schemaVersion !== 2) throw new Error("发现计划仅支持 schemaVersion=2，请按新版示例重新生成；不兼容旧计划");
  checkKeys(plan, ["schemaVersion", "id", "scenes", "limits"], "plan"); string(plan.id, "plan.id");
  if (!Array.isArray(plan.scenes) || !plan.scenes.length || plan.scenes.length > 500) throw new Error("scenes 须包含 1 到 500 个场景");
  const ids = new Set<string>();
  for (const [index, value] of plan.scenes.entries()) {
    const name = `scenes[${index}]`, scene = object(value, name);
    checkKeys(scene, ["id", "url", "ready", "scope", "framePath", "steps"], name);
    string(scene.id, `${name}.id`); string(scene.url, `${name}.url`);
    if (ids.has(scene.id)) throw new Error(`${name}.id 重复`); ids.add(scene.id);
    const url = new URL(scene.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error(`${name}.url 仅支持无内嵌凭证的 HTTP(S) 地址`);
    address(scene.ready, `${name}.ready`);
    if (scene.scope !== undefined) address(scene.scope, `${name}.scope`);
    if (scene.framePath !== undefined) {
      if (!Array.isArray(scene.framePath) || scene.framePath.length > 10) throw new Error(`${name}.framePath 须为最多 10 层的数组`);
      scene.framePath.forEach((item, i) => address(item, `${name}.framePath[${i}]`));
    }
    if (!Array.isArray(scene.steps) || scene.steps.length > 20) throw new Error(`${name}.steps 须为最多 20 步的数组`);
    for (const [i, item] of scene.steps.entries()) {
      const stepName = `${name}.steps[${i}]`, step = object(item, stepName);
      checkKeys(step, ["kind", "target", "expected"], stepName);
      if (!["open-dropdown", "activate-tab", "open-dialog"].includes(step.kind as string)) throw new Error(`${stepName} 不允许该动作`);
      address(step.target, `${stepName}.target`); address(step.expected, `${stepName}.expected`);
    }
  }
  if (plan.limits !== undefined) {
    const limits = object(plan.limits, "limits"); checkKeys(limits, Object.keys(defaults), "limits");
    const ceilings: Record<string, number> = { maxSnapshots: 1000, maxControls: 5000, maxOptions: 5000, maxTextLength: 10000, timeoutMs: 30000, maxCells: 5000, maxFrames: 100, maxFrameDepth: 10, maxShadowDepth: 16 };
    for (const [key, value] of Object.entries(limits)) if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > ceilings[key]!) throw new Error(`limits.${key} 超出允许范围 1..${ceilings[key]}`);
  }
  return JSON.parse(JSON.stringify(input)) as DiscoveryPlan;
}
export async function fingerprintReport(report: DiscoveryReport): Promise<string> {
  const identity = JSON.stringify({ schemaVersion: report.schemaVersion, artifactType: report.artifactType, plan: report.plan, status: report.status, scope: report.scope, snapshots: report.snapshots, scenes: report.scenes, limitations: report.limitations });
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, "0")).join("");
}
class EntryBlocked extends Error {}

async function permittedTarget(frame: Frame, step: DiscoveryStep, timeout: number): Promise<ElementHandle<Element>> {
  const target = await waitElement(frame, step.target, timeout);
  try {
    const reason = await target.evaluate((element, kind) => {
      const role = element.getAttribute("role"), native = element instanceof HTMLInputElement ? element.type : "";
      const label = `${element.getAttribute("aria-label") ?? ""} ${element.textContent ?? ""}`;
      for (let node: Element | null = element; node; node = node.parentElement ?? (node.getRootNode() instanceof ShadowRoot ? (node.getRootNode() as ShadowRoot).host : null))
        if (node.matches(':disabled,[aria-disabled="true"],[inert]')) return "入口禁用，未尝试切换业务选项";
      if (element.querySelector('input:disabled')) return "入口禁用，未尝试切换业务选项";
      if (["checkbox", "radio", "switch", "option"].includes(role ?? "") || ["checkbox", "radio", "file", "submit", "reset"].includes(native)) return "禁止操作业务选项、文件或提交控件";
      if (element instanceof HTMLButtonElement && element.form && element.type === "submit") return "禁止触发表单提交按钮";
      if (/保存|提交|删除|发布|重置|确认|确定|取消|\b(save|submit|delete|publish|reset|confirm|cancel|apply|ok)\b/i.test(label)) return "入口名称包含提交或修改动作，未点击";
      if (kind === "activate-tab") return role === "tab" ? null : "标签页入口必须具有 tab 角色";
      if (kind === "open-dropdown") return role === "combobox" || element.matches(".el-select,.el-cascader,.el-date-editor") || element.querySelector('[role="combobox"]') || ["listbox", "tree", "menu", "dialog"].includes(element.getAttribute("aria-haspopup") ?? "") ? null : "未识别为下拉或日期选择入口";
      return element instanceof HTMLButtonElement || role === "button" ? null : "弹框入口必须为按钮";
    }, step.kind);
    if (reason) throw new EntryBlocked(reason);
    return target;
  } catch (error) { await target.dispose(); throw error; }
}
async function clickTarget(target: ElementHandle<Element>, step: DiscoveryStep, timeout: number) {
  let click = target;
  if (step.kind === "open-dropdown") {
    const selector = await target.evaluate(el => el.matches('.el-select') ? '.el-select__wrapper' : el.matches('.el-cascader,.el-date-editor') ? '[role="combobox"],input:not([type="hidden"])' : null);
    if (selector) click = await target.$(selector) ?? target;
  }
  try { await click.click({ timeout }); }
  finally { if (click !== target) await click.dispose(); }
}

export async function discoverPage(page: Page, input: unknown, options: { signal?: AbortSignal } = {}): Promise<DiscoveryReport> {
  const plan = parseDiscoveryPlan(input), limits = { ...defaults, ...plan.limits };
  const report: DiscoveryReport = {
    schemaVersion: 2, artifactType: "page-discovery", reportId: "", plan,
    startedAt: new Date().toISOString(), finishedAt: "", status: "completed", scope: "specified-scenes-and-openers",
    snapshots: [], scenes: [], limitations: [
      "完成仅指指定计划；不代表应用全量发现、选项业务全集或测试通过。",
      "扫描可见 Frame 和开放 Shadow DOM；闭合 Shadow root、Canvas 内部内容需要组件适配，不能据此声明已发现。",
      "选项完整性仅针对当前 DOM/ARIA 声明集合；远程、分页、虚拟或搜索结果不自动遍历，也不跨快照拼成全集。",
      "不切换业务单选、复选框或开关；未打开的隐藏状态和禁用入口保持未探索。",
      "单元格显示文本与显式 DOM 业务值均为观察事实，正确性须使用独立预期断言。",
    ],
  };
  const limitReached = () => report.snapshots.length >= limits.maxSnapshots;
  for (const scene of plan.scenes) {
    const result: SceneResult = { id: scene.id, status: "completed", completedSteps: 0 };
    report.scenes.push(result);
    if (options.signal?.aborted) { result.status = "cancelled"; result.reason = "发现已取消"; continue; }
    if (limitReached()) { result.status = "limited"; result.reason = "快照预算耗尽，场景未开始"; continue; }
    const framePath = (scene.framePath ?? []).map(a => ({ selector: a.selector, shadowPath: a.shadowPath ?? [] })), scopes = [scene.scope ?? { selector: "body" }];
    const associations: DialogAssociation[] = [];
    let frame: Frame;
    const capture = async (afterStep: number, popup?: PopupLink) => {
      const snapshot: DiscoverySnapshot = { id: `${scene.id}:${afterStep}`, sceneId: scene.id, afterStep, url: page.url(), controls: [], cells: [], dialogs: [], documents: [], associations: JSON.parse(JSON.stringify(associations)), warnings: [], truncated: false };
      let visited = 0;
      const visit = async (current: Frame, path: DomAddress[], scanScopes: DomAddress[], currentPopup?: PopupLink) => {
        const context = { url: current.url(), framePath: path };
        if (visited >= limits.maxFrames || path.length > limits.maxFrameDepth) {
          snapshot.documents.push({ context, status: "limited", reason: "Frame 数量或深度预算不足" }); snapshot.truncated = true; return;
        }
        visited++;
        try {
          if (options.signal?.aborted) throw new Error("发现已取消");
          await current.waitForLoadState("domcontentloaded", { timeout: limits.timeoutMs });
          const settings: ScanOptions = {
            maxControls: Math.max(0, limits.maxControls - snapshot.controls.length), maxCells: Math.max(0, limits.maxCells - snapshot.cells.length),
            maxOptions: limits.maxOptions, maxTextLength: limits.maxTextLength, maxShadowDepth: limits.maxShadowDepth,
            scopes: scanScopes, framePath: path, ...(currentPopup ? { popup: currentPopup } : {}),
          };
          const observed = await current.evaluate(scanDocument, settings);
          snapshot.controls.push(...observed.controls); snapshot.cells.push(...observed.cells); snapshot.dialogs.push(...observed.dialogs);
          snapshot.warnings.push(...observed.warnings.map(w => `${JSON.stringify(path)}：${w}`));
          snapshot.truncated ||= observed.truncated;
          snapshot.documents.push({ context: { ...context, url: observed.url }, status: "scanned" });
          for (const address of observed.frames) {
            const childPath = [...path, { selector: address.selector, shadowPath: address.shadowPath }];
            let host: ElementHandle<Element> | null = null;
            try {
              host = await findElement(current, address);
              const child = await host?.contentFrame();
              if (!child) throw new Error("iframe 已脱离或无法取得 Frame");
              await visit(child, childPath, [{ selector: "body" }]);
            } catch (error) { snapshot.documents.push({ context: { url: "", framePath: childPath }, status: "unavailable", reason: String(error).slice(0, 600) }); }
            finally { await host?.dispose(); }
          }
        } catch (error) { snapshot.documents.push({ context, status: "unavailable", reason: String(error).slice(0, 600) }); }
      };
      await visit(frame, framePath, scopes, popup);
      report.snapshots.push(snapshot);
    };
    try {
      if (framePath.length > limits.maxFrameDepth) throw new EntryBlocked("指定 Frame 路径超过深度预算");
      const addresses = [...framePath, scene.ready, ...scopes, ...scene.steps.flatMap(step => [step.target, step.expected])];
      if (addresses.some(a => (a.shadowPath?.length ?? 0) > limits.maxShadowDepth)) throw new EntryBlocked("指定 Shadow 路径超过深度预算");
      await page.goto("about:blank", { timeout: limits.timeoutMs });
      await page.goto(scene.url, { waitUntil: "domcontentloaded", timeout: limits.timeoutMs });
      if (new URL(page.url()).origin !== new URL(scene.url).origin) throw new EntryBlocked("页面导航到了计划外来源，未扫描");
      frame = await enterFrames(page.mainFrame(), framePath, limits.timeoutMs);
      await (await waitElement(frame, scene.ready, limits.timeoutMs)).dispose();
      if (options.signal?.aborted) { result.status = "cancelled"; result.reason = "发现已取消"; continue; }
      await capture(0);
      for (const [index, step] of scene.steps.entries()) {
        if (options.signal?.aborted) { result.status = "cancelled"; result.reason = "发现已取消"; break; }
        if (limitReached()) { result.status = "limited"; result.reason = "快照预算耗尽，后续步骤未执行"; break; }
        const target = await permittedTarget(frame, step, limits.timeoutMs);
        let expected: ElementHandle<Element> | null = null;
        try {
          const beforeUrl = page.url(), beforeFrameUrl = frame.url();
          if (step.kind === "open-dialog") {
            const before = await findElement(frame, step.expected);
            try { if (before && await before.isVisible()) throw new EntryBlocked("指定弹框在操作前已可见，不能归因为本次打开"); }
            finally { await before?.dispose(); }
          }
          let parentDialog: DomAddress | null = null;
          for (const association of [...associations].reverse()) {
            const parent = await findElement(frame, association.dialog);
            try {
              if (parent && await target.evaluate((el, ancestor) => {
                for (let node: Element | null = el; node; node = node.parentElement ?? (node.getRootNode() instanceof ShadowRoot ? (node.getRootNode() as ShadowRoot).host : null)) if (node === ancestor) return true;
                return false;
              }, parent)) { parentDialog = association.dialog; break; }
            } finally { await parent?.dispose(); }
          }
          await clickTarget(target, step, limits.timeoutMs);
          if (page.url() !== beforeUrl || frame.url() !== beforeFrameUrl) throw new EntryBlocked("展开动作引起页面或 Frame 导航，已停止该场景");
          expected = await waitElement(frame, step.expected, limits.timeoutMs);
          if (step.kind === "open-dialog") {
            if (!await expected.evaluate(el => el.matches('[role="dialog"],dialog'))) throw new EntryBlocked("expected 必须精确指向弹框根，不能指向任意子控件");
            const label = await expected.evaluate(el => el.getAttribute("aria-label") || (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).map(id => (el.getRootNode() as Document | ShadowRoot).querySelector(`[id="${CSS.escape(id)}"]`)?.textContent ?? "").join(" ").trim() || "未命名弹框");
            associations.push({ step: index + 1, label: label.slice(0, limits.maxTextLength), context: { url: frame.url(), framePath }, opener: step.target, dialog: step.expected, parentDialog, transition: "hidden-to-visible" });
            scopes.push(step.expected);
          }
          result.completedSteps = index + 1;
          await capture(index + 1, step.kind === "open-dropdown" ? { opener: step.target, popup: step.expected } : undefined);
        } finally { await target.dispose(); await expected?.dispose(); }
      }
    } catch (error) {
      result.status = error instanceof EntryBlocked ? "blocked" : "failed";
      result.reason = error instanceof Error ? error.message.slice(0, 1200) : String(error);
    }
    if (options.signal?.aborted) { result.status = "cancelled"; result.reason = "发现已取消"; }
  }
  report.status = report.scenes.some(s => s.status === "cancelled") ? "cancelled" : report.scenes.some(s => s.status !== "completed") || report.snapshots.some(s => s.truncated || s.documents.some(d => d.status !== "scanned")) ? "partial" : "completed";
  report.finishedAt = new Date().toISOString(); report.reportId = await fingerprintReport(report);
  return report;
}
