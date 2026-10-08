<script setup lang="ts">
import { computed, ref } from "vue";
import Panel from "../components/Panel.vue";
import RulePanel from "../components/RulePanel.vue";
import ResultPanel from "../components/ResultPanel.vue";
import NumberInput from "../components/NumberInput.vue";
import { charCount, clone, limitChars, validNumber } from "../model";
import { saved, saveSection } from "../store";
const form = ref(clone(saved.value.basic));
const errors = ref<Record<string, string>>({});
const dirty = computed(
  () => JSON.stringify(form.value) !== JSON.stringify(saved.value.basic),
);
const result = computed<[string, string][]>(() => [
  ["配置名称", saved.value.basic.name],
  ["整数数量", saved.value.basic.count],
  [
    "小数重量",
    saved.value.basic.weight ? `${saved.value.basic.weight} kg` : "",
  ],
  ["备注字符", `${charCount(saved.value.basic.note)} / 100`],
]);
function noteInput(e: Event) {
  if ((e as InputEvent).isComposing) return;
  const target = e.target as HTMLTextAreaElement;
  form.value.note = limitChars(target.value);
  target.value = form.value.note;
}
function restore() {
  form.value = clone(saved.value.basic);
  errors.value = {};
}
function submit() {
  errors.value = {};
  if (!form.value.name.trim()) errors.value.name = "请输入配置名称";
  if (!validNumber(form.value.count, 9999))
    errors.value.count = "请输入 0–9999 的整数";
  if (!validNumber(form.value.weight, 100000, 3))
    errors.value.weight = "请输入 0–100000 的数字，最多 3 位小数";
  if (Object.keys(errors.value).length) return;
  saveSection("basic", form.value);
}
</script>
<template>
  <div class="content-grid">
    <div class="primary-column">
      <form novalidate @submit.prevent="submit">
        <Panel
          number="01"
          title="配置基本信息"
          subtitle="输入内容，试试不同格式与边界。"
          ><template #extra
            ><span :class="['draft-badge', { dirty }]">{{
              dirty ? "有未保存修改" : "当前无修改"
            }}</span></template
          >
          <div class="form-grid">
            <div class="field full">
              <label for="config-name"
                >配置名称 <span class="required">*</span></label
              ><input
                id="config-name"
                v-model="form.name"
                class="text-input"
                data-testid="config-name"
                placeholder="例如：一号产线称重配置"
                :aria-invalid="!!errors.name"
                :aria-describedby="errors.name ? 'name-error' : undefined"
              />
              <p
                v-if="errors.name"
                id="name-error"
                class="field-error"
                role="alert"
              >
                {{ errors.name }}
              </p>
            </div>
            <div class="field full">
              <label for="free-text"
                >自由文本 <span class="field-optional">不限格式</span></label
              ><input
                id="free-text"
                v-model="form.freeText"
                class="text-input"
                data-testid="free-text"
                placeholder="支持中文、英文、数字及特殊字符"
              />
              <p class="field-hint">自由输入，不限定字符格式或长度。</p>
            </div>
            <div class="field">
              <label for="integer-count"
                >整数数量 <span class="required">*</span></label
              ><NumberInput
                id="integer-count"
                v-model="form.count"
                placeholder="输入 0–9999"
              />
              <p class="field-hint">仅数字 · 非负整数 · 最大 9999</p>
              <p v-if="errors.count" class="field-error" role="alert">
                {{ errors.count }}
              </p>
            </div>
            <div class="field">
              <label for="decimal-weight"
                >小数重量 <span class="required">*</span
                ><span class="field-unit">kg</span></label
              ><NumberInput
                id="decimal-weight"
                v-model="form.weight"
                :decimals="3"
                placeholder="例如 12.345"
              />
              <p class="field-hint">0–100000 · 最多 3 位小数</p>
              <p v-if="errors.weight" class="field-error" role="alert">
                {{ errors.weight }}
              </p>
            </div>
            <div class="field full">
              <label for="limited-note"
                >配置备注 <span class="field-optional">可选</span></label
              >
              <div class="textarea-wrap">
                <textarea
                  id="limited-note"
                  :value="form.note"
                  data-testid="limited-note"
                  rows="4"
                  placeholder="输入补充说明，最多 100 个字符…"
                  @input="noteInput"
                  @compositionend="noteInput"
                /><span class="character-count" data-testid="note-count"
                  >{{ charCount(form.note) }} / 100</span
                >
              </div>
              <p class="field-hint">
                中文、英文、数字和表情均按 Unicode 码点计数。
              </p>
            </div>
          </div>
          <template #footer
            ><span class="footer-hint">标记 * 的内容为必填项</span>
            <div class="button-group">
              <el-button data-testid="basic-restore" @click="restore"
                >恢复已保存</el-button
              ><el-button
                type="primary"
                native-type="submit"
                data-testid="basic-save"
                >保存配置</el-button
              >
            </div></template
          ></Panel
        >
      </form>
      <Panel
        number="02"
        title="不可编辑状态"
        subtitle="只读与禁用是两种不同的交互状态。"
        ><div class="form-grid">
          <div class="field">
            <label for="readonly-code">只读编码</label
            ><input
              id="readonly-code"
              class="text-input"
              value="LAB-INPUT-001"
              readonly
              data-testid="readonly-code"
            />
            <p class="field-hint">可以聚焦和复制，不能修改。</p>
          </div>
          <div class="field">
            <label for="disabled-device">禁用设备</label
            ><input
              id="disabled-device"
              class="text-input"
              value="未启用设备采集"
              disabled
              data-testid="disabled-device"
            />
            <p class="field-hint">置灰且不可输入，也不参与保存。</p>
          </div>
        </div></Panel
      >
    </div>
    <aside class="secondary-column">
      <RulePanel
        :rules="[
          '在数字框中输入字母、负号或 e，观察输入拦截提示。',
          '备注达到 100 个字符后，再输入或粘贴内容。',
          '留空必填项保存，检查字段下方的错误反馈。',
          '保存成功后刷新，验证配置恢复；未保存修改不会持久化。',
        ]"
      /><ResultPanel section="basic" :entries="result" />
    </aside>
  </div>
</template>
