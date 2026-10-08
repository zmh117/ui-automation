<script setup lang="ts">
import { ref } from "vue";
const props = withDefaults(
  defineProps<{
    modelValue: string;
    id: string;
    decimals?: number;
    disabled?: boolean;
    placeholder?: string;
  }>(),
  { decimals: 0, disabled: false, placeholder: "" },
);
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const warning = ref("");
let composing = false;
function input(event: Event) {
  if (composing) return;
  const el = event.target as HTMLInputElement;
  const pattern = props.decimals
    ? new RegExp(`^\\d*(?:\\.\\d{0,${props.decimals}})?$`)
    : /^\d*$/;
  if (pattern.test(el.value)) {
    emit("update:modelValue", el.value);
    warning.value = "";
  } else {
    el.value = props.modelValue;
    warning.value = props.decimals
      ? `仅接受非负数字，最多 ${props.decimals} 位小数；不接受字母或指数格式。`
      : "仅接受 0–9 的非负整数，不接受字母、小数或指数格式。";
  }
}
function compositionEnd(event: CompositionEvent) {
  composing = false;
  input(event);
}
</script>
<template>
  <div class="number-input">
    <input
      :id="id"
      :data-testid="id"
      class="text-input"
      type="text"
      :inputmode="decimals ? 'decimal' : 'numeric'"
      :value="modelValue"
      :disabled="disabled"
      :placeholder="placeholder"
      :aria-describedby="warning ? `${id}-hint` : undefined"
      @input="input"
      @compositionstart="composing = true"
      @compositionend="compositionEnd"
    />
    <p v-if="warning" :id="`${id}-hint`" class="field-warning" role="status">
      {{ warning }}
    </p>
  </div>
</template>
