<script setup lang="ts">
import type { Component } from "vue";
import Icon from "./Icon.vue";

const props = defineProps<{
  active: string;
  sections: { id: string; title: string; caption: string }[];
  views: Record<string, Component>;
}>();
const visible = (id: string) => props.active === "all" || props.active === id;
function jump(id: string) {
  const section = document.getElementById(`component-section-${id}`);
  section?.scrollIntoView({ block: "start" });
  section?.focus({ preventScroll: true });
}
</script>

<template>
  <div
    :class="{ 'all-components': active === 'all' }"
    data-testid="component-workspace"
  >
    <nav
      v-if="active === 'all'"
      class="component-jump-nav"
      aria-label="全部组件快速定位"
    >
      <div class="component-jump-intro">
        <strong>所有交互，一页体验</strong>
        <p>与分类页共用配置和草稿，每个区域独立校验、保存。</p>
      </div>
      <div class="component-jump-links">
        <button
          v-for="section in sections"
          :key="section.id"
          type="button"
          :data-testid="`jump-${section.id}`"
          @click="jump(section.id)"
        >
          <Icon :name="section.id" :size="16" />{{ section.title }}
        </button>
      </div>
    </nav>
    <section
      v-for="(section, index) in sections"
      :key="section.id"
      v-show="visible(section.id)"
      :id="`component-section-${section.id}`"
      :data-testid="`section-${section.id}`"
      :aria-label="section.title"
      tabindex="-1"
      class="component-section"
    >
      <header v-if="active === 'all'" class="component-section-heading">
        <span class="component-section-index">0{{ index + 1 }}</span>
        <div>
          <h2>{{ section.title }}</h2>
          <p>{{ section.caption }}</p>
        </div>
        <button
          type="button"
          class="section-to-top"
          :aria-label="`${section.title}：返回快速定位`"
          @click="jump('top')"
        >
          ↑ 返回顶部
        </button>
      </header>
      <!-- One cached instance per section keeps both routes on the same draft. -->
      <KeepAlive>
        <component
          v-if="visible(section.id)"
          :is="views[section.id]"
          v-bind="section.id === 'dialogs' ? { navigationKey: active } : {}"
        />
      </KeepAlive>
    </section>
  </div>
</template>
