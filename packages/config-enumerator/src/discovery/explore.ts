import type { ElementHandle, Page } from 'playwright';
import { enterFrames, findElement, waitElement } from './dom.js';
import { captureSnapshot, discoveryDefaults } from './observe.js';
import { checkDomVisibility } from './scan.js';
import type { DiscoveryPlan, DiscoveryReport, DiscoveryScene, DiscoverySnapshot, DomAddress, ExplorationHop, ExplorationResult, ObservedControl } from './types.js';

const addressKey = (a: DomAddress) => JSON.stringify([a.selector, a.shadowPath ?? []]);
const frameKey = (path: DomAddress[]) => JSON.stringify(path.map(addressKey));
const hopKey = (h: ExplorationHop) => JSON.stringify([h.pageUrl, h.source.url, frameKey(h.source.framePath), addressKey(h.target)]);
const controlKey = (c: ObservedControl) => JSON.stringify([frameKey(c.context.framePath), addressKey(c.locator)]);
const dialogKey = (d: DiscoverySnapshot['dialogs'][number]) => JSON.stringify([frameKey(d.context.framePath), addressKey(d.locator)]);
const body = [{ selector: 'body' }];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
class ExplorationStop extends Error {
  constructor(message: string, public status: ExplorationResult['status'] = 'blocked') { super(message); }
}
function exclusion(plan: DiscoveryPlan, labels: string[], url: string): string | null {
  const name = ['主配方', ...(plan.exploration?.excludeNames ?? [])].find(n => labels.some(l => l.includes(n)));
  if (name) return `命中排除名称：${name}`;
  const part = plan.exploration?.excludeUrlIncludes?.find(p => url.includes(p));
  return part ? '命中排除 URL 规则' : null;
}
/** 只读取标题和可见标题元素，进入前即可排除主配方，不采集其表单。 */
export async function pageExclusion(page: Page, plan: DiscoveryPlan): Promise<string | null> {
  const labels = [await page.title()];
  const headings = await page.locator('h1,h2,[role="heading"]').elementHandles();
  try {
    for (const el of headings) if (await page.evaluate(checkDomVisibility, { visibility: el as ElementHandle<Element> })) labels.push(await el.textContent() ?? '');
  } finally { await Promise.all(headings.map(el => el.dispose())); }
  return exclusion(plan, labels, page.url());
}

/** BFS 只排队路径，不保留跨导航的 DOM 节点。每条路径从场景起点重放。 */
export async function exploreEntries(rootPage: Page, scene: DiscoveryScene, plan: DiscoveryPlan, report: DiscoveryReport, initial: DiscoverySnapshot, reset: () => Promise<DiscoverySnapshot>, signal?: AbortSignal): Promise<void> {
  const config = { maxDepth: 4, maxActions: 100, settleMs: 300, ...plan.exploration };
  const limits = { ...discoveryDefaults, ...plan.limits };
  const exploration = report.exploration!;
  const queue: ExplorationHop[][] = [];
  const owned = new Set<Page>();
  let active = rootPage;
  const cancelled = () => { if (signal?.aborted) throw new ExplorationStop('发现已取消', 'cancelled'); };
  const record = (path: ExplorationHop[], status: ExplorationResult['status'], reason?: string, snapshotId?: string) => {
    exploration.results.push({ sceneId: scene.id, path: clone(path), depth: path.length, status, ...(reason ? { reason } : {}), ...(snapshotId ? { snapshotId } : {}) });
  };
  const hopFor = (c: ObservedControl, snapshot: DiscoverySnapshot): ExplorationHop => ({ label: c.label, kind: c.entry!.kind, source: c.context, pageUrl: snapshot.url, target: c.locator, ...(c.entry?.expected ? { expected: c.entry.expected } : {}) });
  const enqueue = (snapshot: DiscoverySnapshot, path: ExplorationHop[]) => {
    const seen = new Set<string>();
    for (const c of snapshot.controls.filter(c => !!c.entry)) {
      const hop = hopFor(c, snapshot), next = [...path, hop];
      const key = hopKey(hop);
      if (seen.has(key) && c.locator.unique) continue;
      seen.add(key);
      const excluded = exclusion(plan, [c.label], c.attributes.href ? new URL(c.attributes.href, c.context.url).href : c.context.url);
      if (excluded) { record(next, 'skipped', excluded); continue; }
      if (!c.entry!.allowed) { record(next, c.locator.unique ? 'skipped' : 'blocked', c.entry!.reason); continue; }
      if (path.some(p => hopKey(p) === key)) { record(next, 'skipped', '当前路径已操作过相同入口，避免循环'); continue; }
      if (path.length >= config.maxDepth) { record(next, 'limited', `达到操作深度上限 ${config.maxDepth}`); continue; }
      if (queue.length + report.snapshots.length >= limits.maxSnapshots || queue.length >= config.maxActions - exploration.actions) { record(next, 'limited', '候选队列达到快照或动作预算'); continue; }
      queue.push(next);
    }
  };
  const closeOwned = async () => {
    for (const page of owned) { if (!page.isClosed()) await page.close({ runBeforeUnload: false }); }
    owned.clear(); active = rootPage;
  };
  const scan = async (page: Page, path: DomAddress[], scopes: DomAddress[] = body, previous?: DiscoverySnapshot) => {
    if (path.length > limits.maxFrameDepth) throw new ExplorationStop('Frame 深度超过预算', 'limited');
    const frame = await enterFrames(page.mainFrame(), path, limits.timeoutMs);
    return captureSnapshot(page, frame, scene, scene.steps.length, path, scopes, previous?.associations ?? [], limits, signal, undefined, config.confirmationEntries ?? [], plan.exploration);
  };
  const takeAction = async (hop: ExplorationHop, previous: DiscoverySnapshot): Promise<{ snapshot: DiscoverySnapshot; hop: ExplorationHop }> => {
    cancelled();
    if (exploration.actions >= config.maxActions) throw new ExplorationStop('动作预算耗尽（含路径重放）', 'limited');
    if (active.url() !== hop.pageUrl) throw new ExplorationStop('路径重放页面 URL 不一致（包含 query/hash），未点击');
    const frame = await enterFrames(active.mainFrame(), hop.source.framePath, limits.timeoutMs);
    if (frame.url() !== hop.source.url) throw new ExplorationStop('路径重放 Frame URL 不一致，未点击');
    const before = await scan(active, hop.source.framePath);
    if (before.documents.some(d => d.status === "excluded")) throw new ExplorationStop("入口所属文档命中排除规则");
    const fresh = before.controls.find(c => controlKey(c) === JSON.stringify([frameKey(hop.source.framePath), addressKey(hop.target)]));
    if (!fresh?.entry?.allowed || fresh.entry.kind !== hop.kind) throw new ExplorationStop(`入口重新扫描不再允许执行：${fresh?.entry?.reason ?? '入口缺失或发生变化'}`);
    if (exclusion(plan, [fresh.label], fresh.attributes.href ? new URL(fresh.attributes.href, frame.url()).href : frame.url())) throw new ExplorationStop('入口重新扫描命中排除规则');
    if (fresh.attributes.href) {
      const url = new URL(fresh.attributes.href, frame.url());
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== new URL(scene.url).origin) throw new ExplorationStop('入口链接不是允许的同来源 HTTP(S) 页面');
    }
    let target: ElementHandle<Element> | null = await waitElement(frame, hop.target, limits.timeoutMs);
    if (hop.expected) {
      const visible = await findElement(frame, hop.expected);
      try { if (visible) throw new ExplorationStop('确认弹框在点击前已经可见，不能关联到本次删除入口'); }
      finally { await visible?.dispose(); }
    }
    const popups: Page[] = [];
    const onPopup = (page: Page) => { popups.push(page); owned.add(page); };
    const sourcePage = active;
    sourcePage.on('popup', onPopup);
    const beforeDialogs = new Set(before.dialogs.map(dialogKey));
    const beforeFields = new Set(before.controls.map(controlKey));
    const beforeRegions = new Map((before.regions ?? []).map(r => [addressKey(r.locator), r.displayText]));
    let lastFingerprint = '', stableSince = 0;
    const deadline = Date.now() + limits.timeoutMs;
    try {
      exploration.actions++;
      // click 的 actionability 仍由 Playwright 检查，禁止 force 和 DOM click。
      let click = target;
      if (hop.kind === 'open-dropdown') {
        const selector = await target.evaluate(el => el.matches('.el-select') ? '.el-select__wrapper' : el.matches('.el-cascader,.el-date-editor') ? '[role="combobox"],input:not([type="hidden"])' : null);
        if (selector) {
          const candidates = await target.$$(selector);
          const visible = [];
          for (const el of candidates) { if (await el.isVisible()) visible.push(el); else await el.dispose(); }
          if (visible.length !== 1) { await Promise.all(visible.map(el => el.dispose())); throw new ExplorationStop('下拉点击区域不唯一，未点击'); }
          click = visible[0]!;
        }
      }
      try { await click.click({ timeout: Math.max(1, deadline - Date.now()) }); }
      finally { if (click !== target) await click.dispose(); }
      await target.dispose(); target = null;
      while (Date.now() < deadline) {
        cancelled();
        if (popups.length > 1) throw new ExplorationStop('一次操作出现多个新窗口，无法唯一关联');
        active = popups[0] ?? sourcePage;
        if (active.isClosed()) throw new ExplorationStop('目标窗口已经关闭');
        if (active.url() === 'about:blank') { await new Promise(r => setTimeout(r, 50)); continue; }
        if (new URL(active.url()).origin !== new URL(scene.url).origin) throw new ExplorationStop('目标页面跳转到计划外来源');
        const excluded = await pageExclusion(active, plan);
        if (excluded) throw new ExplorationStop(excluded);
        const navigation = active !== sourcePage || active.url() !== hop.pageUrl;
        const path = navigation ? [] : hop.source.framePath;
        const current = await scan(active, path);
        const excludedFrame = exclusion(plan, current.pageLabels ?? [], current.url);
        if (excludedFrame) throw new ExplorationStop(excludedFrame);
        if (current.documents.some(d => d.status === 'excluded' && frameKey(d.context.framePath) === frameKey(path))) throw new ExplorationStop('目标文档命中排除规则');
        if (current.documents.some(d => !['scanned', 'excluded'].includes(d.status))) { await new Promise(r => setTimeout(r, 80)); continue; }
        const currentFrame = await enterFrames(active.mainFrame(), path, limits.timeoutMs);
        if (new URL(currentFrame.url()).origin !== new URL(navigation ? scene.url : hop.source.url).origin) throw new ExplorationStop('Frame 跳转到计划外来源');
        const newDialogs = current.dialogs.filter(d => !beforeDialogs.has(dialogKey(d)) && frameKey(d.context.framePath) === frameKey(path));
        if (newDialogs.length > 1) throw new ExplorationStop('同时出现多个弹框，无法唯一关联');
        let kind: NonNullable<ExplorationHop['destination']>['kind'] | null = navigation ? active === sourcePage ? 'navigation' : 'popup' : currentFrame.url() !== hop.source.url ? 'navigation' : null;
        let scopes = body;
        const priorScope = previous.path?.at(-1)?.destination?.scope ?? (frameKey(path) === frameKey(scene.framePath ?? []) ? [...(scene.scope ? [scene.scope] : body), ...previous.associations.filter(a => frameKey(a.context.framePath) === frameKey(path)).map(a => a.dialog)] : body);
        if (newDialogs.length === 1) {
          if (!newDialogs[0]!.locator.unique) throw new ExplorationStop('新弹框缺少唯一定位');
          kind ??= 'dialog'; scopes = [newDialogs[0]!.locator];
        }
        const updated = current.controls.find(c => controlKey(c) === controlKey(fresh));
        if (!kind && hop.kind === 'activate-tab' && updated?.attributes['aria-selected'] === 'true') { kind = 'tab'; scopes = priorScope; }
        if (!kind && hop.kind === 'open-dropdown' && updated && (updated.attributes['aria-expanded'] === 'true' || updated.options.length > fresh.options.length)) { kind = 'dropdown'; scopes = priorScope; }
        if (!kind && current.controls.some(c => c.category === 'field' && !beforeFields.has(controlKey(c)))) kind = 'inline';
        const changedRegions = (current.regions ?? []).filter(r => r.locator.unique && frameKey(r.context.framePath) === frameKey(path) && beforeRegions.get(addressKey(r.locator)) !== r.displayText);
        const newRegions = changedRegions.filter(r => !beforeRegions.has(addressKey(r.locator)));
        const regions = newRegions.length ? newRegions : changedRegions;
        if ((!kind || kind === 'inline') && regions.length === 1) { kind = hop.kind === 'open-dropdown' ? 'dropdown' : 'inline'; scopes = [regions[0]!.locator]; }
        if (kind === 'dropdown') scopes = [...scopes, ...changedRegions.filter(r => ['menu', 'listbox'].includes(r.kind)).map(r => r.locator)];
        if (!kind) { await new Promise(r => setTimeout(r, 80)); continue; }
        if (hop.kind === 'open-confirmation') {
          if (kind !== 'dialog' || !hop.expected) throw new ExplorationStop('删除入口未打开预期确认弹框，停止探索');
          const expected = await findElement(currentFrame, hop.expected);
          const observed = await findElement(currentFrame, scopes[0]!);
          try {
            if (!expected || !observed || !await expected.evaluate((el, actual) => el === actual && el.matches('dialog,[role="dialog"],[role="alertdialog"]'), observed)) throw new ExplorationStop('删除入口打开的不是配置的确认弹框');
          } finally { await expected?.dispose(); await observed?.dispose(); }
        }
        const fingerprint = JSON.stringify([kind, active.url(), currentFrame.url(), current.controls.map(c => [controlKey(c), c.kind, c.currentValue, c.options, c.attributes, c.disabled]), current.dialogs, current.regions]);
        if (fingerprint !== lastFingerprint) { lastFingerprint = fingerprint; stableSince = Date.now(); }
        if (Date.now() - stableSince < config.settleMs) { await new Promise(r => setTimeout(r, 80)); continue; }
        const destination = { kind, url: active.url(), frameUrl: currentFrame.url(), scope: scopes };
        if (hop.destination && JSON.stringify(hop.destination) !== JSON.stringify(destination)) throw new ExplorationStop('重放后的目标界面与原记录不一致');
        const snapshot = await scan(active, path, scopes, navigation ? undefined : previous);
        if (newDialogs.length === 1) snapshot.associations.push({ step: (previous.path?.length ?? 0) + 1, label: newDialogs[0]!.label, context: newDialogs[0]!.context, opener: hop.target, dialog: scopes[0]!, parentDialog: fresh.dialog, transition: 'hidden-to-visible' });
        return { snapshot, hop: { ...hop, destination } };
      }
      throw new ExplorationStop('超时内未确认新表单、弹框、页面、标签或下拉的稳定展示变化');
    } finally { sourcePage.off('popup', onPopup); await target?.dispose(); }
  };

  enqueue(initial, []);
  try {
    while (queue.length) {
      const path = queue.shift()!;
      try {
        cancelled();
        if (report.snapshots.length >= limits.maxSnapshots) throw new ExplorationStop('快照预算耗尽', 'limited');
        if (exploration.actions + scene.steps.length + path.length > config.maxActions) throw new ExplorationStop('动作预算不足以重放此路径', 'limited');
        await closeOwned();
        exploration.actions += scene.steps.length;
        let snapshot = await reset();
        const completed: ExplorationHop[] = [];
        for (const hop of path) {
          const result = await takeAction(hop, snapshot);
          completed.push(result.hop); snapshot = result.snapshot; snapshot.path = clone(completed);
        }
        snapshot.id = `${scene.id}:auto:${report.snapshots.length}`;
        snapshot.afterStep = scene.steps.length + completed.length;
        report.snapshots.push(snapshot);
        record(completed, 'explored', undefined, snapshot.id);
        if (completed.at(-1)?.kind !== 'open-confirmation') enqueue(snapshot, completed);
      } catch (error) {
        record(path, signal?.aborted ? 'cancelled' : error instanceof ExplorationStop ? error.status : 'failed', error instanceof Error ? error.message.slice(0, 1200) : String(error));
      } finally { await closeOwned(); }
    }
  } finally { await closeOwned(); }
}
