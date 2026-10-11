<script setup lang="ts">
import { createApp, h, onBeforeUnmount, onMounted, ref, type App } from "vue";
const props = withDefaults(defineProps<{ closed?: boolean; frame?: boolean }>(), { closed: false, frame: false });
const host = ref<HTMLElement>();
const apps: App[] = [];
function mountRoot(element: HTMLElement, depth: number) {
  const root = element.attachShadow({ mode: props.closed ? "closed" : "open" });
  const style = document.createElement("style");
  style.textContent = ':host{display:block;border:1px solid #c5d4dd;padding:12px;margin:8px 0}label,select,button{display:block;margin:8px 0}input{padding:6px}';
  root.append(style);
  const container = document.createElement("div"); root.append(container);
  const app = createApp({ setup() {
    const opened = ref(false), value = ref(`shadow-${depth}`), nested = ref<HTMLElement>();
    onMounted(() => { if (nested.value) mountRoot(nested.value, depth + 1); });
    return () => h('section', { 'aria-label': `Shadow 第 ${depth + 1} 层` }, [
      h('label', ['Shadow 数值 ', h('input', { id: 'shared-field', 'data-testid': 'shared-field', value: value.value, onInput: (e: Event) => value.value = (e.target as HTMLInputElement).value })]),
      h('button', { type: 'button', 'data-testid': 'shadow-open', onClick: () => opened.value = true }, '打开 Shadow 弹框'),
      opened.value ? h('div', { role: 'dialog', 'aria-label': 'Shadow 配置', 'data-testid': 'shadow-dialog' }, [h('label', ['内部备注 ', h('input', { 'data-testid': 'shadow-note', value: '开放根内备注' })])]) : null,
      depth === 0 && !props.closed ? h('div', { ref: nested, 'data-testid': 'nested-shadow' }) : null,
      depth === 0 && props.frame ? h('iframe', { 'data-testid': 'shadow-frame', title: 'Shadow 内嵌页面', src: '/discovery-frame.html?depth=2', style: 'width:100%;height:150px' }) : null,
    ]);
  } });
  app.mount(container); apps.push(app);
}
onMounted(() => mountRoot(host.value!, 0));
onBeforeUnmount(() => { for (const app of apps.reverse()) app.unmount(); });
</script>
<template><div ref="host" :data-discovery-shadow="closed ? 'closed' : 'open'" /></template>
