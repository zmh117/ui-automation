import type { ElementHandle, Frame } from "playwright";
import type { DomAddress } from "./types.js";

import { checkDomVisibility, resolveDomElement } from "./scan.js";
export { resolveDomElement } from "./scan.js";

/** 子文档不能自行判断跨源外层入口的隐藏状态，由 Playwright 检查实际宿主。 */
async function visibleFramePath(frame: Frame, deadline?: number): Promise<boolean> {
  const path: Frame[] = [];
  for (let child = frame; child.parentFrame(); child = child.parentFrame()!) path.unshift(child);
  for (const child of path) {
    const host = await child.frameElement() as ElementHandle<Element>, parent = child.parentFrame()!;
    try {
      if (deadline === undefined) {
        if (!await parent.evaluate(checkDomVisibility, { visibility: host })) return false;
      } else {
        const ready = await parent.waitForFunction(checkDomVisibility, { visibility: host }, { timeout: Math.max(1, deadline - Date.now()) });
        await ready.dispose();
      }
    } finally { await host.dispose(); }
  }
  return true;
}

export async function findElement(frame: Frame, address: DomAddress): Promise<ElementHandle<Element> | null> {
  if (!await visibleFramePath(frame)) return null;
  const handle = await frame.evaluateHandle(resolveDomElement, { resolve: address });
  const element = handle.asElement() as ElementHandle<Element> | null;
  if (!element) await handle.dispose();
  return element;
}
export async function waitElement(frame: Frame, address: DomAddress, timeout: number): Promise<ElementHandle<Element>> {
  const deadline = Date.now() + timeout;
  await visibleFramePath(frame, deadline);
  const handle = await frame.waitForFunction(resolveDomElement, { resolve: address }, { timeout: Math.max(1, deadline - Date.now()) });
  const element = handle.asElement() as ElementHandle<Element>;
  try { await element.waitForElementState("visible", { timeout: Math.max(1, deadline - Date.now()) }); }
  catch (error) { await element.dispose(); throw error; }
  return element;
}
export async function enterFrames(frame: Frame, path: DomAddress[], timeout: number): Promise<Frame> {
  for (const address of path) {
    const host = await waitElement(frame, address, timeout);
    try {
      const child = await host.contentFrame();
      if (!child) throw new Error("Frame 入口不是已连接的 iframe");
      frame = child;
      await frame.waitForLoadState("domcontentloaded", { timeout });
    } finally { await host.dispose(); }
  }
  return frame;
}
