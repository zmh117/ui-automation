import { expect, type Page, type ElementHandle } from '@playwright/test';
import { enterFrames, waitElement, scanDocument, type DomAddress, type ScanOptions } from '@mes-ui/config-enumerator/discovery';

export const byId = (id: string): DomAddress => ({ selector: `[data-testid="${id}"]` });
export type Location = { framePath: DomAddress[]; shadowPath: string[]; initial: string };
const frame = (id: string) => byId(id);
export const locations: Record<string, Location> = {
  main: { framePath: [], shadowPath: [], initial: '主文档值' },
  'main-shadow': { framePath: [], shadowPath: [byId('open-shadow').selector], initial: 'shadow-0' },
  'main-nested-shadow': { framePath: [], shadowPath: [byId('open-shadow').selector, byId('nested-shadow').selector], initial: 'shadow-1' },
  'shadow-frame': { framePath: [{ ...frame('shadow-frame'), shadowPath: [byId('open-shadow').selector] }], shadowPath: [], initial: 'frame-2' },
  'frame-a': { framePath: [frame('frame-one')], shadowPath: [], initial: 'frame-1' },
  'frame-b': { framePath: [frame('frame-two')], shadowPath: [], initial: 'frame-1' },
  'nested-a': { framePath: [frame('frame-one'), frame('nested-frame')], shadowPath: [], initial: 'frame-2' },
  'nested-b': { framePath: [frame('frame-two'), frame('nested-frame')], shadowPath: [], initial: 'frame-2' },
  'cross-frame': { framePath: [frame('cross-frame')], shadowPath: [], initial: 'frame-2' },
  'frame-a-shadow': { framePath: [frame('frame-one')], shadowPath: [byId('frame-shadow').selector], initial: 'shadow-0' },
  'frame-a-nested-shadow': { framePath: [frame('frame-one')], shadowPath: [byId('frame-shadow').selector, byId('nested-shadow').selector], initial: 'shadow-1' },
  'frame-b-shadow': { framePath: [frame('frame-two')], shadowPath: [byId('frame-shadow').selector], initial: 'shadow-0' },
  'frame-b-nested-shadow': { framePath: [frame('frame-two')], shadowPath: [byId('frame-shadow').selector, byId('nested-shadow').selector], initial: 'shadow-1' },
};
export const scanSettings: ScanOptions = { scopes: [{ selector: 'body' }], framePath: [], maxControls: 300, maxCells: 300, maxOptions: 100, maxTextLength: 500, maxShadowDepth: 8 };

export class DiscoveryLab {
  writes: string[] = [];
  constructor(readonly page: Page) {
    page.on('request', r => { if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method())) this.writes.push(`${r.method()} ${r.url()}`); });
  }
  async goto() {
    await this.page.goto('/#/discovery');
    await expect(this.page.getByTestId('discovery-ready')).toBeVisible();
  }
  async element<T>(context: string, id: string, run: (e: ElementHandle<Element>) => Promise<T>): Promise<T> {
    const location = locations[context];
    if (!location) throw new Error(`未知文档地址：${context}`);
    const target = await enterFrames(this.page.mainFrame(), location.framePath, 5000);
    const el = await waitElement(target, { ...byId(id), shadowPath: location.shadowPath }, 5000);
    try { return await run(el); } finally { await el.dispose(); }
  }
  fill(context: string, id: string, value: string) { return this.element(context, id, e => e.fill(value)); }
  click(context: string, id: string) { return this.element(context, id, e => e.click()); }
  value(context: string, id = 'shared-field') { return this.element(context, id, e => e.inputValue()); }
  async assertIsolation(changed?: string, value?: string) {
    const expected = Object.fromEntries(Object.entries(locations).map(([name, l]) => [name, name === changed ? value : l.initial]));
    await expect.poll(async () => Object.fromEntries(await Promise.all(Object.keys(locations).map(async name => [name, await this.value(name)]))), { message: '只有指定文档/Shadow 字段应改变，其他同名字段保持默认' }).toEqual(expected);
  }
  async noSave() {
    expect(this.writes, '验证页不应提交业务写请求').toEqual([]);
    const storage = await this.page.context().storageState();
    expect(storage.origins.flatMap(o => o.localStorage), '本页未实现保存，不应写 localStorage').toEqual([]);
  }
  async reload() {
    await this.noSave();
    await this.page.reload();
    await expect(this.page.getByTestId('discovery-ready')).toBeVisible();
  }
}

/** 仅收尾采集，不用于生成期望值或修复被测状态。 */
export async function captureDiscoveryEvidence(page: Page) {
  const contexts = Object.entries(locations).filter(([, l]) => !l.shadowPath.length);
  const documents = [];
  for (const [name, location] of contexts) {
    try {
      const frame = await enterFrames(page.mainFrame(), location.framePath, 1000);
      documents.push({ name, status: 'observed', ...await frame.evaluate(scanDocument, { ...scanSettings, framePath: location.framePath }) });
    } catch (error) { documents.push({ name, status: 'unavailable', error: String(error) }); }
  }
  return { url: page.url(), documents };
}
