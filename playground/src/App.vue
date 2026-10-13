<script setup lang="ts">
import { computed, defineAsyncComponent, onUnmounted, ref, watch } from "vue";
import { ElMessageBox } from "element-plus";
import Icon from "./components/Icon.vue";
import ComponentWorkspace from "./components/ComponentWorkspace.vue";
import { resetAll, resetEpoch, savedAt, storageWarning } from "./store";
const pages = [
  {
    id: "inputs",
    title: "基础输入",
    caption: "文本、数字与边界",
    description: "从最简单的输入开始，观察格式校验、字符限制与保存反馈。",
    tags: ["文本输入", "数字限制", "边界校验"],
  },
  {
    id: "linkage",
    title: "联动规则",
    caption: "互斥、依赖与禁用",
    description: "改变一个选项，观察其他控件如何响应。每条依赖都有清晰的状态。",
    tags: ["双向互斥", "必选依赖", "条件启用"],
  },
  {
    id: "dialogs",
    title: "嵌套弹框",
    caption: "逐层确认与回退",
    description: "在配置弹框中选择变量，体验草稿、确认和取消之间的边界。",
    tags: ["弹框配置", "变量选择", "取消回退"],
  },
  {
    id: "extended",
    title: "扩展输入",
    caption: "选择、时间与文件",
    description: "更多真实业务中常见的输入形式，在这里组合成一份可保存配置。",
    tags: ["级联选择", "日期时间", "文件选择"],
  },
  {
    id: "table",
    title: "动态表格",
    caption: "增删、校验与分页",
    description: "编辑一组物料明细，练习按行操作、重复校验和删除确认。",
    tags: ["动态行", "行内编辑", "搜索分页"],
  },
  {
    id: "all",
    title: "全部组件",
    caption: "所有交互集中体验",
    description: "在同一个页面操作全部控件，完整体验输入、联动、弹框和表格。",
    tags: ["全部控件", "分区保存", "快速定位"],
  },
  { id: "discovery", title: "发现验证", caption: "弹层、列表与文档边界", description: "观察指定弹框、选项完整性、Frame、Shadow DOM 和单元格显示。", tags: ["跨边界发现", "选项证据", "显示采集"] },
  { id: "entries", title: "入口探索", caption: "列表、表单与深层入口", description: "自动发现新增、编辑、详情及展示功能，记录路径和探索深度。", tags: ["自动探索", "深层路径", "不保存"] },
];
const sections = pages.filter((page) => !["all", "discovery", "entries"].includes(page.id));
const views: Record<string, ReturnType<typeof defineAsyncComponent>> = {
  entries: defineAsyncComponent(() => import("./views/EntryDiscoveryView.vue")),
  discovery: defineAsyncComponent(() => import("./views/DiscoveryView.vue")),
  inputs: defineAsyncComponent(() => import("./views/InputsView.vue")),
  linkage: defineAsyncComponent(() => import("./views/LinkageView.vue")),
  dialogs: defineAsyncComponent(() => import("./views/DialogsView.vue")),
  extended: defineAsyncComponent(() => import("./views/ExtendedView.vue")),
  table: defineAsyncComponent(() => import("./views/TableView.vue")),
};
const getId = () => {
  const id = location.hash.replace(/^#\/?/, "").split("?")[0];
  return pages.some((p) => p.id === id) ? id : "inputs";
};
const active = ref(getId());
const onHash = () => {
  active.value = getId();
  window.scrollTo({ top: 0 });
};
window.addEventListener("hashchange", onHash);
onUnmounted(() => window.removeEventListener("hashchange", onHash));
const meta = computed(() => pages.find((p) => p.id === active.value)!);
watch(
  meta,
  (page) => {
    document.title = `${page.title} · 交互配置实验室`;
  },
  { immediate: true },
);
const index = computed(() => pages.findIndex((p) => p.id === active.value) + 1);
const savedCount = computed(() => Object.keys(savedAt.value).length);
async function reset() {
  try {
    await ElMessageBox.confirm(
      "将清除本站五个配置区域的已保存配置和未保存草稿（包括全部组件页），恢复初始示例。其他浏览器数据不受影响。",
      "重置全部示例",
      {
        confirmButtonText: "确认重置",
        cancelButtonText: "取消",
        type: "warning",
        closeOnClickModal: false,
      },
    );
    resetAll();
  } catch {
    /* User cancelled. */
  }
}
</script>
<template>
  <div class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="#/inputs"
        ><span class="brand-symbol">M<span>·</span></span>
        <div><strong>MES Lab</strong><small>交互配置实验室</small></div></a
      >
      <div class="nav-section-label">练习工作台</div>
      <nav aria-label="练习页面">
        <a
          v-for="(page, i) in pages"
          :key="page.id"
          :href="`#/${page.id}`"
          :class="['nav-item', { active: active === page.id }]"
          :aria-current="active === page.id ? 'page' : undefined"
          :data-testid="`nav-${page.id}`"
          ><Icon :name="page.id" />
          <div>
            <strong>{{ page.title }}</strong
            ><small>{{ page.caption }}</small>
          </div>
          <span class="nav-index">0{{ i + 1 }}</span></a
        >
      </nav>
      <div class="sidebar-bottom">
        <div class="sandbox-mark"><span class="live-dot" />本地练习环境</div>
        <p>放心尝试，每一次配置<br />都可以重新开始。</p>
        <div class="version-line">
          <span>INTERACTION LAB</span><span>v0.1</span>
        </div>
      </div>
    </aside>
    <div class="workspace">
      <header class="topbar">
        <div class="breadcrumb">
          工作空间 <span>/</span> <strong>交互配置实验室</strong>
        </div>
        <div class="top-actions">
          <span class="local-badge"
            ><span class="live-dot" />浏览器本地保存</span
          ><el-button
            text
            class="reset-button"
            data-testid="reset-all"
            @click="reset"
            ><Icon name="reset" :size="16" />重置全部示例</el-button
          >
        </div>
      </header>
      <main id="main-content">
        <el-alert
          v-if="storageWarning"
          :title="storageWarning"
          type="warning"
          show-icon
          :closable="false"
          class="storage-alert"
          data-testid="storage-warning"
        />
        <div class="page-heading" id="component-section-top" tabindex="-1">
          <div>
            <div class="eyebrow">
              COMPONENT WORKSPACE <span>/ 0{{ index }}</span>
            </div>
            <h1>{{ meta.title }}<span class="heading-dot">.</span></h1>
            <p>{{ meta.description }}</p>
          </div>
          <div class="page-count">
            <strong>0{{ index }}</strong
            ><span>/ {{ String(pages.length).padStart(2, "0") }}</span>
          </div>
        </div>
        <div class="context-row">
          <div class="tag-list">
            <span v-for="tag in meta.tags" :key="tag">{{ tag }}</span>
          </div>
          <span class="save-note">{{ ['discovery', 'entries'].includes(active) ? '仅用于发现验证 · 不保存配置' : '手动保存 · 刷新后保留' }}</span>
        </div>
        <component v-if="['discovery', 'entries'].includes(active)" :is="views[active]" />
        <ComponentWorkspace
          v-show="!['discovery', 'entries'].includes(active)"
          :key="resetEpoch"
          :active="active"
          :sections="sections"
          :views="views"
        />
        <footer class="workspace-footer">
          <span>MES Lab · 为复杂交互建立清晰规则</span
          ><span
            >{{ savedCount }} / {{ sections.length }} 个区域已有保存记录</span
          >
        </footer>
      </main>
    </div>
  </div>
</template>
