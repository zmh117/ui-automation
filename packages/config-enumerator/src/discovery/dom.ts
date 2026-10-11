import type { ElementHandle, Frame } from "playwright";
import type { DomAddress } from "./types.js";

/** 序列化到目标 Frame；每段 CSS 限制在自己的 Document/ShadowRoot 内。 */
export function resolveDomElement(address: DomAddress): Element | null {
  let root: Document | ShadowRoot = document;
  for (const selector of address.shadowPath ?? []) {
    const hosts: NodeListOf<Element> = root.querySelectorAll(selector);
    if (hosts.length > 1) throw new Error(`Shadow 宿主定位不唯一：${selector}`);
    if (!hosts[0]?.shadowRoot) return null;
    root = hosts[0].shadowRoot;
  }
  const matches = root.querySelectorAll(address.selector);
  if (matches.length > 1) throw new Error(`根内定位不唯一：${address.selector}`);
  return matches[0] ?? null;
}

export async function findElement(frame: Frame, address: DomAddress): Promise<ElementHandle<Element> | null> {
  const handle = await frame.evaluateHandle(resolveDomElement, address);
  const element = handle.asElement() as ElementHandle<Element> | null;
  if (!element) await handle.dispose();
  return element;
}
export async function waitElement(frame: Frame, address: DomAddress, timeout: number): Promise<ElementHandle<Element>> {
  const handle = await frame.waitForFunction(resolveDomElement, address, { timeout });
  const element = handle.asElement() as ElementHandle<Element>;
  try { await element.waitForElementState("visible", { timeout }); }
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
