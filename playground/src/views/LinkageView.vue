<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Panel from "../components/Panel.vue";
import RulePanel from "../components/RulePanel.vue";
import ResultPanel from "../components/ResultPanel.vue";
import { clone } from "../model";
import { saved, saveSection } from "../store";
const form = ref(clone(saved.value.linkage));
const errors = ref<Record<string, string>>({});
watch(
  () => form.value.c,
  (value) => {
    if (value) form.value.d = true;
  },
  { flush: "sync" },
);
const effective = computed(() =>
  form.value.mode === "system" ? "系统标准值" : form.value.manual || "等待输入",
);
const result = computed<[string, string][]>(() => [
  [
    "选中选项",
    ["a", "b", "c", "d"]
      .filter((k) => saved.value.linkage[k as "a"])
      .map((k) => k.toUpperCase())
      .join("、") || "无",
  ],
  ["输入方式", saved.value.linkage.mode === "system" ? "系统默认" : "手动输入"],
  [
    "生效值",
    saved.value.linkage.mode === "system"
      ? "系统标准值"
      : saved.value.linkage.manual,
  ],
  ["高级配置", saved.value.linkage.advanced ? "已启用" : "未启用"],
]);
function submit() {
  errors.value = {};
  if (form.value.mode === "manual" && !form.value.manual.trim())
    errors.value.manual = "手动模式下请输入设定值";
  if (form.value.advanced && !form.value.reason.trim())
    errors.value.reason = "启用高级配置后，请填写启用原因";
  if (!Object.keys(errors.value).length) saveSection("linkage", form.value);
}
function restore() {
  form.value = clone(saved.value.linkage);
  errors.value = {};
}
</script>
<template>
  <div class="content-grid">
    <div class="primary-column">
      <Panel
        number="01"
        title="复选框之间的关系"
        subtitle="先选择一个选项，再观察相邻选项的可用状态。"
        ><div class="group-title">
          双向互斥 <span>同一时间只允许选择 A 或 B</span>
        </div>
        <div class="choice-grid">
          <label
            :class="['choice-card', { selected: form.a, disabled: form.b }]"
            ><input
              v-model="form.a"
              type="checkbox"
              :disabled="form.b"
              data-testid="checkbox-a"
            />
            <div>
              <strong>选项 A</strong>
              <p>选中后，选项 B 不可操作</p>
            </div>
            <span v-if="form.b" class="lock-label">已禁用</span></label
          >
          <label
            :class="['choice-card', { selected: form.b, disabled: form.a }]"
            ><input
              v-model="form.b"
              type="checkbox"
              :disabled="form.a"
              data-testid="checkbox-b"
            />
            <div>
              <strong>选项 B</strong>
              <p>选中后，选项 A 不可操作</p>
            </div>
            <span v-if="form.a" class="lock-label">已禁用</span></label
          >
        </div>
        <div class="group-divider" />
        <div class="group-title">必选依赖 <span>选 C 必须同时选 D</span></div>
        <div class="choice-grid">
          <label :class="['choice-card', { selected: form.c }]"
            ><input v-model="form.c" type="checkbox" data-testid="checkbox-c" />
            <div>
              <strong>选项 C</strong>
              <p>自动勾选并锁定选项 D</p>
            </div></label
          >
          <label
            :class="['choice-card', { selected: form.d, disabled: form.c }]"
            ><input
              v-model="form.d"
              type="checkbox"
              :disabled="form.c"
              data-testid="checkbox-d"
            />
            <div>
              <strong>选项 D</strong>
              <p>
                {{ form.c ? "由 C 要求，当前不可取消" : "可独立勾选或取消" }}
              </p>
            </div>
            <span v-if="form.c" class="lock-label">已锁定</span></label
          >
        </div>
        <div class="inline-note">
          取消 C 后，D 保留勾选并恢复可编辑。
        </div></Panel
      >
      <form novalidate @submit.prevent="submit">
        <Panel
          number="02"
          title="条件启用输入"
          subtitle="通过单选和开关，决定哪些字段需要填写。"
          ><div class="field">
            <label>设定值来源</label>
            <div class="radio-row" role="radiogroup" aria-label="设定值来源">
              <label class="radio-choice"
                ><input
                  v-model="form.mode"
                  type="radio"
                  name="input-source"
                  value="system"
                  data-testid="source-system"
                />系统默认</label
              ><label class="radio-choice"
                ><input
                  v-model="form.mode"
                  type="radio"
                  name="input-source"
                  value="manual"
                  data-testid="source-manual"
                />手动输入</label
              >
            </div>
          </div>
          <div class="field space-top">
            <label for="manual-value"
              >手动设定值
              <span v-if="form.mode === 'manual'" class="required"
                >*</span
              ></label
            ><input
              id="manual-value"
              v-model="form.manual"
              class="text-input"
              :disabled="form.mode !== 'manual'"
              placeholder="选择“手动输入”后即可编辑"
              data-testid="manual-value"
            />
            <p v-if="errors.manual" class="field-error" role="alert">
              {{ errors.manual }}
            </p>
            <div class="effective-value">
              当前生效值
              <strong data-testid="effective-value">{{ effective }}</strong>
            </div>
          </div>
          <div class="group-divider" />
          <div class="switch-row">
            <div>
              <label for="advanced-enabled" class="standalone-label"
                >启用高级配置</label
              >
              <p class="field-hint">开启后可填写必填的启用原因</p>
            </div>
            <el-switch
              id="advanced-enabled"
              v-model="form.advanced"
              aria-label="启用高级配置"
              data-testid="advanced-enabled"
            />
          </div>
          <div class="field space-top">
            <label for="advanced-reason"
              >启用原因
              <span v-if="form.advanced" class="required">*</span></label
            ><textarea
              id="advanced-reason"
              v-model="form.reason"
              rows="3"
              :disabled="!form.advanced"
              placeholder="高级配置关闭时，此字段不可编辑"
              data-testid="advanced-reason"
            />
            <p v-if="errors.reason" class="field-error" role="alert">
              {{ errors.reason }}
            </p>
          </div>
          <template #footer
            ><span class="footer-hint">禁用时保留草稿，不作为当前生效值</span>
            <div class="button-group">
              <el-button @click="restore">恢复已保存</el-button
              ><el-button
                type="primary"
                native-type="submit"
                data-testid="linkage-save"
                >保存联动配置</el-button
              >
            </div></template
          ></Panel
        >
      </form>
    </div>
    <aside class="secondary-column">
      <RulePanel
        :rules="[
          'A、B 双向互斥。取消当前选择后，另一项恢复可用。',
          '选中 C 自动勾选 D，D 置灰；取消 C 不自动取消 D。',
          '只有手动模式能编辑设定值；切回系统模式会保留输入草稿。',
          '高级配置打开时，启用原因为必填。',
        ]"
      /><ResultPanel section="linkage" :entries="result" />
    </aside>
  </div>
</template>
