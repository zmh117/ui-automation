<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 20 });
const paths: Record<string, string> = {
  inputs: "M4 5h16v14H4z M8 9h8 M8 13h5",
  linkage:
    "M8 6h8 M8 18h8 M6 8v8 M18 8v8 M4 4h4v4H4z M16 4h4v4h-4z M4 16h4v4H4z M16 16h4v4h-4z",
  dialogs: "M3 4h14v12H3z M7 8h14v12H7z M11 12h6 M11 16h3",
  extended: "M4 7h16 M4 17h16 M8 4v6 M16 14v6",
  table: "M3 4h18v16H3z M3 10h18 M9 4v16 M15 10v10",
  all: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  reset: "M4 10a8 8 0 1 1 1 8 M4 4v6h6",
  arrow: "M5 12h14 M14 7l5 5-5 5",
  check: "M5 12l4 4L19 6",
};
</script>
<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.65"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.inputs" />
  </svg>
</template>
