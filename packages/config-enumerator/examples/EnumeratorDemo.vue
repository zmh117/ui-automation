<script setup lang="ts">
import { shallowRef } from "vue";
import { createEnumeration } from "@mes-ui/config-enumerator";
import type { ConfigurationCase, EnumerationSummary } from "@mes-ui/config-enumerator";
import model from "./other-vue-form.json";

const cases = shallowRef<ConfigurationCase[]>([]);
const summary = shallowRef<EnumerationSummary | null>(null);
const error = shallowRef("");

function generate() {
  error.value = "";
  cases.value = [];
  summary.value = null;
  try {
    // 此演示模型仅 48 条；大模型请用 Worker 或 Node CLI 逐条消费。
    const run = createEnumeration(model, { maxCases: 1000 });
    cases.value = [...run.cases];
    summary.value = run.getSummary();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}
</script>

<template>
  <main>
    <h1>全量配置枚举示例</h1>
    <p>独立表单：设定方式、数量、多选检查项和计划时间。这里只生成候选，不执行 UI。</p>
    <button type="button" @click="generate">生成全量配置</button>
    <p v-if="error" role="alert">{{ error }}</p>
    <section v-if="summary" aria-label="枚举结果">
      <p>候选 {{ summary.totalCandidates }} · 已生成 {{ summary.generated }} · 合法 {{ summary.valid }} · 非法 {{ summary.invalid }}</p>
      <p>{{ summary.complete ? "全量枚举完成" : "枚举未完成：" + summary.status }}</p>
      <table>
        <thead><tr><th>序号</th><th>取值</th><th>分类</th><th>违规原因</th></tr></thead>
        <tbody>
          <tr v-for="item in cases" :key="item.id">
            <td>{{ item.ordinal }}</td>
            <td><code>{{ JSON.stringify(item.values) }}</code></td>
            <td>{{ item.classification === "valid" ? "合法" : "非法" }}</td>
            <td>{{ item.violations.map(v => v.message).join("；") || "—" }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </main>
</template>

<style scoped>
main { padding: 24px; font-family: system-ui, sans-serif; color: #172b4d; }
button { padding: 8px 16px; cursor: pointer; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { padding: 10px; border: 1px solid #dfe4ec; text-align: left; }
th { background: #f3f6fa; }
code { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
