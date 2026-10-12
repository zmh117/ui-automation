import { group, inSet } from './cases';

export const texts = ['', '称重配置', '<>&"😀', 'a'.repeat(101)];
export const remarks = ['', '边界内备注😀', 'a'.repeat(101)];
export const shadowContexts = ['main-shadow', 'main-nested-shadow', 'frame-a-shadow', 'frame-a-nested-shadow', 'frame-b-shadow', 'frame-b-nested-shadow'];
export const frameContexts = ['shadow-frame', 'frame-a', 'frame-b', 'nested-a', 'nested-b', 'cross-frame'];
export const inputs = group('discovery.inputs', { raw: texts, unit: ['kg', 'g', 't'] }, [inSet('unit.disabled', 'unit', ['kg', 'g'])]);
export const teleport = group('discovery.teleport', { outerText: ['', '称重配置', 'a'.repeat(101)], innerText: ['', 'V001', '变量😀'], exit: ['inner-cancel', 'outer-cancel'] });
export const shadow = group('discovery.shadow', { context: shadowContexts, raw: texts, remark: remarks });
export const frames = group('discovery.frames', { context: frameContexts, raw: texts, remark: remarks });
export const lists = group('discovery.lists', { list: ['complete', 'paged', 'virtual', 'unknown', 'remote'], advance: [0, 1, 2] }, [{
  id: 'list.advance-unavailable', message: '此列表没有翻页或换段入口',
  when: { op: 'in', field: 'list', values: ['complete', 'unknown', 'remote'] },
  assert: { op: 'eq', field: 'advance', value: 0 },
}]);
export const observation = group('discovery.observation', {
  entry: ['teleport', 'shadow', 'frame'], budget: ['normal', 'options', 'shadow', 'frames', 'cells'],
});
export const groups = [inputs, teleport, shadow, frames, lists, observation];
