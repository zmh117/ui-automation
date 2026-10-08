<script setup lang="ts">
defineProps<{ rules: string[] }>();
</script>
<template>
  <section class="rule-panel">
    <div class="aside-eyebrow">交互规则</div>
    <h3>试试看，会发生什么？</h3>
    <ol>
      <li v-for="(rule, i) in rules" :key="rule">
        <span>{{ String(i + 1).padStart(2, "0") }}</span>
        <p>{{ rule }}</p>
      </li>
    </ol>
    <div class="rule-foot">所有变化都有明确的规则。</div>
  </section>
</template>
