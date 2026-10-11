<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import DiscoveryShadow from '../components/DiscoveryShadow.vue';
const outer = ref(false), inner = ref(false), field = ref('主文档值'), activeList = ref('');
const variables = ref<{ value: string; label: string }[]>([]), loading = ref(true), loadError = ref('');
const pageNumber = ref(1), virtualStart = ref(0);
const remoteController = new AbortController();
let timer: ReturnType<typeof setTimeout>;
const lists = [
  { id: 'complete', label: '完整选项（5 项）' },
  { id: 'paged', label: '分页选项（每页 2 项）' },
  { id: 'virtual', label: '虚拟选项（仅渲染 3 项）' },
  { id: 'unknown', label: '未知总数选项' },
  { id: 'remote', label: '远程加载选项' },
];
const fixed = Array.from({ length: 5 }, (_, i) => ({ value: `V00${i + 1}`, label: `变量 ${i + 1}`, position: i + 1 }));
const virtualItems = computed(() => Array.from({ length: 3 }, (_, i) => ({ value: `X${virtualStart.value + i + 1}`, label: `虚拟变量 ${virtualStart.value + i + 1}`, position: virtualStart.value + i + 1 })));
const shown = (id: string) => id === 'virtual' ? virtualItems.value : id === 'paged' ? fixed.slice((pageNumber.value - 1) * 2, pageNumber.value * 2) : id === 'remote' ? variables.value.map((v, i) => ({ ...v, position: i + 1 })) : id === 'unknown' ? fixed.slice(0, 2) : fixed;
const crossFrame = new URL('/discovery-frame.html?depth=2', location.href);
crossFrame.hostname = location.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
onMounted(() => {
  timer = setTimeout(async () => {
    try { const response = await fetch('/discovery-options.json', { signal: remoteController.signal }); if (!response.ok) throw new Error(`HTTP ${response.status}`); variables.value = await response.json(); }
    catch (error) { if (!remoteController.signal.aborted) loadError.value = String(error); }
    finally { loading.value = false; }
  }, 2000);
});
onBeforeUnmount(() => { clearTimeout(timer); remoteController.abort(); });
</script>
<template>
  <div class="discovery-lab">
    <p class="intro">检查外置弹框、列表完整性、嵌入页面和显示格式。此页不保存配置。</p>
    <section data-testid="discovery-editor" class="example-card" :inert="outer">
      <h2>范围内编辑器</h2>
      <label for="shared-field">主文档字段</label><input id="shared-field" data-testid="shared-field" v-model="field" />
      <button type="button" data-testid="open-evidence-dialog" @click="outer = true">打开变量配置</button>
      <label>原生选择 <select data-testid="native-options"><option value="kg">千克</option><option value="g">克</option><option value="t" disabled>吨（不可用）</option></select></label>
      <div class="list-examples">
        <div v-for="list in lists" :key="list.id" :data-testid="`${list.id}-region`">
          <button :data-testid="`${list.id}-opener`" type="button" role="combobox" aria-haspopup="listbox" :aria-expanded="activeList === list.id" :aria-controls="`${list.id}-list`" @click="activeList = list.id">{{ list.label }}</button>
          <div v-if="activeList === list.id" role="listbox" :id="`${list.id}-list`" :data-testid="`${list.id}-list`" :aria-busy="list.id === 'remote' && loading" class="option-list">
            <p v-if="list.id === 'remote' && loading" role="status">正在加载变量…</p>
            <div v-for="item in shown(list.id)" :key="item.value" role="option" :data-value="item.value" aria-selected="false" :aria-setsize="list.id === 'unknown' ? undefined : list.id === 'virtual' ? 100 : 5" :aria-posinset="list.id === 'unknown' ? undefined : item.position">{{ item.label }}</div>
            <button v-if="list.id === 'paged'" type="button" @click="pageNumber = pageNumber === 3 ? 1 : pageNumber + 1">下一页</button>
            <button v-if="list.id === 'virtual'" type="button" @click="virtualStart = (virtualStart + 3) % 96">滚动到下一段</button>
          </div>
        </div>
      </div>
      <span v-if="!loading && !loadError" data-testid="remote-ready">远程变量已加载</span><span v-if="loadError" role="alert">{{ loadError }}</span>
      <h3>显示格式</h3>
      <table data-testid="evidence-table" aria-label="称重显示结果">
        <thead><tr><th>变量</th><th>重量</th></tr></thead>
        <tbody><tr data-row-key="weight-1"><td data-column-key="name">目标重量</td><td data-testid="weight-cell" data-column-key="weight" data-discovery-value="12.3">12.30 kg<span hidden>隐藏的旧值 999</span></td></tr></tbody>
      </table>
      <div role="grid" aria-label="ARIA 结果" data-testid="evidence-grid">
        <div role="row" aria-rowindex="1"><span role="columnheader" aria-colindex="1">温度</span></div>
        <div role="row" aria-rowindex="2" data-row-key="temperature"><span role="gridcell" aria-colindex="1" data-column-key="temperature" data-testid="temperature-cell" data-discovery-value="20">20.0 °C</span></div>
      </div>
      <h3>开放 Shadow DOM</h3><DiscoveryShadow data-testid="open-shadow" :frame="true" />
      <h3>闭合 Shadow DOM（不支持内部扫描）</h3><DiscoveryShadow data-testid="closed-shadow" closed />
      <h3>嵌入配置</h3>
      <iframe data-testid="frame-one" title="配置 Frame A" src="/discovery-frame.html?depth=1" />
      <iframe data-testid="frame-two" title="配置 Frame B，同 URL" src="/discovery-frame.html?depth=1" />
      <iframe data-testid="cross-frame" title="跨源配置 Frame" :src="crossFrame.href" />
      <span data-testid="discovery-ready">实例已挂载</span>
    </section>
    <Teleport to="body">
      <aside class="evidence-dialog unrelated" role="dialog" aria-label="变量选择" data-testid="unrelated-dialog"><strong>无关的同名弹框</strong><input data-testid="unrelated-field" value="不属于编辑器" /><button type="button">确定</button></aside>
      <div v-if="outer" class="evidence-dialog outer" role="dialog" aria-label="变量配置" data-testid="evidence-dialog">
        <strong>第一层 · 范围外配置</strong><label>配置名称<input data-testid="outer-name" value="称重配置" /></label>
        <button type="button" data-testid="open-inner-evidence" @click="inner = true">打开变量选择</button><button type="button" @click="outer = false; inner = false">取消</button>
      </div>
      <div v-if="inner" class="evidence-dialog inner" role="dialog" aria-label="变量选择" data-testid="inner-evidence-dialog">
        <strong>第二层 · 变量选择</strong><label>变量筛选<input data-testid="inner-search" placeholder="变量名称" /></label><button type="button" @click="inner = false">取消</button><button type="button">确定</button>
      </div>
    </Teleport>
  </div>
</template>
<style scoped>
.discovery-lab { max-width: 1000px; } .intro { color: #536477; }
.example-card { background: white; border: 1px solid #d7e0e7; border-radius: 12px; padding: 24px; }
h2,h3 { margin: 18px 0 12px; } label { display:block; margin: 10px 0; }
input,select,button { padding: 7px 10px; border: 1px solid #b5c4ce; border-radius: 5px; background:white; color:#20354a; margin: 4px; }
button { cursor:pointer; } .list-examples { display:grid; grid-template-columns: 1fr 1fr; gap:12px; }
.option-list { border:1px solid #becedb; padding:8px; } [role=option] { padding:5px; }
table { border-collapse:collapse; width:100%; } th,td,[role=gridcell],[role=columnheader] { border:1px solid #d4dfe6; padding:8px; }
iframe { width:100%; height:350px; border:1px solid #b5c4ce; margin-top:10px; }
.evidence-dialog { position:fixed; z-index:50; width:300px; padding:18px; background:#fff; border:2px solid #367c80; box-shadow:0 6px 24px #0002; border-radius:10px; }
.unrelated { bottom:12px; right:12px; z-index:10; }.outer { top:90px; right:22px; }.inner { top:300px; right:22px; }
@media(max-width:700px) { .list-examples {grid-template-columns:1fr;} .unrelated {position:static;} }
</style>
