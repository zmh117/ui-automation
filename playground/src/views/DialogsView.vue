<script setup lang="ts">
import { computed, onDeactivated, ref, watch } from "vue";
import Panel from "../components/Panel.vue";
import RulePanel from "../components/RulePanel.vue";
import ResultPanel from "../components/ResultPanel.vue";
import NumberInput from "../components/NumberInput.vue";
import Icon from "../components/Icon.vue";
import { clone, limitChars, charCount, validNumber, variables } from "../model";
import { saved, saveSection } from "../store";
const props = defineProps<{ navigationKey?: string }>();
const open = ref(false),
  pickerOpen = ref(false),
  tab = ref("basic");
onDeactivated(() => {
  pickerOpen.value = false;
  open.value = false;
});
watch(
  () => props.navigationKey,
  () => {
    pickerOpen.value = false;
    open.value = false;
  },
);
const draft = ref(clone(saved.value.dialog));
const errors = ref<Record<string, string>>({});
const query = ref(""),
  page = ref(1),
  pendingVariable = ref("");
const filtered = computed(() =>
  variables.filter((v) =>
    `${v.id} ${v.name} ${v.unit}`
      .toLowerCase()
      .includes(query.value.trim().toLowerCase()),
  ),
);
const visibleVariables = computed(() =>
  filtered.value.slice((page.value - 1) * 4, page.value * 4),
);
watch(query, () => (page.value = 1));
const draftVariable = computed(() =>
  variables.find((v) => v.id === draft.value.variableId),
);
const savedVariable = computed(() =>
  variables.find((v) => v.id === saved.value.dialog.variableId),
);
const result = computed<[string, string][]>(() => [
  ["控件名称", saved.value.dialog.name],
  ["数值来源", saved.value.dialog.source === "fixed" ? "固定值" : "绑定变量"],
  [
    "绑定变量",
    savedVariable.value
      ? `${savedVariable.value.id} · ${savedVariable.value.name}`
      : "未绑定",
  ],
  ["显示精度", `${saved.value.dialog.precision} 位小数`],
]);
function configure() {
  draft.value = clone(saved.value.dialog);
  errors.value = {};
  tab.value = "basic";
  pickerOpen.value = false;
  open.value = true;
}
function selectVariable() {
  pendingVariable.value = draft.value.variableId;
  query.value = "";
  page.value = 1;
  pickerOpen.value = true;
}
function confirmVariable() {
  if (!variables.some((v) => v.id === pendingVariable.value)) return;
  draft.value.variableId = pendingVariable.value;
  pickerOpen.value = false;
}
function noteInput(e: Event) {
  if ((e as InputEvent).isComposing) return;
  const el = e.target as HTMLTextAreaElement;
  draft.value.remark = limitChars(el.value);
  el.value = draft.value.remark;
}
function submit() {
  errors.value = {};
  if (!draft.value.name.trim()) errors.value.name = "请输入控件名称";
  if (
    draft.value.source === "fixed" &&
    !validNumber(draft.value.fixed, 100000, 3)
  )
    errors.value.fixed = "请输入 0–100000 的数值，最多 3 位小数";
  if (draft.value.source === "variable" && !draftVariable.value)
    errors.value.variable = "请选择一个变量";
  if (Object.keys(errors.value).length) {
    tab.value = "basic";
    return;
  }
  if (saveSection("dialog", draft.value)) open.value = false;
}
</script>
<template>
  <div class="content-grid">
    <div class="primary-column">
      <Panel
        number="01"
        title="控件配置"
        subtitle="打开弹框开始编辑；确认之前，下面的配置不会改变。"
        ><div class="control-preview">
          <div class="preview-icon"><Icon name="dialogs" :size="30" /></div>
          <div class="control-summary">
            <span class="mini-label">数值控件</span>
            <h3 data-testid="saved-control-name">{{ saved.dialog.name }}</h3>
            <p>
              {{
                saved.dialog.source === "fixed"
                  ? `固定值 ${saved.dialog.fixed}`
                  : `变量 ${savedVariable?.name || "未绑定"}`
              }}<span>·</span>{{ saved.dialog.precision }} 位小数<span>·</span
              >{{ saved.dialog.unit || "不显示单位" }}
            </p>
          </div>
          <el-button
            type="primary"
            data-testid="open-config-dialog"
            @click="configure"
            >配置控件 <Icon name="arrow" :size="16"
          /></el-button></div
      ></Panel>
      <Panel
        number="02"
        title="确认发生在哪一层？"
        subtitle="配置分三层传递，取消只丢弃当前层的修改。"
        ><div class="transaction-flow">
          <div>
            <span class="step-circle">1</span>
            <h3>变量选择</h3>
            <p>搜索、选择变量<br />确认后进入外层草稿</p>
          </div>
          <Icon name="arrow" />
          <div>
            <span class="step-circle">2</span>
            <h3>控件草稿</h3>
            <p>继续调整配置<br />取消即放弃全部修改</p>
          </div>
          <Icon name="arrow" />
          <div>
            <span class="step-circle">3</span>
            <h3>已保存配置</h3>
            <p>外层确认后保存<br />刷新后仍然保留</p>
          </div>
        </div>
        <div class="inline-note">
          可以试试：选新变量 → 内层确认 → 外层取消 → 重新打开配置。
        </div></Panel
      >
    </div>
    <aside class="secondary-column">
      <RulePanel
        :rules="[
          '弹框内改名或改值后取消，卡片应保持原配置。',
          '选择“绑定变量”，固定值输入框变灰，变量选择按钮启用。',
          '内层选中其他变量后取消，外层草稿保持原变量。',
          '内层确认不等于保存；外层确认才更新本地记录。',
        ]"
      /><ResultPanel section="dialog" :entries="result" />
    </aside>
  </div>
  <el-dialog
    v-model="open"
    title="控件设置"
    width="620px"
    :close-on-click-modal="false"
    :close-on-press-escape="!pickerOpen"
    destroy-on-close
    data-testid="control-dialog"
  >
    <div class="dialog-intro">
      <span class="step-pill">第一层 · 配置草稿</span
      ><span>确认后才会保存</span>
    </div>
    <el-tabs v-model="tab"
      ><el-tab-pane label="基本配置" name="basic"
        ><div class="field">
          <label for="dialog-name"
            >控件名称 <span class="required">*</span></label
          ><input
            id="dialog-name"
            v-model="draft.name"
            class="text-input"
            data-testid="dialog-name"
          />
          <p v-if="errors.name" class="field-error" role="alert">
            {{ errors.name }}
          </p>
        </div>
        <div class="field space-top">
          <label>数值来源</label>
          <div class="radio-row" role="radiogroup" aria-label="控件数值来源">
            <label class="radio-choice"
              ><input
                v-model="draft.source"
                type="radio"
                name="dialog-source"
                value="fixed"
                data-testid="dialog-source-fixed"
              />固定值</label
            ><label class="radio-choice"
              ><input
                v-model="draft.source"
                type="radio"
                name="dialog-source"
                value="variable"
                data-testid="dialog-source-variable"
              />绑定变量</label
            >
          </div>
        </div>
        <div class="field space-top">
          <label for="dialog-fixed"
            >固定值
            <span v-if="draft.source === 'fixed'" class="required"
              >*</span
            ></label
          ><NumberInput
            id="dialog-fixed"
            v-model="draft.fixed"
            :decimals="3"
            :disabled="draft.source !== 'fixed'"
            placeholder="请输入非负数值"
          />
          <p v-if="errors.fixed" class="field-error" role="alert">
            {{ errors.fixed }}
          </p>
        </div>
        <div class="field space-top">
          <label for="bound-variable"
            >绑定变量
            <span v-if="draft.source === 'variable'" class="required"
              >*</span
            ></label
          >
          <div class="input-with-action">
            <input
              id="bound-variable"
              class="text-input"
              readonly
              :disabled="draft.source !== 'variable'"
              :value="
                draftVariable
                  ? `${draftVariable.id} · ${draftVariable.name}`
                  : ''
              "
              placeholder="点击右侧按钮选择变量"
              data-testid="bound-variable"
            /><el-button
              :disabled="draft.source !== 'variable'"
              data-testid="choose-variable"
              @click="selectVariable"
              >选择变量</el-button
            >
          </div>
          <p v-if="errors.variable" class="field-error" role="alert">
            {{ errors.variable }}
          </p>
        </div></el-tab-pane
      >
      <el-tab-pane label="显示与校验" name="display"
        ><div class="form-grid">
          <div class="field">
            <label for="display-precision">显示精度</label
            ><el-select
              id="display-precision"
              v-model="draft.precision"
              aria-label="显示精度"
              data-testid="display-precision"
              ><el-option
                v-for="n in [0, 1, 2, 3]"
                :key="n"
                :label="`${n} 位小数`"
                :value="n"
            /></el-select>
          </div>
          <div class="field">
            <label for="display-unit">显示单位</label
            ><el-select
              id="display-unit"
              v-model="draft.unit"
              aria-label="显示单位"
              ><el-option label="无单位" value="" /><el-option
                v-for="unit in ['kg', 'g', '件']"
                :key="unit"
                :label="unit"
                :value="unit"
            /></el-select>
          </div>
        </div>
        <label class="simple-check space-top"
          ><input
            v-model="draft.required"
            type="checkbox"
            data-testid="dialog-required"
          />执行时必填</label
        >
        <div class="field space-top">
          <label for="dialog-remark">配置说明</label>
          <div class="textarea-wrap">
            <textarea
              id="dialog-remark"
              :value="draft.remark"
              rows="3"
              placeholder="最多 100 字符"
              @input="noteInput"
              @compositionend="noteInput"
            /><span class="character-count"
              >{{ charCount(draft.remark) }} / 100</span
            >
          </div>
        </div></el-tab-pane
      ></el-tabs
    >
    <template #footer
      ><el-button data-testid="dialog-cancel" @click="open = false"
        >取消</el-button
      ><el-button type="primary" data-testid="dialog-confirm" @click="submit"
        >确认并保存</el-button
      ></template
    >
  </el-dialog>
  <el-dialog
    v-model="pickerOpen"
    title="选择数值变量"
    width="640px"
    append-to-body
    :close-on-click-modal="false"
    destroy-on-close
    data-testid="variable-dialog"
    ><div class="dialog-intro">
      <span class="step-pill">第二层 · 变量选择</span
      ><span>只更新外层草稿</span>
    </div>
    <div class="field">
      <label for="variable-search">搜索变量</label
      ><input
        id="variable-search"
        v-model="query"
        class="text-input"
        placeholder="搜索变量名称、编码或单位"
        data-testid="variable-search"
      />
    </div>
    <div class="table-scroll space-top">
      <table class="data-table variable-table">
        <thead>
          <tr>
            <th scope="col">选择</th>
            <th scope="col">变量名称</th>
            <th scope="col">精度</th>
            <th scope="col">单位</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="v in visibleVariables"
            :key="v.id"
            :class="{ chosen: pendingVariable === v.id }"
            :data-testid="`variable-row-${v.id}`"
          >
            <td>
              <input
                v-model="pendingVariable"
                type="radio"
                name="variable-choice"
                :value="v.id"
                :aria-label="`选择 ${v.id} ${v.name}`"
                :data-testid="`select-${v.id}`"
              />
            </td>
            <td>
              <strong>{{ v.name }}</strong
              ><small>{{ v.id }} · {{ v.description }}</small>
            </td>
            <td>{{ v.precision }} 位</td>
            <td>{{ v.unit || "无单位" }}</td>
          </tr>
          <tr v-if="!filtered.length">
            <td colspan="4" class="empty-table">
              没有匹配的变量，换个关键词试试
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="pagination-row">
      <span>共 {{ filtered.length }} 个变量</span
      ><el-pagination
        v-model:current-page="page"
        :page-size="4"
        :total="filtered.length"
        layout="prev, pager, next"
      />
    </div>
    <template #footer
      ><el-button data-testid="variable-cancel" @click="pickerOpen = false"
        >取消</el-button
      ><el-button
        type="primary"
        :disabled="!pendingVariable"
        data-testid="variable-confirm"
        @click="confirmVariable"
        >确认选择</el-button
      ></template
    ></el-dialog
  >
</template>
