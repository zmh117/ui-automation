export interface BasicConfig {
  name: string;
  freeText: string;
  count: string;
  weight: string;
  note: string;
}
export interface LinkConfig {
  a: boolean;
  b: boolean;
  c: boolean;
  d: boolean;
  mode: "system" | "manual";
  manual: string;
  advanced: boolean;
  reason: string;
}
export interface ControlConfig {
  name: string;
  source: "fixed" | "variable";
  fixed: string;
  variableId: string;
  precision: number;
  unit: string;
  required: boolean;
  remark: string;
}
export interface FileMeta {
  name: string;
  size: number;
  type: string;
}
export interface ExtendedConfig {
  workshop: string[];
  priority: string;
  tags: string[];
  dates: string[];
  time: string;
  dateTime: string;
  threshold: number;
  enabled: boolean;
  color: string;
  file: FileMeta | null;
}
export interface MaterialRow {
  id: string;
  code: string;
  name: string;
  quantity: number;
  unit: string;
  enabled: boolean;
}
export interface LabData {
  basic: BasicConfig;
  linkage: LinkConfig;
  dialog: ControlConfig;
  extended: ExtendedConfig;
  rows: MaterialRow[];
}
export type Section = keyof LabData;
export const variables = [
  {
    id: "V-001",
    name: "目标净重",
    precision: 3,
    unit: "kg",
    description: "称重目标参考值",
  },
  {
    id: "V-002",
    name: "实际净重",
    precision: 2,
    unit: "kg",
    description: "称重执行结果",
  },
  {
    id: "V-003",
    name: "生产数量",
    precision: 0,
    unit: "件",
    description: "整数数量",
  },
  {
    id: "V-004",
    name: "温度读数",
    precision: 1,
    unit: "°C",
    description: "温度采集示例",
  },
  {
    id: "V-005",
    name: "无单位数值",
    precision: 2,
    unit: "",
    description: "无单位显示场景",
  },
  {
    id: "V-006",
    name: "合格计数",
    precision: 0,
    unit: "",
    description: "零精度、无单位",
  },
  {
    id: "V-007",
    name: "投料比例",
    precision: 3,
    unit: "%",
    description: "比例输入示例",
  },
  {
    id: "V-008",
    name: "容器皮重",
    precision: 3,
    unit: "g",
    description: "容器称重示例",
  },
];
export function defaults(): LabData {
  return {
    basic: { name: "", freeText: "", count: "", weight: "", note: "" },
    linkage: {
      a: false,
      b: false,
      c: false,
      d: false,
      mode: "system",
      manual: "",
      advanced: false,
      reason: "",
    },
    dialog: {
      name: "净重采集控件",
      source: "fixed",
      fixed: "10.000",
      variableId: "",
      precision: 3,
      unit: "kg",
      required: true,
      remark: "",
    },
    extended: {
      workshop: [],
      priority: "normal",
      tags: [],
      dates: [],
      time: "",
      dateTime: "",
      threshold: 60,
      enabled: true,
      color: "#13665d",
      file: null,
    },
    rows: [
      {
        id: "row-001",
        code: "MAT-001",
        name: "原料 A",
        quantity: 10,
        unit: "kg",
        enabled: true,
      },
      {
        id: "row-002",
        code: "MAT-002",
        name: "辅料 B",
        quantity: 5,
        unit: "g",
        enabled: true,
      },
    ],
  };
}
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
export function charCount(value: string): number {
  return Array.from(value).length;
}
export function limitChars(value: string, max = 100): string {
  return Array.from(value).slice(0, max).join("");
}
export function validNumber(value: string, max: number, decimals = 0): boolean {
  const pattern =
    decimals === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`);
  return pattern.test(value) && Number(value) >= 0 && Number(value) <= max;
}
export function validLocalDateTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match
    .slice(1)
    .map(Number) as [number, number, number, number, number, number];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= days[month - 1]! &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59
  );
}
// Validate persisted data before rendering it. No values from localStorage are trusted as typed data.
export function validData(value: unknown): value is LabData {
  if (!value || typeof value !== "object") return false;
  const d = value as LabData;
  const strings = (o: unknown, keys: string[]) =>
    !!o &&
    typeof o === "object" &&
    keys.every((k) => typeof (o as Record<string, unknown>)[k] === "string");
  const bools = (o: unknown, keys: string[]) =>
    !!o &&
    typeof o === "object" &&
    keys.every((k) => typeof (o as Record<string, unknown>)[k] === "boolean");
  const stringArray = (a: unknown) =>
    Array.isArray(a) && a.every((v) => typeof v === "string");
  if (
    !strings(d.basic, ["name", "freeText", "count", "weight", "note"]) ||
    charCount(d.basic.note) > 100
  )
    return false;
  if (
    (d.basic.count && !validNumber(d.basic.count, 9999)) ||
    (d.basic.weight && !validNumber(d.basic.weight, 100000, 3))
  )
    return false;
  if (
    !strings(d.linkage, ["mode", "manual", "reason"]) ||
    !bools(d.linkage, ["a", "b", "c", "d", "advanced"])
  )
    return false;
  if (
    !["system", "manual"].includes(d.linkage.mode) ||
    (d.linkage.a && d.linkage.b) ||
    (d.linkage.c && !d.linkage.d)
  )
    return false;
  if (
    !strings(d.dialog, [
      "name",
      "source",
      "fixed",
      "variableId",
      "unit",
      "remark",
    ]) ||
    !bools(d.dialog, ["required"])
  )
    return false;
  if (
    !["fixed", "variable"].includes(d.dialog.source) ||
    !Number.isInteger(d.dialog.precision) ||
    d.dialog.precision < 0 ||
    d.dialog.precision > 3
  )
    return false;
  if (
    !["", "kg", "g", "件"].includes(d.dialog.unit) ||
    charCount(d.dialog.remark) > 100
  )
    return false;
  if (
    d.dialog.variableId &&
    !variables.some((v) => v.id === d.dialog.variableId)
  )
    return false;
  if (
    d.dialog.source === "variable"
      ? !d.dialog.variableId
      : !validNumber(d.dialog.fixed, 100000, 3)
  )
    return false;
  if (
    !strings(d.extended, ["priority", "time", "dateTime", "color"]) ||
    !bools(d.extended, ["enabled"])
  )
    return false;
  if (
    !stringArray(d.extended.workshop) ||
    !stringArray(d.extended.tags) ||
    !stringArray(d.extended.dates)
  )
    return false;
  if (
    !["normal", "high", "urgent"].includes(d.extended.priority) ||
    !d.extended.tags.every((t) => ["称重", "复核", "记录", "签名"].includes(t))
  )
    return false;
  if (
    d.extended.workshop.length &&
    !["workshop-a/line-1", "workshop-a/line-2", "workshop-b/line-3"].includes(
      d.extended.workshop.join("/"),
    )
  )
    return false;
  if (
    d.extended.dates.length &&
    (d.extended.dates.length !== 2 ||
      !d.extended.dates.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v)) ||
      d.extended.dates[0]! > d.extended.dates[1]!)
  )
    return false;
  if (
    (d.extended.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.extended.time)) ||
    (d.extended.dateTime && !validLocalDateTime(d.extended.dateTime)) ||
    !/^#[\da-f]{6}$/i.test(d.extended.color)
  )
    return false;
  if (
    !Number.isFinite(d.extended.threshold) ||
    d.extended.threshold < 0 ||
    d.extended.threshold > 100
  )
    return false;
  const file = d.extended.file;
  if (
    file !== null &&
    (!strings(file, ["name", "type"]) ||
      !Number.isFinite(file.size) ||
      file.size < 0 ||
      file.size > 2 * 1024 * 1024)
  )
    return false;
  if (!Array.isArray(d.rows) || d.rows.length < 1 || d.rows.length > 20)
    return false;
  if (
    !d.rows.every(
      (r) =>
        strings(r, ["id", "code", "name", "unit"]) &&
        bools(r, ["enabled"]) &&
        Number.isFinite(r.quantity) &&
        r.quantity > 0 &&
        r.quantity <= 100000 &&
        ["kg", "g", "件"].includes(r.unit),
    )
  )
    return false;
  if (new Set(d.rows.map((r) => r.id)).size !== d.rows.length) return false;
  return true;
}
