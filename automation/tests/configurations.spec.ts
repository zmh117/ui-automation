import { test, expect } from "../fixtures";
import * as m from "../models/cases";
import {
  Lab,
  modes,
  metadata,
  toggle,
  numberInput,
  type Region,
} from "../pages/lab";
import type { ConfigurationCase } from "@mes-ui/config-enumerator";
import { selectCandidates } from "../smoke/selection.mjs";

for (const mode of modes) {
  function cases(
    region: Region,
    candidates: ConfigurationCase[],
    run: (lab: Lab, v: any, c: ConfigurationCase) => Promise<void>,
  ) {
    for (const c of selectCandidates(candidates))
      test(
        `${mode} ${c.id} ${c.classification}`,
        metadata(
          region,
          mode,
          c,
          c.id.startsWith("linkage.abcd") && c.values.a && c.values.b ? 2 : 1,
        ),
        async ({ page }) => {
          const lab = new Lab(page, region);
          await lab.goto(mode);
          await test.step(`执行候选 ${JSON.stringify(c.values)}`, () =>
            run(lab, c.values, c));
        },
      );
  }
  cases("inputs", m.required, async (l, v) => {
    const before = await l.snapshot();
    for (const [id, key] of [
      ["config-name", "name"],
      ["integer-count", "count"],
      ["decimal-weight", "weight"],
    ])
      await l.field(id!).fill(v[key!]);
    const legal =
      v.name === "UI配置" &&
      ["0", "1", "9999"].includes(v.count) &&
      m.goodWeights.includes(v.weight);
    if (legal) {
      await l.persist({ ...before, ...v });
      for (const [id, key] of [
        ["config-name", "name"],
        ["integer-count", "count"],
        ["decimal-weight", "weight"],
      ])
        await expect(l.field(id!)).toHaveValue(v[key!]);
    } else {
      await l.field("basic-save").click();
      for (const [invalid, message] of [
        [!v.name.trim(), "请输入配置名称"],
        [!["0", "1", "9999"].includes(v.count), "请输入 0–9999 的整数"],
        [
          !m.goodWeights.includes(v.weight),
          "请输入 0–100000 的数字，最多 3 位小数",
        ],
      ] as const)
        if (invalid)
          await expect(
            l.root.getByRole("alert").filter({ hasText: message }),
          ).toBeVisible();
      await l.unchanged(before);
    }
  });
  cases(
    "inputs",
    m.group("basic.free", {
      raw: ["", "中文 English 123", "'\"<>&", "第一行\n第二行\r第三行"],
    }),
    async (l, v) => {
      const before = await l.snapshot();
      await l.basic();
      await l.field("free-text").fill(v.raw);
      const expected = v.raw.replace(/[\r\n]/g, " ");
      await expect(l.field("free-text")).toHaveValue(expected);
      await l.persist({
        ...before,
        name: "UI配置",
        count: "7",
        weight: "1.234",
        freeText: expected,
      });
      await expect(l.field("free-text")).toHaveValue(expected);
    },
  );
  for (const kind of ["integer", "decimal"] as const)
    cases(
      "inputs",
      m.group(
        `basic.${kind}Format`,
        {
          raw:
            kind === "integer"
              ? ["-1", "1.2", "1e3", "abc", "１２", "+1"]
              : m.badDecimals,
        },
        [
          {
            id: "format",
            message: "非法格式被拒绝",
            assert: { op: "eq", field: "raw", value: "never-valid" },
          },
        ],
      ),
      async (l, v) => {
        await l.basic();
        const input = l.field(
          kind === "integer" ? "integer-count" : "decimal-weight",
        );
        await input.fill(v.raw);
        await expect(input).toHaveValue(kind === "integer" ? "7" : "1.234");
        await expect(l.root.getByRole("status")).toContainText(
          kind === "integer" ? "整数" : "小数",
        );
      },
    );
  cases(
    "inputs",
    m.group("basic.note", { raw: m.notes }, [
      {
        id: "note.limit",
        message: "最多 100 码点",
        assert: { op: "length", field: "raw", max: 100 },
      },
    ]),
    async (l, v) => {
      const before = await l.snapshot();
      await l.basic();
      await l.field("limited-note").fill(v.raw);
      const note = Array.from(v.raw as string)
        .slice(0, 100)
        .join("");
      await expect(l.field("limited-note")).toHaveValue(note);
      await expect(l.field("note-count")).toHaveText(
        `${Array.from(note).length} / 100`,
      );
      await l.persist({
        ...before,
        name: "UI配置",
        count: "7",
        weight: "1.234",
        note,
      });
      await expect(l.field("limited-note")).toHaveValue(note);
    },
  );
  cases("linkage", m.abcd, async (l, v) => {
    const before = await l.snapshot();
    if (v.a && v.b) {
      await test.step("A→B：正常 UI 禁止 B", async () => {
        await l.field("checkbox-a").check();
        await expect(l.field("checkbox-b")).toBeDisabled();
        await expect(l.field("checkbox-b")).not.toBeChecked();
      });
      await l.field("checkbox-a").uncheck();
      await test.step("B→A：正常 UI 禁止 A", async () => {
        await l.field("checkbox-b").check();
        await expect(l.field("checkbox-a")).toBeDisabled();
        await expect(l.field("checkbox-a")).not.toBeChecked();
      });
    } else {
      if (v.a) await l.field("checkbox-a").check();
      if (v.b) await l.field("checkbox-b").check();
    }
    await l.field("checkbox-d").setChecked(v.d);
    await l.field("checkbox-c").setChecked(v.c);
    await expect(l.field("checkbox-d")).toBeChecked({ checked: v.c || v.d });
    await expect(l.field("checkbox-d")).toBeEnabled({ enabled: !v.c });
    if ((v.a && v.b) || (v.c && !v.d)) await l.unchanged(before);
    else {
      await l.persist({ ...before, ...v });
      for (const k of ["a", "b", "c", "d"])
        await expect(l.field(`checkbox-${k}`)).toBeChecked({ checked: v[k] });
    }
  });
  cases("linkage", m.conditional, async (l, v) => {
    const before = await l.snapshot();
    await l.field("source-manual").check();
    await l.field("manual-value").fill(v.manual);
    await l.field(`source-${v.mode}`).check();
    const sw = l.root.getByRole("switch", { name: "启用高级配置" });
    await toggle(sw, true);
    await l.field("advanced-reason").fill(v.reason);
    await toggle(sw, v.advanced);
    await expect(l.field("manual-value")).toBeEnabled({
      enabled: !(v.mode === "system"),
    });
    await expect(l.field("advanced-reason")).toBeEnabled({
      enabled: !!v.advanced,
    });
    const legal =
      (v.mode === "system" || v.manual === "37") &&
      (!v.advanced || v.reason === "调试验证");
    if (legal) {
      await l.persist({ ...before, ...v });
      await expect(l.field("manual-value")).toHaveValue(v.manual);
      await expect(l.field("advanced-reason")).toHaveValue(v.reason);
    } else {
      await l.field("linkage-save").click();
      if (v.mode === "manual" && !v.manual.trim())
        await expect(
          l.root.getByRole("alert").filter({ hasText: "手动模式" }),
        ).toBeVisible();
      if (v.advanced && !v.reason.trim())
        await expect(
          l.root.getByRole("alert").filter({ hasText: "启用高级配置" }),
        ).toBeVisible();
      await l.unchanged(before);
    }
  });
  cases("dialogs", m.display, async (l, v) => {
    const before = await l.snapshot();
    await l.openDialog();
    await l.outer.getByTestId("dialog-fixed").fill("10");
    const source = v.source === "fixed" ? "fixed" : "variable";
    await l.outer.getByTestId(`dialog-source-${source}`).check();
    await expect(l.outer.getByTestId("dialog-fixed")).toBeEnabled({
      enabled: !(source === "variable"),
    });
    await expect(l.outer.getByTestId("choose-variable")).toBeEnabled({
      enabled: !(source === "fixed"),
    });
    if (v.source.startsWith("V-")) await l.variable(v.source);
    await l.outer.getByRole("tab", { name: "显示与校验" }).click();
    await l.select(
      l.outer.getByTestId("display-precision"),
      `${v.precision} 位小数`,
    );
    await l.select(
      l.outer
        .locator(".el-select")
        .filter({ has: l.page.locator("#display-unit") }),
      v.unit || "无单位",
    );
    await l.outer.getByTestId("dialog-required").setChecked(v.required);
    if (v.source === "none") {
      await l.outer.getByTestId("dialog-confirm").click();
      await expect(l.outer.getByRole("alert")).toHaveText("请选择一个变量");
      await expect(l.outer).toBeVisible();
      await l.outer.getByTestId("dialog-cancel").click();
      await l.unchanged(before);
    } else {
      await l.dialogPersist({
        ...before,
        source,
        fixed: "10",
        variableId: source === "fixed" ? "" : v.source,
        precision: v.precision,
        unit: v.unit,
        required: v.required,
      });
      await l.openDialog();
      await expect(
        l.outer.getByTestId(`dialog-source-${source}`),
      ).toBeChecked();
      if (source === "variable")
        await expect(l.outer.getByTestId("bound-variable")).toHaveValue(
          new RegExp(v.source),
        );
      await l.outer.getByRole("tab", { name: "显示与校验" }).click();
      await expect(l.outer.getByTestId("display-precision")).toContainText(
        `${v.precision} 位小数`,
      );
      await expect(l.outer.getByTestId("dialog-required")).toBeChecked({
        checked: v.required,
      });
    }
  });
  for (const groupName of ["name", "fixed", "format", "remark"] as const) {
    const values =
      groupName === "name"
        ? ["", "   ", "UI控件"]
        : groupName === "fixed"
          ? m.weights
          : groupName === "format"
            ? m.badDecimals
            : m.notes;
    const legal =
      groupName === "name"
        ? ["UI控件"]
        : groupName === "fixed"
          ? m.goodWeights
          : groupName === "format"
            ? []
            : values;
    cases(
      "dialogs",
      m.group(
        `dialogs.${groupName}`,
        { raw: values },
        groupName === "remark"
          ? [
              {
                id: "remark.limit",
                message: "最多 100 码点",
                assert: { op: "length", field: "raw", max: 100 },
              },
            ]
          : [m.inSet("field.value", "raw", legal)],
      ),
      async (l, v) => {
        const before = await l.snapshot();
        await l.openDialog();
        const id =
          groupName === "format" || groupName === "fixed"
            ? "dialog-fixed"
            : groupName === "name"
              ? "dialog-name"
              : "dialog-remark";
        if (groupName === "remark")
          await l.outer.getByRole("tab", { name: "显示与校验" }).click();
        if (groupName === "format")
          await l.outer.locator(`#${id}`).fill("1.234");
        await l.outer.locator(`#${id}`).fill(v.raw);
        if (groupName === "format") {
          await expect(l.outer.locator(`#${id}`)).toHaveValue("1.234");
          await expect(l.outer.getByRole("status")).toBeVisible();
          return;
        }
        if (!legal.includes(v.raw)) {
          await l.outer.getByTestId("dialog-confirm").click();
          await expect(l.outer.getByRole("alert")).toBeVisible();
          await l.outer.getByTestId("dialog-cancel").click();
          await l.unchanged(before);
        } else {
          const value =
            groupName === "remark"
              ? Array.from(v.raw as string)
                  .slice(0, 100)
                  .join("")
              : v.raw;
          await l.dialogPersist({ ...before, [groupName]: value });
          await l.openDialog();
          if (groupName === "remark")
            await l.outer.getByRole("tab", { name: "显示与校验" }).click();
          await expect(l.outer.locator(`#${id}`)).toHaveValue(value);
        }
      },
    );
  }
  cases("extended", m.selections, async (l, v) => {
    const before = await l.snapshot();
    await l.priority(v.priority);
    await l.workshop(v.workshop);
    await l.tags(v.tags);
    await l.persist({ ...before, ...v });
    await expect(l.field("feature-tags-count")).toHaveText(
      `已选 ${v.tags.length} 项。`,
    );
    for (const tag of v.tags)
      await expect(l.field("feature-tags")).toContainText(tag);
  });
  cases("extended", m.thresholds, async (l, v) => {
    const before = await l.snapshot();
    const input = l.root.locator(".el-slider .el-input-number input");
    await numberInput(input, v.threshold);
    await toggle(
      l.root.getByRole("switch", { name: "启用阈值告警" }),
      v.enabled,
    );
    await expect(input).toBeEnabled({ enabled: !!v.enabled });
    await expect(l.root.getByRole("slider")).toHaveAttribute(
      "aria-valuenow",
      String(v.threshold),
    );
    await l.persist({ ...before, ...v });
    await expect(input).toHaveValue(String(v.threshold));
    await expect(input).toBeEnabled({ enabled: !!v.enabled });
  });
  cases(
    "extended",
    m.group("extended.thresholdBoundary", { raw: [-1, 101] }, [
      m.inSet("range", "raw", []),
    ]),
    async (l, v) => {
      const before = await l.snapshot();
      const input = l.root.locator(".el-slider .el-input-number input");
      await numberInput(input, v.raw);
      const actual = Number(await input.inputValue());
      expect(actual).toBeGreaterThanOrEqual(0);
      expect(actual).toBeLessThanOrEqual(100);
      await l.persist({ ...before, threshold: actual });
    },
  );
  cases(
    "extended",
    m.group("extended.color", { color: ["#13665d", "#000000", "#ffffff"] }),
    async (l, v) => {
      const before = await l.snapshot();
      await l.field("mark-color").fill(v.color);
      await expect(l.root.locator(".color-field")).toContainText(v.color);
      await l.persist({ ...before, color: v.color });
      await expect(l.field("mark-color")).toHaveValue(v.color);
    },
  );
  cases(
    "extended",
    m.group("extended.files", { file: m.files }, [
      {
        id: "file.allowed",
        message: "合法扩展名且不超过 2MiB",
        assert: {
          op: "in",
          field: "file",
          values: m.files.filter(
            (f) => f.size <= 2097152 && !f.name.endsWith(".exe"),
          ),
        },
      },
    ]),
    async (l, v) => {
      const before = await l.snapshot();
      const file = v.file;
      let expected = null;
      if (file.name) {
        const rejected = file.size > 2097152 || file.name.endsWith(".exe");
        if (rejected) {
          await l
            .field("attachment")
            .setInputFiles({
              name: "previous.txt",
              mimeType: "text/plain",
              buffer: Buffer.from("ok"),
            });
          expected = { name: "previous.txt", size: 2, type: "text/plain" };
        }
        await l
          .field("attachment")
          .setInputFiles({
            name: file.name,
            mimeType: "application/octet-stream",
            buffer: Buffer.alloc(file.size, 120),
          });
        if (rejected) {
          await expect(l.root.getByRole("alert")).toContainText(
            file.size > 2097152 ? "文件不能超过" : "仅支持",
          );
          await expect(l.root.locator(".file-record")).toContainText(
            "previous.txt",
          );
        } else {
          expected = { ...file, type: "application/octet-stream" };
          await expect(l.root.locator(".file-record")).toContainText(file.name);
        }
      }
      await l.persist({ ...before, file: expected });
      await expect(l.field("attachment")).toHaveValue("");
      if (expected)
        await expect(l.root.locator(".file-record")).toContainText(
          expected.name,
        );
    },
  );
  for (const kind of ["dates", "time", "dateTime"] as const) {
    const samples =
      kind === "dates" ? m.dates : kind === "time" ? m.times : m.dateTimes;
    const legal = samples.slice(0, kind === "dates" ? 5 : 4);
    cases(
      "extended",
      m.group(`extended.${kind}`, { raw: samples }, [
        m.inSet("calendar.valid", "raw", legal),
      ]),
      async (l, v, c) => {
        const before = await l.snapshot();
        if (kind === "dates") {
          if (v.raw.length) {
            const range = l.root.locator(".el-date-editor--daterange");
            await range.getByPlaceholder("开始日期", { exact: true }).fill(v.raw[0]);
            const end = range.getByPlaceholder("结束日期", { exact: true });
            await end.fill(v.raw[1]);
            await end.press("Enter");
          }
        } else {
          const input = l.root.locator(
            kind === "time" ? "#reminder-time" : "#planned-datetime",
          );
          if (v.raw) {
            if (kind === "time") {
              await input.click();
              await expect(
                l.page.locator(".el-time-panel:visible"),
              ).toBeVisible();
            }
            await input.fill(v.raw);
            await input.press("Tab");
          }
        }
        await l.root.locator('label[for="mark-color"]').click();
        if (c.classification === "valid") {
          await l.persist({ ...before, [kind]: v.raw });
          if (kind !== "dates")
            await expect(
              l.root.locator(
                kind === "time" ? "#reminder-time" : "#planned-datetime",
              ),
            ).toHaveValue(v.raw);
        } else {
          await l.field("extended-save").click();
          const actual = await l.snapshot();
          expect(actual[kind]).not.toEqual(v.raw);
          // 同时验证最终日期/时间为有效格式或空值，不能只凭输入不同就算拦截成功。
          if (kind === "dates" && actual.dates.length) {
            expect(actual.dates[0] <= actual.dates[1]).toBeTruthy();
            for (const d of actual.dates)
              expect(
                new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10),
              ).toBe(d);
          }
          if (kind === "time" && actual.time)
            expect(actual.time).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
          if (kind === "dateTime" && actual.dateTime) {
            expect(actual.dateTime).toMatch(
              /^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/,
            );
            expect(
              new Date(actual.dateTime.replace(" ", "T") + "Z")
                .toISOString()
                .slice(0, 19)
                .replace("T", " "),
            ).toBe(actual.dateTime);
          }
          await l.persist(actual, false);
        }
      },
    );
  }
  cases("table", m.rowCases, async (l, v) => {
    const before = await l.snapshot();
    const row = l.row("row-001");
    await l.field("row-code-row-001").fill(v.code);
    await l.field("row-name-row-001").fill(v.name);
    await numberInput(row.locator(".el-input-number input"), v.quantity);
    await row.locator("select").selectOption(v.unit);
    await toggle(row.getByRole("switch"), v.enabled);
    await expect(row.locator(".el-input-number input")).toBeEnabled({
      enabled: !!v.enabled,
    });
    await expect(row.locator("select")).toBeEnabled({ enabled: !!v.enabled });
    if (!v.code.trim() || !v.name.trim()) {
      await l.field("table-save").click();
      await expect(l.root.getByRole("alert")).toContainText(
        "编码和名称均为必填",
      );
      await l.unchanged(before);
    } else {
      await l.persist([
        { ...before[0], ...v, code: v.code.trim(), name: v.name.trim() },
        before[1],
      ]);
      await expect(l.field("row-code-row-001")).toHaveValue(v.code.trim());
      await expect(row.locator(".el-input-number input")).toHaveValue(
        v.quantity.toFixed(3),
      );
    }
  });
  cases(
    "table",
    m.group("table.rowCount", {
      count: Array.from({ length: 20 }, (_, i) => i + 1),
    }),
    async (l, v) => {
      test.setTimeout(60000);
      await l.rowsCount(v.count);
      if (v.count === 1)
        await expect(
          l.root.getByRole("button", { name: "删除第 1 行", exact: true }),
        ).toBeDisabled();
      if (v.count === 20) await expect(l.field("add-row")).toBeDisabled();
      await l.field("table-save").click();
      const actual = await l.snapshot();
      expect(actual).toHaveLength(v.count);
      for (let i = 2; i < actual.length; i++)
        expect(actual[i]).toMatchObject({
          code: `NEW-${i + 1}`,
          name: `新增物料 ${i + 1}`,
          quantity: 1,
          unit: "kg",
          enabled: true,
        });
      expect(new Set(actual.map((r: any) => r.id)).size).toBe(v.count);
      await l.persist(actual, false);
    },
  );
  cases(
    "table",
    m.group(
      "table.duplicates",
      {
        raw: ["MAT-001", "mat-001", "  MAT-001  "],
        location: ["same", "cross"],
      },
      [m.inSet("unique", "raw", [])],
    ),
    async (l, v) => {
      const before = await l.snapshot();
      const id =
        v.location === "cross"
          ? (await l.rowsCount(5), await l.addRow(6))
          : "row-002";
      await l.field(`row-code-${id}`).fill(v.raw);
      await l.field("table-save").click();
      await expect(l.row("row-001")).toBeVisible();
      await expect(l.root.getByRole("alert").filter({ hasText: "物料编码重复" })).not.toHaveCount(0);
      await l.unchanged(before);
    },
  );
  cases(
    "table",
    m.group(
      "table.quantityBoundary",
      { raw: ["", "0", "-1", "100000.001", "abc"] },
      [m.inSet("quantity.valid", "raw", [])],
    ),
    async (l, v) => {
      const before = await l.snapshot();
      const input = l.row("row-001").locator(".el-input-number input");
      // number 类型不接受 fill('abc')；正常逐键输入才能观察浏览器过滤。
      if (v.raw === "abc") {
        await input.fill("");
        await input.pressSequentially("abc");
        await input.press("Tab");
      } else await numberInput(input, v.raw);
      const actual = await input.inputValue();
      await l.field("table-save").click();
      if (!actual) {
        await expect(l.root.getByRole("alert")).toContainText("数量须大于");
        await l.unchanged(before);
      } else {
        const n = Number(actual);
        expect(n).toBeGreaterThan(0);
        expect(n).toBeLessThanOrEqual(100000);
        await l.persist([{ ...before[0], quantity: n }, before[1]], false);
      }
    },
  );
}
