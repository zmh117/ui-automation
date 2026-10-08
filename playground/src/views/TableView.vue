<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessageBox, ElMessage } from "element-plus";
import Panel from "../components/Panel.vue";
import RulePanel from "../components/RulePanel.vue";
import ResultPanel from "../components/ResultPanel.vue";
import { clone } from "../model";
import type { MaterialRow } from "../model";
import { saved, saveSection } from "../store";
const rows = ref(clone(saved.value.rows)),
  search = ref(""),
  page = ref(1);
const errors = ref<Record<string, string>>({});
const filtered = computed(() =>
  rows.value.filter((r) =>
    `${r.code} ${r.name}`
      .toLowerCase()
      .includes(search.value.trim().toLowerCase()),
  ),
);
const pageRows = computed(() =>
  filtered.value.slice((page.value - 1) * 5, page.value * 5),
);
watch(search, () => (page.value = 1));
watch(
  () => filtered.value.length,
  (count) => {
    page.value = Math.min(page.value, Math.max(1, Math.ceil(count / 5)));
  },
);
const result = computed<[string, string][]>(() => [
  ["已保存明细", `${saved.value.rows.length} 行`],
  ["启用明细", `${saved.value.rows.filter((r) => r.enabled).length} 行`],
  ["物料编码", saved.value.rows.map((r) => r.code).join("、")],
]);
function add() {
  if (rows.value.length >= 20) return;
  rows.value.push({
    id: crypto.randomUUID(),
    code: "",
    name: "",
    quantity: 1,
    unit: "kg",
    enabled: true,
  });
  search.value = "";
  page.value = Math.ceil(rows.value.length / 5);
}
async function remove(row: MaterialRow) {
  try {
    await ElMessageBox.confirm(
      `确认从草稿中移除“${row.name || "未命名物料"}”？保存前不会改变已保存记录。`,
      "删除明细",
      {
        type: "warning",
        confirmButtonText: "确认删除",
        cancelButtonText: "取消",
        closeOnClickModal: false,
      },
    );
    rows.value = rows.value.filter((r) => r.id !== row.id);
    delete errors.value[row.id];
  } catch {
    /* User cancelled. */
  }
}
function restore() {
  rows.value = clone(saved.value.rows);
  errors.value = {};
  search.value = "";
  page.value = 1;
}
function submit() {
  errors.value = {};
  const codes = rows.value.map((r) => r.code.trim().toUpperCase());
  for (const row of rows.value) {
    if (!row.code.trim() || !row.name.trim())
      errors.value[row.id] = "编码和名称均为必填";
    else if (
      codes.filter((c) => c === row.code.trim().toUpperCase()).length > 1
    )
      errors.value[row.id] = "物料编码重复（不区分大小写）";
    else if (
      !Number.isFinite(row.quantity) ||
      row.quantity <= 0 ||
      row.quantity > 100000
    )
      errors.value[row.id] = "数量须大于 0 且不超过 100000";
  }
  if (Object.keys(errors.value).length) {
    search.value = "";
    const first = rows.value.findIndex((r) => errors.value[r.id]);
    page.value = Math.floor(first / 5) + 1;
    ElMessage.error("请修正表格中的错误后再保存");
    return;
  }
  const normalized = rows.value.map((r) => ({
    ...r,
    code: r.code.trim(),
    name: r.name.trim(),
  }));
  if (saveSection("rows", normalized)) rows.value = clone(normalized);
}
</script>
<template>
  <div class="table-page">
    <Panel
      number="01"
      title="物料明细"
      subtitle="每行是独立配置；禁用一行后，该行的数量和单位不可编辑。"
      ><template #extra
        ><span class="count-chip">{{ rows.length }} / 20 行</span></template
      >
      <div class="table-toolbar">
        <div class="search-field">
          <label for="material-search" class="sr-only">搜索物料编码或名称</label
          ><input
            id="material-search"
            v-model="search"
            class="text-input"
            placeholder="搜索物料编码或名称"
            data-testid="material-search"
          />
        </div>
        <el-button
          type="primary"
          plain
          :disabled="rows.length >= 20"
          data-testid="add-row"
          @click="add"
          >＋ 添加明细</el-button
        >
      </div>
      <div class="table-scroll">
        <table class="data-table editable-table">
          <thead>
            <tr>
              <th scope="col" style="width: 58px">序号</th>
              <th scope="col">物料编码 <span class="required">*</span></th>
              <th scope="col">物料名称 <span class="required">*</span></th>
              <th scope="col">数量 <span class="required">*</span></th>
              <th scope="col">单位</th>
              <th scope="col">启用</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="row in pageRows" :key="row.id"
              ><tr
                :data-testid="`material-row-${row.id}`"
                :class="{
                  'row-disabled': !row.enabled,
                  'row-error': errors[row.id],
                }"
              >
                <td class="row-number">{{ rows.indexOf(row) + 1 }}</td>
                <td>
                  <input
                    v-model="row.code"
                    class="text-input"
                    :aria-label="`第 ${rows.indexOf(row) + 1} 行物料编码`"
                    :data-testid="`row-code-${row.id}`"
                    placeholder="例如 MAT-003"
                  />
                </td>
                <td>
                  <input
                    v-model="row.name"
                    class="text-input"
                    :aria-label="`第 ${rows.indexOf(row) + 1} 行物料名称`"
                    :data-testid="`row-name-${row.id}`"
                    placeholder="输入物料名称"
                  />
                </td>
                <td>
                  <el-input-number
                    v-model="row.quantity"
                    :min="0.001"
                    :max="100000"
                    :precision="3"
                    :step="1"
                    :disabled="!row.enabled"
                    controls-position="right"
                    :aria-label="`第 ${rows.indexOf(row) + 1} 行数量`"
                    :data-testid="`row-quantity-${row.id}`"
                  />
                </td>
                <td>
                  <select
                    v-model="row.unit"
                    class="text-input"
                    :disabled="!row.enabled"
                    :aria-label="`第 ${rows.indexOf(row) + 1} 行单位`"
                  >
                    <option>kg</option>
                    <option>g</option>
                    <option>件</option>
                  </select>
                </td>
                <td>
                  <el-switch
                    v-model="row.enabled"
                    :aria-label="`启用第 ${rows.indexOf(row) + 1} 行`"
                    :data-testid="`row-enabled-${row.id}`"
                  />
                </td>
                <td>
                  <el-button
                    text
                    type="danger"
                    :disabled="rows.length <= 1"
                    :aria-label="`删除第 ${rows.indexOf(row) + 1} 行`"
                    :data-testid="`row-delete-${row.id}`"
                    @click="remove(row)"
                    >删除</el-button
                  >
                </td>
              </tr>
              <tr v-if="errors[row.id]" class="error-row">
                <td colspan="7" role="alert">
                  第 {{ rows.indexOf(row) + 1 }} 行：{{ errors[row.id] }}
                </td>
              </tr></template
            >
            <tr v-if="!filtered.length">
              <td colspan="7" class="empty-table">
                没有匹配的明细，清空搜索后重试
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="pagination-row">
        <span>共 {{ filtered.length }} 条匹配结果 · 每页 5 条</span
        ><el-pagination
          v-model:current-page="page"
          :page-size="5"
          :total="filtered.length"
          layout="prev, pager, next"
        />
      </div>
      <template #footer
        ><span class="footer-hint">至少保留 1 行 · 编码不允许重复</span>
        <div class="button-group">
          <el-button @click="restore">恢复已保存</el-button
          ><el-button type="primary" data-testid="table-save" @click="submit"
            >保存明细</el-button
          >
        </div></template
      ></Panel
    >
    <div class="table-bottom-grid">
      <RulePanel
        :rules="[
          '新增后填写编码和名称，数量须大于 0。',
          '复制相同编码到两行，保存时应提示重复。',
          '删除需要二次确认，取消不改变草稿。',
          '搜索和分页不改变其他行的数据；保存会校验全部行。',
        ]"
      /><ResultPanel section="rows" :entries="result" />
    </div>
  </div>
</template>
