import type { Locator, Page } from "playwright";
import { scanDocument } from "./scan.js";
import type { DiscoveryPlan, DiscoveryReport, DiscoveryStep, ScanOptions, SceneResult } from "./types.js";

const defaults = { maxSnapshots: 60, maxControls: 300, maxOptions: 100, maxTextLength: 500, timeoutMs: 5000 };

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
export function parseDiscoveryPlan(input: unknown): DiscoveryPlan {
  const plan = object(input, "plan");
  checkKeys(plan, ["id", "scenes", "limits"], "plan");
  string(plan.id, "plan.id");
  if (!Array.isArray(plan.scenes) || !plan.scenes.length || plan.scenes.length > 500) throw new Error("scenes 须包含 1 到 500 个场景");
  const ids = new Set<string>();
  for (const [index, value] of plan.scenes.entries()) {
    const name = `scenes[${index}]`;
    const scene = object(value, name);
    checkKeys(scene, ["id", "url", "readySelector", "scopeSelector", "steps"], name);
    for (const key of ["id", "url", "readySelector"]) string(scene[key], `${name}.${key}`);
    if (ids.has(scene.id as string)) throw new Error(`${name}.id 重复`);
    ids.add(scene.id as string);
    const url = new URL(scene.url as string);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error(`${name}.url 仅支持无内嵌凭证的 HTTP(S) 地址`);
    if (scene.scopeSelector !== undefined) string(scene.scopeSelector, `${name}.scopeSelector`);
    if (!Array.isArray(scene.steps) || scene.steps.length > 20) throw new Error(`${name}.steps 须为最多 20 步的数组`);
    for (const [i, item] of scene.steps.entries()) {
      const step = object(item, `${name}.steps[${i}]`);
      checkKeys(step, ["kind", "selector", "expectSelector"], `${name}.steps[${i}]`);
      if (!["open-dropdown", "activate-tab", "open-dialog"].includes(step.kind as string)) throw new Error(`${name}.steps[${i}] 不允许该动作`);
      string(step.selector, `${name}.steps[${i}].selector`);
      string(step.expectSelector, `${name}.steps[${i}].expectSelector`);
    }
  }
  if (plan.limits !== undefined) {
    const limits = object(plan.limits, "limits");
    checkKeys(limits, Object.keys(defaults), "limits");
    const ceilings: Record<string, number> = { maxSnapshots: 1000, maxControls: 5000, maxOptions: 5000, maxTextLength: 10000, timeoutMs: 30000 };
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

async function permittedTarget(page: Page, step: DiscoveryStep, timeout: number): Promise<Locator> {
  let target = page.locator(step.selector).filter({ visible: true });
  await target.waitFor({ state: "visible", timeout });
  if (await target.count() !== 1) throw new EntryBlocked("入口定位不唯一");
  const reason = await target.evaluate((element, kind) => {
    const role = element.getAttribute("role");
    const native = element instanceof HTMLInputElement ? element.type : "";
    const label = `${element.getAttribute("aria-label") ?? ""} ${element.textContent ?? ""}`;
    if (element.matches(":disabled") || element.closest('[aria-disabled="true"],[inert]') || element.querySelector('input:disabled')) return "入口禁用，未尝试切换业务选项";
    if (["checkbox", "radio", "switch", "option"].includes(role ?? "") || ["checkbox", "radio", "file", "submit", "reset"].includes(native)) return "禁止操作业务选项、文件或提交控件";
    if (element instanceof HTMLButtonElement && element.form && element.type === "submit") return "禁止触发表单提交按钮";
    if (/保存|提交|删除|发布|重置|确认|确定|取消|\b(save|submit|delete|publish|reset|confirm|cancel|apply|ok)\b/i.test(label)) return "入口名称包含提交或修改动作，未点击";
    if (kind === "activate-tab") return role === "tab" ? null : "标签页入口必须具有 tab 角色";
    if (kind === "open-dropdown") {
      return role === "combobox" || element.matches(".el-select,.el-cascader,.el-date-editor") || element.querySelector('[role="combobox"]') || ["listbox", "tree", "menu", "dialog"].includes(element.getAttribute("aria-haspopup") ?? "") ? null : "未识别为下拉或日期选择入口";
    }
    return element instanceof HTMLButtonElement || role === "button" ? null : "弹框入口必须为按钮";
  }, step.kind);
  if (reason) throw new EntryBlocked(reason);
  if (step.kind === "open-dropdown") {
    const selectWrapper = target.locator('.el-select__wrapper').filter({ visible: true });
    if (await target.evaluate((el) => el.matches('.el-select')) && await selectWrapper.count() === 1) return selectWrapper;
    const inner = target.locator('[role="combobox"], input:not([type="hidden"])').filter({ visible: true });
    if (await target.evaluate((el) => el.matches(".el-select,.el-cascader,.el-date-editor")) && await inner.count()) {
      const role = target.locator('[role="combobox"]').filter({ visible: true });
      target = await role.count() === 1 ? role : inner.first();
    }
  }
  return target;
}

async function elementSelector(locator: Locator): Promise<string> {
  return locator.evaluate((element) => {
    if (element.id && document.querySelectorAll(`[id="${CSS.escape(element.id)}"]`).length === 1) return `[id="${CSS.escape(element.id)}"]`;
    const parts: string[] = [];
    let current: Element | null = element;
    while (current && current !== document.documentElement) {
      const parent: Element | null = current.parentElement;
      parts.unshift(`${current.tagName.toLowerCase()}:nth-child(${parent ? Array.from(parent.children).indexOf(current) + 1 : 1})`);
      current = parent;
    }
    return `html > ${parts.join(" > ")}`;
  });
}

/** 调用方提供隔离的 Page；本函数只按计划导航和展开，不点击保存或改变业务选项。 */
export async function discoverPage(page: Page, input: unknown, options: { signal?: AbortSignal } = {}): Promise<DiscoveryReport> {
  const plan = parseDiscoveryPlan(input);
  const limits = { ...defaults, ...plan.limits };
  const report: DiscoveryReport = {
    schemaVersion: 1, artifactType: "page-discovery", reportId: "", plan,
    startedAt: new Date().toISOString(), finishedAt: "", status: "completed", scope: "specified-scenes-and-openers",
    snapshots: [], scenes: [], limitations: [
      "完成仅指指定计划，不代表整个应用或所有页面状态已发现。",
      "本轮仅扫描主文档普通 DOM；iframe、Shadow DOM、Canvas 需要另行适配。",
      "远程、分页和虚拟列表只记录当前渲染选项，不保证选项全集。",
      "不切换业务单选、复选框或开关；由此隐藏的字段和禁用入口保持未探索。",
      "DOM 属性、显示文本和禁用状态是观测事实，业务规则与有限值域必须确认。",
    ],
  };
  const limitReached = () => report.snapshots.length >= limits.maxSnapshots;
  for (const scene of plan.scenes) {
    const result: SceneResult = { id: scene.id, status: "completed", completedSteps: 0 };
    report.scenes.push(result);
    if (options.signal?.aborted) { result.status = "cancelled"; result.reason = "发现已取消"; continue; }
    if (limitReached()) { result.status = "limited"; result.reason = "快照预算耗尽，场景未开始"; continue; }
    const capture = async (afterStep: number, popup?: { dropdownSelector: string; popupSelector: string }) => {
      const settings: ScanOptions = { maxControls: limits.maxControls, maxOptions: limits.maxOptions, maxTextLength: limits.maxTextLength, scopeSelector: scene.scopeSelector ?? "body", ...popup };
      const observation = await page.evaluate(scanDocument, settings);
      report.snapshots.push({ ...observation, id: `${scene.id}:${afterStep}`, sceneId: scene.id, afterStep });
    };
    try {
      // 同 URL / hash 导航不会重建 Vue 状态。先离开文档，保留上下文中的登录与存储。
      await page.goto("about:blank", { timeout: limits.timeoutMs });
      await page.goto(scene.url, { waitUntil: "domcontentloaded", timeout: limits.timeoutMs });
      if (new URL(page.url()).origin !== new URL(scene.url).origin) throw new EntryBlocked("页面导航到了计划外来源，未扫描");
      await page.locator(scene.readySelector).filter({ visible: true }).waitFor({ state: "visible", timeout: limits.timeoutMs });
      if (options.signal?.aborted) { result.status = "cancelled"; result.reason = "发现已取消"; continue; }
      await capture(0);
      for (const [index, step] of scene.steps.entries()) {
        if (options.signal?.aborted) { result.status = "cancelled"; result.reason = "发现已取消"; break; }
        if (limitReached()) { result.status = "limited"; result.reason = "快照预算耗尽，后续步骤未执行"; break; }
        const target = await permittedTarget(page, step, limits.timeoutMs);
        const beforeUrl = page.url();
        await target.click({ timeout: limits.timeoutMs });
        if (page.url() !== beforeUrl) throw new EntryBlocked("展开动作引起页面导航，已停止该场景");
        const expected = page.locator(step.expectSelector).filter({ visible: true });
        await expected.waitFor({ state: "visible", timeout: limits.timeoutMs });
        if (step.kind === "open-dialog" && !await expected.evaluate((el) => !!el.closest('[role="dialog"],dialog') || !!el.querySelector('[role="dialog"],dialog'))) throw new EntryBlocked("展开结果未识别为弹框");
        result.completedSteps = index + 1;
        const popup = step.kind === "open-dropdown" ? { dropdownSelector: await elementSelector(target), popupSelector: await elementSelector(expected) } : undefined;
        await capture(index + 1, popup);
      }
    } catch (error) {
      result.status = error instanceof EntryBlocked ? "blocked" : "failed";
      result.reason = error instanceof Error ? error.message.slice(0, 1200) : String(error);
    }
  }
  report.status = report.scenes.some((s) => s.status === "cancelled") ? "cancelled" : report.scenes.some((s) => s.status !== "completed") || report.snapshots.some((s) => s.truncated) ? "partial" : "completed";
  report.finishedAt = new Date().toISOString();
  report.reportId = await fingerprintReport(report);
  return report;
}
