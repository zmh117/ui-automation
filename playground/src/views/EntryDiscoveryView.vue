<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
const hash = ref(location.hash);
const update = () => { hash.value = location.hash; };
window.addEventListener('hashchange', update);
onUnmounted(() => window.removeEventListener('hashchange', update));
const params = computed(() => new URLSearchParams(hash.value.split('?')[1] ?? ''));
const mode = computed(() => params.value.get('mode') ?? 'list');
const item = computed(() => params.value.get('item') ?? '');
const dialog = ref(false), nested = ref(false), deletion = ref(''), detail = ref(false);
const tab = ref('basic'), dropdown = ref(false), note = ref(''), effects = ref(Number(localStorage.getItem('mes-entry-lab-effects') ?? 0));
const recordEffect = () => { effects.value++; localStorage.setItem('mes-entry-lab-effects', String(effects.value)); };
const go = (next: string, id = '') => { location.hash = `/entries?mode=${next}&item=${id}`; };
const popup = () => window.open('/#/entries?mode=detail&item=A', '_blank');
const rows = ['A', 'B'];
</script>

<template>
  <section class="entry-lab" aria-label="入口探索实验室">
    <div class="entry-banner"><strong>自动探索 · 第八个练习页面</strong><p>同名行操作、独立页面、新窗口与三层展开。不填写、不保存；删除仅打开确认层。</p></div>
    <p role="status">业务操作计数：{{ effects }}</p>
    <template v-if="mode === 'list'">
      <div class="entry-actions">
        <button type="button" @click="dialog = true">新增</button>
        <button type="button" @click="go('new')">新建页面</button>
        <button type="button" @click="popup">查看新窗口</button>
        <button type="button" @click="detail = !detail">展示统计</button>
        <button type="button" @click="go('recipe')">新增主配方</button>
        <button type="button" @click="recordEffect()">启用</button>
        <button type="button" @click="recordEffect()">未知功能</button>
      </div>
      <section v-if="detail" role="region" aria-label="物料统计"><h3>物料统计</h3><p>本页展示 2 条受控物料。</p></section>
      <table aria-label="入口示例物料"><thead><tr><th>物料编码</th><th>名称</th><th>操作</th></tr></thead>
        <tbody><tr v-for="id in rows" :key="id" :data-row-key="id"><td>{{ id }}</td><td>物料 {{ id }}</td><td class="entry-actions">
          <button type="button" @click="go('edit', id)">修改</button>
          <a :href="`#/entries?mode=detail&item=${id}`">详情</a>
          <button type="button" :aria-label="`删除物料 ${id}`" @click="deletion = id">删除</button>
        </td></tr></tbody>
      </table>
    </template>
    <form v-else-if="mode === 'new' || mode === 'edit'" :aria-label="mode === 'edit' ? `编辑物料 ${item}` : '新建物料'" @submit.prevent="recordEffect()">
      <h2>{{ mode === 'edit' ? `编辑物料 ${item}` : '新建物料' }}</h2>
      <label>物料说明<input v-model="note" maxlength="100"></label>
      <button type="button" @click="dialog = true">配置参数</button>
      <button type="submit">保存</button><button type="button" @click="go('list')">返回</button>
    </form>
    <section v-else-if="mode === 'detail'" role="region" :aria-label="`物料 ${item} 详情`"><h2>物料 {{ item }} 详情</h2><p>状态：待配置；计量单位：kg。</p><button type="button" @click="detail = !detail">展开说明</button><section v-if="detail" role="region" aria-label="详细说明">只读展示，没有输入框。</section></section>
    <section v-else-if="mode === 'recipe'"><h2>主配方配置</h2><input aria-label="主配方字段"></section>
    <Teleport to="body">
      <div v-if="dialog" class="entry-overlay"><section role="dialog" aria-modal="true" aria-label="物料配置" class="entry-modal">
        <h2>物料配置</h2>
        <div role="tablist" aria-label="配置页签"><button type="button" role="tab" :aria-selected="tab === 'basic'" @click="tab = 'basic'">基本信息</button><button type="button" role="tab" :aria-selected="tab === 'extra'" @click="tab = 'extra'">扩展信息</button></div>
        <section role="tabpanel" :aria-label="tab === 'basic' ? '基本信息' : '扩展信息'">
          <label v-if="tab === 'basic'">名称<input v-model="note"></label>
          <label v-else>版本说明<input maxlength="100"></label>
          <button type="button" role="combobox" aria-label="计量单位" aria-controls="entry-units" :aria-expanded="dropdown" @click="dropdown = !dropdown">kg</button>
          <ul v-if="dropdown" id="entry-units" role="listbox" aria-label="单位选项"><li role="option" aria-selected="true">kg</li><li role="option" aria-selected="false">g</li></ul>
          <button type="button" @click="nested = true">高级配置</button>
        </section>
        <button type="button" @click="recordEffect()">确认</button><button type="button" @click="dialog = false">取消</button>
      </section></div>
      <div v-if="nested" class="entry-overlay entry-upper"><section role="dialog" aria-modal="true" aria-label="高级参数" class="entry-modal"><h2>高级参数</h2><label>精度<input type="number" min="0" max="6"></label><button type="button" @click="recordEffect()">确定</button><button type="button" @click="nested = false">取消</button></section></div>
      <div v-if="deletion" class="entry-overlay"><section role="alertdialog" aria-modal="true" aria-label="删除确认" class="entry-modal"><h2>删除确认</h2><p>确认删除物料 {{ deletion }}？</p><button type="button" @click="recordEffect()">确认删除</button><button type="button" @click="deletion = ''">取消</button></section></div>
    </Teleport>
  </section>
</template>

<style scoped>
.entry-lab { padding: 28px; background: white; border: 1px solid #e2e7ec; border-radius: 14px; color: #263e43; }
.entry-banner { border-left: 3px solid #238779; padding-left: 18px; margin-bottom: 24px; }
.entry-banner strong { font-size: 20px; } .entry-banner p { color: #6b7e85; }
.entry-actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
button, a { padding: 8px 14px; margin: 5px 4px 5px 0; border: 1px solid #d3dfdc; border-radius: 6px; color: #246d61; background: #f7fbfa; cursor: pointer; font: inherit; }
table { width: 100%; border-collapse: collapse; margin-top: 24px; } th, td { border-bottom: 1px solid #e6ece9; text-align: left; padding: 16px; }
label { display: block; margin: 18px 0; } input { margin-left: 12px; padding: 9px; border: 1px solid #bfcfcc; border-radius: 5px; }
.entry-overlay { position: fixed; inset: 0; background: #163f4940; display: grid; place-items: center; z-index: 3000; }.entry-upper { z-index: 3100; }
.entry-modal { background: white; width: 580px; max-width: 90vw; border-radius: 14px; padding: 28px; box-shadow: 0 20px 70px #163f4940; }
[aria-selected="true"] { background: #e4f3ed; }
</style>
