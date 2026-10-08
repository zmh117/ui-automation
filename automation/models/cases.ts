import {
  createEnumeration,
  type JsonValue,
  type Rule,
} from "@mes-ui/config-enumerator";

export const version = "2026-10-07.1";
export const bool = [false, true];
export const weights = [
  "",
  "0",
  "0.001",
  "1.234",
  "100000",
  "100000.001",
  "1.",
];
export const goodWeights = ["0", "0.001", "1.234", "100000"];
export const badDecimals = ["-0.1", "1.2345", "1e3", "abc", "１２.３", "+1"];
export const notes = [
  "",
  "a".repeat(99),
  "a".repeat(100),
  "a".repeat(101),
  "中😀".repeat(50),
  "中😀".repeat(50) + "尾",
];
export const tags = ["称重", "复核", "记录", "签名"];
export const subsets = Array.from({ length: 16 }, (_, mask) =>
  tags.filter((_, i) => mask & (1 << i)),
);
export const inSet = (
  id: string,
  field: string,
  values: JsonValue[],
): Rule => ({
  id,
  message: id,
  assert: values.length
    ? { op: "in", field, values }
    : {
        op: "all",
        conditions: [
          { op: "eq", field, value: null },
          { op: "neq", field, value: null },
        ],
      },
});
export function group(
  id: string,
  fields: Record<string, JsonValue[]>,
  rules: Rule[] = [],
) {
  return [
    ...createEnumeration({
      id,
      version,
      fields: Object.entries(fields).map(([id, values]) => ({ id, values })),
      rules,
    }).cases,
  ];
}
export const required = group(
  "basic.required",
  {
    name: ["", "   ", "UI配置"],
    count: ["", "0", "1", "9999", "10000"],
    weight: weights,
  },
  [
    inSet("name.required", "name", ["UI配置"]),
    inSet("count.range", "count", ["0", "1", "9999"]),
    inSet("weight.range", "weight", goodWeights),
  ],
);
export const abcd = group(
  "linkage.abcd",
  { a: bool, b: bool, c: bool, d: bool },
  [
    {
      id: "ab.mutex",
      message: "A/B 互斥",
      when: { op: "eq", field: "a", value: true },
      assert: { op: "eq", field: "b", value: false },
    },
    {
      id: "cd.dependency",
      message: "C 必须选 D",
      when: { op: "eq", field: "c", value: true },
      assert: { op: "eq", field: "d", value: true },
    },
  ],
);
export const conditional = group(
  "linkage.conditional",
  {
    mode: ["system", "manual"],
    manual: ["", "   ", "37"],
    advanced: bool,
    reason: ["", "   ", "调试验证"],
  },
  [
    {
      id: "manual.required",
      message: "手动值必填",
      when: { op: "eq", field: "mode", value: "manual" },
      assert: { op: "eq", field: "manual", value: "37" },
    },
    {
      id: "reason.required",
      message: "高级原因必填",
      when: { op: "eq", field: "advanced", value: true },
      assert: { op: "eq", field: "reason", value: "调试验证" },
    },
  ],
);
export const display = group(
  "dialogs.display",
  {
    source: [
      "fixed",
      "none",
      ...Array.from({ length: 8 }, (_, i) => `V-00${i + 1}`),
    ],
    precision: [0, 1, 2, 3],
    unit: ["", "kg", "g", "件"],
    required: bool,
  },
  [
    {
      id: "variable.required",
      message: "必须选择变量",
      assert: { op: "neq", field: "source", value: "none" },
    },
  ],
);
export const selections = group("extended.selections", {
  priority: ["normal", "high", "urgent"],
  workshop: [
    [],
    ["workshop-a", "line-1"],
    ["workshop-a", "line-2"],
    ["workshop-b", "line-3"],
  ],
  tags: subsets,
});
export const thresholds = group("extended.threshold", {
  enabled: bool,
  threshold: Array.from({ length: 21 }, (_, i) => i * 5),
});
export const rowCases = group(
  "table.row",
  {
    code: ["", "   ", "MAT-010", "  MAT-010  "],
    name: ["", "   ", "物料 X"],
    quantity: [0.001, 1, 1.234, 99999.999, 100000],
    unit: ["kg", "g", "件"],
    enabled: bool,
  },
  [
    inSet("code.required", "code", ["MAT-010", "  MAT-010  "]),
    inSet("name.required", "name", ["物料 X"]),
  ],
);
export const dates = [
  [],
  ["2026-10-07", "2026-10-07"],
  ["2026-10-07", "2026-10-08"],
  ["2026-10-31", "2026-11-01"],
  ["2026-12-31", "2027-01-01"],
  ["2026-10-08", "2026-10-07"],
  ["2026-02-30", "2026-03-01"],
];
export const times = ["", "00:00", "12:34", "23:59", "24:00", "12:60"];
export const dateTimes = [
  "",
  "2026-10-07 00:00:00",
  "2026-10-07 23:59:59",
  "2028-02-29 12:34:56",
  "2026-02-29 12:34:56",
  "2026-10-07 24:00:00",
  "非日期文本",
];
export const files = [
  { name: "", size: 0 },
  ...["txt", "csv", "json", "png", "jpg", "jpeg"].flatMap((ext) =>
    [0, 2097152, 2097153].map((size) => ({ name: `fixture.${ext}`, size })),
  ),
  { name: "fixture.CSV", size: 3 },
  { name: "fixture.exe", size: 3 },
];
