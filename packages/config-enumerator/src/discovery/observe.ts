import type { ElementHandle, Frame, Page } from "playwright";
import { scanDocument } from "./scan.js";
import { findElement } from "./dom.js";
import { readHandsontable } from './handsontable.js';
import type { DialogAssociation, DiscoveryScene, DiscoverySnapshot, DomAddress, PopupLink, ScanOptions, ConfirmationEntry, ExplorationOptions } from "./types.js";
export const discoveryDefaults = { maxSnapshots: 60, maxControls: 300, maxOptions: 100, maxTextLength: 500, timeoutMs: 5000, maxCells: 300, maxFrames: 20, maxFrameDepth: 4, maxShadowDepth: 8 };
export type DiscoveryLimits = typeof discoveryDefaults;
export async function captureSnapshot(page: Page, frame: Frame, scene: DiscoveryScene, afterStep: number, framePath: DomAddress[], scopes: DomAddress[], associations: DialogAssociation[], limits: DiscoveryLimits, signal?: AbortSignal, popup?: PopupLink, confirmationEntries?: ConfirmationEntry[], exploration?: ExplorationOptions): Promise<DiscoverySnapshot> {
  const snapshot: DiscoverySnapshot = { id: `${scene.id}:${afterStep}`, sceneId: scene.id, afterStep, url: page.url(), controls: [], cells: [], dialogs: [], documents: [], associations: JSON.parse(JSON.stringify(associations)), warnings: [], truncated: false, unresolvedControls: 0, pageLabels: [], regions: [] };
  let visited = 0;
  const visit = async (current: Frame, path: DomAddress[], scanScopes: DomAddress[], currentPopup?: PopupLink) => {
    const context = { url: current.url(), framePath: path };
    if (visited >= limits.maxFrames || path.length > limits.maxFrameDepth) {
      snapshot.documents.push({ context, status: "limited", reason: "Frame 数量或深度预算不足" }); snapshot.truncated = true; return;
    }
    visited++;
    try {
      if (signal?.aborted) throw new Error("发现已取消");
      await current.waitForLoadState("domcontentloaded", { timeout: limits.timeoutMs });
      const settings: ScanOptions = {
        maxControls: Math.max(0, limits.maxControls - snapshot.controls.length), maxCells: Math.max(0, limits.maxCells - snapshot.cells.length - (snapshot.handsontables ?? []).reduce((n, t) => n + t.coverage.inspectedCells, 0)),
        maxOptions: limits.maxOptions, maxTextLength: limits.maxTextLength, maxShadowDepth: limits.maxShadowDepth,
        scopes: scanScopes, framePath: path, includeRegions: true, includeRegionText: !!exploration, ...(confirmationEntries ? { confirmationEntries } : {}), ...(currentPopup ? { popup: currentPopup } : {}),
      };
      const observed = await current.evaluate(scanDocument, settings);
      if (exploration && (observed.pageLabels?.some(label => ['主配方', ...(exploration.excludeNames ?? [])].some(name => label.includes(name))) || exploration.excludeUrlIncludes?.some(part => observed.url.includes(part)))) {
        snapshot.documents.push({ context, status: 'excluded', reason: '文档命中排除名称或 URL 规则' }); return;
      }
      snapshot.controls.push(...observed.controls); snapshot.cells.push(...observed.cells); snapshot.dialogs.push(...observed.dialogs);
      for (const target of observed.handsontableTargets ?? []) {
        snapshot.handsontables ??= [];
        try {
          if (signal?.aborted) throw new Error('发现已取消');
          if (!target.locator.unique) throw new Error('Handsontable 缺少唯一可见外层定位');
          const remaining = Math.max(0, limits.maxCells - snapshot.cells.length - snapshot.handsontables.reduce((n, t) => n + t.coverage.inspectedCells, 0));
          const reading = await readHandsontable(current, target.locator, { maxCells: remaining, maxTextLength: limits.maxTextLength });
          snapshot.handsontables.push({ ...target, ...reading });
          snapshot.truncated ||= reading.coverage.truncated;
        } catch (error) {
          const reason = String(error).slice(0, 600);
          snapshot.handsontables.push({ ...target, status: 'unavailable', cells: [], elapsedMs: 0,
            coverage: { scope: 'rendered-dom', totalCells: null, allDataCovered: false, renderedDataCells: 0, inspectedCells: 0, observedCells: 0, skippedHiddenCells: 0, truncated: true, reasons: [reason] } });
          snapshot.warnings.push(reason); snapshot.truncated = true;
        }
      }
      snapshot.regions!.push(...(observed.regions ?? []));
      snapshot.pageLabels!.push(...(observed.pageLabels ?? []));
      snapshot.warnings.push(...observed.warnings.map(w => `${JSON.stringify(path)}：${w}`));
      snapshot.truncated ||= observed.truncated;
      snapshot.unresolvedControls += observed.unresolvedControls;
      snapshot.documents.push({ context: { ...context, url: observed.url }, status: "scanned" });
      for (const address of observed.frames) {
        const childPath = [...path, { selector: address.selector, shadowPath: address.shadowPath }];
        let host: ElementHandle<Element> | null = null;
        try {
          if (!address.unique) throw new Error(address.reason ?? "Frame 缺少可靠入口");
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
  return snapshot;
}
