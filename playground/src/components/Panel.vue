<script setup lang="ts">
defineProps<{ title: string; subtitle?: string; number?: string }>();
</script>
<template>
  <section class="panel">
    <header class="panel-heading">
      <span v-if="number" class="section-number">{{ number }}</span>
      <div>
        <h2>{{ title }}</h2>
        <p v-if="subtitle">{{ subtitle }}</p>
      </div>
      <div class="panel-heading-extra"><slot name="extra" /></div>
    </header>
    <div class="panel-body"><slot /></div>
    <footer v-if="$slots.footer" class="panel-footer">
      <slot name="footer" />
    </footer>
  </section>
</template>
