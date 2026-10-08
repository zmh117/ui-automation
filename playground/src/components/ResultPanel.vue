<script setup lang="ts">
import { computed } from "vue";
import { saved, savedAt } from "../store";
import type { Section } from "../model";
const props = defineProps<{ section: Section; entries: [string, string][] }>();
const time = computed(() => savedAt.value[props.section]);
</script>
<template>
  <section class="result-panel" :data-testid="`${section}-saved-result`">
    <div class="result-title">
      <h3>已保存结果</h3>
      <span :class="['status-badge', { muted: !time }]">{{
        time ? "已保存" : "初始状态"
      }}</span>
    </div>
    <p class="small-note">
      {{
        time
          ? `保存于 ${new Date(time).toLocaleString("zh-CN", { hour12: false })}`
          : "修改配置并保存后，结果会更新在这里。"
      }}
    </p>
    <dl class="result-list">
      <template v-for="[label, value] in entries" :key="label"
        ><dt>{{ label }}</dt>
        <dd>{{ value || "—" }}</dd></template
      >
    </dl>
    <details class="data-details">
      <summary>查看配置数据</summary>
      <pre>{{ JSON.stringify(saved[section], null, 2) }}</pre>
    </details>
  </section>
</template>
