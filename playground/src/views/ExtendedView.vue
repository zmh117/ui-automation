<script setup lang="ts">
import { computed, ref } from "vue";
import Panel from "../components/Panel.vue";
import RulePanel from "../components/RulePanel.vue";
import ResultPanel from "../components/ResultPanel.vue";
import { clone } from "../model";
import { saved, saveSection } from "../store";
const form = ref(clone(saved.value.extended));
const fileError = ref(""),
  fileInput = ref<HTMLInputElement>();
const options = [
  {
    value: "workshop-a",
    label: "一号车间",
    children: [
      { value: "line-1", label: "配料产线" },
      { value: "line-2", label: "包装产线" },
    ],
  },
  {
    value: "workshop-b",
    label: "二号车间",
    children: [{ value: "line-3", label: "灌装产线" }],
  },
];
const names: Record<string, string> = {
  "workshop-a": "一号车间",
  "workshop-b": "二号车间",
  "line-1": "配料产线",
  "line-2": "包装产线",
  "line-3": "灌装产线",
};
const result = computed<[string, string][]>(() => [
  [
    "处理优先级",
    { normal: "常规处理", high: "优先处理", urgent: "紧急处理" }[
      saved.value.extended.priority as "normal" | "high" | "urgent"
    ],
  ],
  ["所属产线", saved.value.extended.workshop.map((v) => names[v]).join(" / ")],
  ["功能标签", saved.value.extended.tags.join("、")],
  ["有效日期", saved.value.extended.dates.join(" 至 ")],
  ["提醒时间", saved.value.extended.time],
  ["计划执行时间", saved.value.extended.dateTime],
  [
    "告警阈值",
    saved.value.extended.enabled
      ? `${saved.value.extended.threshold}%`
      : "未启用",
  ],
  ["附件记录", saved.value.extended.file?.name || "无"],
]);
function fileChange(e: Event) {
  const el = e.target as HTMLInputElement,
    file = el.files?.[0];
  if (!file) return;
  if (!/\.(txt|csv|json|png|jpe?g)$/i.test(file.name)) {
    fileError.value = "仅支持 TXT、CSV、JSON、PNG、JPG 文件。";
    el.value = "";
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    fileError.value = "文件不能超过 2 MB。";
    el.value = "";
    return;
  }
  fileError.value = "";
  form.value.file = { name: file.name, size: file.size, type: file.type };
}
function removeFile() {
  form.value.file = null;
  fileError.value = "";
  if (fileInput.value) fileInput.value.value = "";
}
function restore() {
  form.value = clone(saved.value.extended);
  fileError.value = "";
  if (fileInput.value) fileInput.value.value = "";
}
</script>
<template>
  <div class="content-grid">
    <div class="primary-column">
      <form @submit.prevent="saveSection('extended', form)">
        <Panel
          number="01"
          title="选择与时间"
          subtitle="展开选择器，尝试搜索、多选、清空和级联。"
          ><div class="form-grid">
            <div class="field">
              <label for="priority">处理优先级 · 下拉单选</label
              ><el-select
                id="priority"
                v-model="form.priority"
                aria-label="处理优先级"
                data-testid="priority-select"
                ><el-option label="常规处理" value="normal" /><el-option
                  label="优先处理"
                  value="high" /><el-option label="紧急处理" value="urgent"
              /></el-select>
              <p class="field-hint">每次只能选择一项，重新选择会替换原值。</p>
            </div>
            <div class="field">
              <label for="workshop">所属车间 / 产线</label
              ><el-cascader
                id="workshop"
                :model-value="form.workshop"
                :options="options"
                clearable
                placeholder="选择车间后选择产线"
                aria-label="所属车间和产线"
                data-testid="workshop-cascader"
                @update:model-value="form.workshop = ($event || []) as string[]"
              />
            </div>
            <div class="field full">
              <label for="feature-tags">功能标签 · 下拉勾选多选</label
              ><el-select
                id="feature-tags"
                v-model="form.tags"
                multiple
                filterable
                clearable
                placeholder="可搜索并选择多个标签"
                aria-label="功能标签"
                data-testid="feature-tags"
                popper-class="feature-tags-dropdown"
                ><el-option
                  v-for="tag in ['称重', '复核', '记录', '签名']"
                  :key="tag"
                  :label="tag"
                  :value="tag"
                  :data-testid="`feature-option-${tag}`"
                  ><span class="check-option-content"
                    ><span
                      class="option-checkbox"
                      :class="{ checked: form.tags.includes(tag) }"
                      aria-hidden="true"
                    /><span>{{ tag }}</span></span
                  ></el-option
                >
              </el-select>
              <p class="field-hint">
                <span data-testid="feature-tags-count" aria-live="polite"
                  >已选 {{ form.tags.length }} 项。</span
                >点击方框或选项文字勾选，再次点击取消；支持搜索、清空和逐个移除。
              </p>
            </div>
            <div class="field full">
              <label>有效日期区间</label
              ><el-date-picker
                :model-value="form.dates"
                type="daterange"
                range-separator="至"
                start-placeholder="开始日期"
                end-placeholder="结束日期"
                value-format="YYYY-MM-DD"
                format="YYYY-MM-DD"
                data-testid="date-range"
                @update:model-value="form.dates = $event || []"
              />
            </div>
            <div class="field">
              <label for="reminder-time">提醒时间</label
              ><el-time-picker
                id="reminder-time"
                :model-value="form.time"
                placeholder="选择提醒时间"
                format="HH:mm"
                value-format="HH:mm"
                aria-label="提醒时间"
                data-testid="reminder-time"
                @update:model-value="form.time = $event || ''"
              />
            </div>
            <div class="field">
              <label for="mark-color">标记颜色</label>
              <div class="color-field">
                <input
                  id="mark-color"
                  v-model="form.color"
                  type="color"
                  data-testid="mark-color"
                /><span>{{ form.color }}</span>
              </div>
            </div>
            <div class="field full">
              <label for="planned-datetime">计划执行时间 · 日期时间选择</label>
              <el-date-picker
                id="planned-datetime"
                :model-value="form.dateTime"
                type="datetime"
                format="YYYY-MM-DD HH:mm:ss"
                value-format="YYYY-MM-DD HH:mm:ss"
                placeholder="选择或输入日期和时间"
                aria-label="计划执行时间"
                data-testid="planned-datetime"
                popper-class="planned-datetime-dropdown"
                clearable
                editable
                @update:model-value="form.dateTime = $event || ''"
              />
              <p class="field-hint">
                可选。支持日历与时分秒选择，或输入 YYYY-MM-DD
                HH:mm:ss；按本地时间保存，不做时区换算。
              </p>
            </div>
          </div></Panel
        >
        <Panel
          number="02"
          title="阈值与附件"
          subtitle="练习滑块、开关、文件选择和大小限制。"
          ><div class="switch-row">
            <div>
              <label for="alarm-enabled" class="standalone-label"
                >启用阈值告警</label
              >
              <p class="field-hint">关闭后阈值滑块和数值输入框均禁用</p>
            </div>
            <el-switch
              id="alarm-enabled"
              v-model="form.enabled"
              aria-label="启用阈值告警"
              data-testid="alarm-enabled"
            />
          </div>
          <div class="field space-top">
            <label
              >告警阈值
              <span class="field-unit">{{ form.threshold }}%</span></label
            ><el-slider
              v-model="form.threshold"
              :disabled="!form.enabled"
              :min="0"
              :max="100"
              :step="5"
              show-input
              aria-label="告警阈值"
              data-testid="threshold-slider"
            />
            <p class="field-hint">范围 0–100，步长 5；输入框与滑块同步。</p>
          </div>
          <div class="group-divider" />
          <div class="field">
            <label for="attachment">配置附件</label>
            <div class="upload-zone">
              <input
                id="attachment"
                ref="fileInput"
                type="file"
                accept=".txt,.csv,.json,.png,.jpg,.jpeg"
                data-testid="attachment"
                @change="fileChange"
              />
              <p>TXT / CSV / JSON / PNG / JPG，单个文件不超过 2 MB</p>
            </div>
            <p v-if="fileError" class="field-error" role="alert">
              {{ fileError }}
            </p>
            <div v-if="form.file" class="file-record">
              <div>
                <strong>{{ form.file.name }}</strong
                ><small
                  >{{ (form.file.size / 1024).toFixed(1) }} KB ·
                  仅记录文件信息</small
                >
              </div>
              <el-button
                text
                type="danger"
                data-testid="remove-attachment"
                @click="removeFile"
                >移除</el-button
              >
            </div>
            <p class="field-hint">
              本练习站不上传文件内容；刷新后仅保留文件名、大小和类型。
            </p>
          </div>
          <template #footer
            ><span class="footer-hint">选择内容可以清空后重新配置</span>
            <div class="button-group">
              <el-button @click="restore">恢复已保存</el-button
              ><el-button
                type="primary"
                native-type="submit"
                data-testid="extended-save"
                >保存扩展配置</el-button
              >
            </div></template
          ></Panel
        >
      </form>
    </div>
    <aside class="secondary-column">
      <RulePanel
        :rules="[
          '优先级下拉一次选一项；标签下拉可连续勾选多项，选中后保持展开。',
          '搜索只过滤候选项，不取消已选项；再次点击选项可取消勾选。',
          '级联选择先选车间，再选择该车间下的产线。',
          '日期区间、提醒时间和计划执行时间分别保存；计划执行时间同时包含日期与时分秒。',
          '关闭告警后，阈值仍保留，但相关输入不可操作。',
          '文件类型或大小不符时提示错误，保留之前有效的文件记录。',
        ]"
      /><ResultPanel section="extended" :entries="result" />
    </aside>
  </div>
</template>
