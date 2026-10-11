<script setup lang="ts">
import { ref } from 'vue';
import DiscoveryShadow from '../components/DiscoveryShadow.vue';
const depth = Number(new URLSearchParams(location.search).get('depth') ?? 1);
const open = ref(false), value = ref(`frame-${depth}`);
</script>
<template>
  <section data-testid="frame-ready" style="font-family: sans-serif; padding: 10px">
    <strong>嵌入配置 · 第 {{ depth }} 层</strong>
    <label>同名字段 <input id="shared-field" data-testid="shared-field" v-model="value" /></label>
    <button type="button" data-testid="frame-open" @click="open = true">打开嵌入配置</button>
    <Teleport to="body">
      <div v-if="open" role="dialog" aria-label="Frame 配置" data-testid="frame-dialog">
        <label>Frame 备注 <input data-testid="frame-note" value="Frame 弹框已关联" /></label>
      </div>
    </Teleport>
    <DiscoveryShadow v-if="depth === 1" data-testid="frame-shadow" />
    <iframe v-if="depth === 1" data-testid="nested-frame" title="二层嵌入页" src="/discovery-frame.html?depth=2" style="width: 100%; height: 130px" />
    <table aria-label="Frame 结果"><tbody><tr data-row-key="frame-weight"><td data-column-key="weight" data-discovery-value="2.5">2.50 kg</td></tr></tbody></table>
  </section>
</template>
