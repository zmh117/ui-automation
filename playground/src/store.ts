import { ref } from "vue";
import { ElMessage } from "element-plus";
import { clone, defaults, validData } from "./model";
import type { LabData, Section } from "./model";
export const STORAGE_KEY = "mes-interaction-lab:v1";
export const storageWarning = ref("");
export const savedAt = ref<Partial<Record<Section, string>>>({});
function load(): LabData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw);
    // Add the new optional field in memory; do not overwrite an older stored snapshot on read.
    if (
      parsed?.version === 1 &&
      parsed.data?.extended &&
      typeof parsed.data.extended === "object" &&
      !Array.isArray(parsed.data.extended) &&
      !Object.hasOwn(parsed.data.extended, "dateTime")
    ) {
      parsed.data.extended.dateTime = "";
    }
    if (parsed?.version !== 1 || !validData(parsed.data))
      throw new Error("invalid snapshot");
    if (parsed.savedAt && typeof parsed.savedAt === "object") {
      for (const key of Object.keys(defaults()) as Section[]) {
        if (
          typeof parsed.savedAt[key] === "string" &&
          !Number.isNaN(Date.parse(parsed.savedAt[key]))
        )
          savedAt.value[key] = parsed.savedAt[key];
      }
    }
    return clone(parsed.data);
  } catch {
    storageWarning.value =
      "本地数据无法读取或格式不正确，已加载默认草稿。原记录尚未覆盖，可确认重置后重新开始。";
    return defaults();
  }
}
export const saved = ref<LabData>(load());
export const resetEpoch = ref(0);
export function saveSection<K extends Section>(
  key: K,
  data: LabData[K],
): boolean {
  const next = clone(saved.value);
  next[key] = clone(data);
  if (!validData(next)) {
    ElMessage.error("配置格式不合法，请检查输入后再保存。");
    return false;
  }
  const times = { ...savedAt.value, [key]: new Date().toISOString() };
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, data: next, savedAt: times }),
    );
  } catch {
    storageWarning.value =
      "浏览器本地存储写入失败，配置未保存。请检查存储权限或剩余空间。";
    ElMessage.error("保存失败，草稿已保留。");
    return false;
  }
  saved.value = next;
  savedAt.value = times;
  storageWarning.value = "";
  ElMessage.success("配置已保存到此浏览器");
  return true;
}
export function resetAll(): boolean {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    ElMessage.error("本地数据无法清除，重置未执行。");
    return false;
  }
  saved.value = defaults();
  savedAt.value = {};
  storageWarning.value = "";
  resetEpoch.value++;
  ElMessage.success("全部示例已恢复初始状态");
  return true;
}
