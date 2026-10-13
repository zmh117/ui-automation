import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import {
  Lab,
  modes,
  regions,
  metadata,
  toggle,
  numberInput,
  type Region,
} from "../pages/lab";

const titles = ["基础输入", "联动规则", "嵌套弹框", "扩展输入", "动态表格"];
async function close(l: Lab, which: "inner" | "outer", method: string) {
  const dialog = l[which];
  if (method === "cancel")
    await dialog
      .getByTestId(which === "inner" ? "variable-cancel" : "dialog-cancel")
      .click();
  if (method === "x") await dialog.locator(".el-dialog__headerbtn").click();
  if (method === "escape") await l.page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}
async function messageClose(page: Page, method: string, confirm: string) {
  const box = page.locator(".el-message-box");
  await expect(box).toBeVisible();
  if (method === "confirm")
    await box.getByRole("button", { name: confirm, exact: true }).click();
  if (method === "cancel")
    await box.getByRole("button", { name: "取消", exact: true }).click();
  if (method === "x") await box.locator(".el-message-box__headerbtn").click();
  if (method === "escape") await page.keyboard.press("Escape");
  await expect(box).toBeHidden();
}
for (const mode of modes) {
  function behavior(
    region: Region,
    id: string,
    run: (lab: Lab) => Promise<void>,
  ) {
    test(
      `${mode} behavior.${region}.${id}`,
      metadata(region, mode, {
        id: `behavior.${region}.${id}`,
        classification: "behavior",
      }),
      async ({ page }) => {
        const l = new Lab(page, region);
        await l.goto(mode);
        await run(l);
      },
    );
  }
  behavior("inputs", "readonly-disabled", async (l) => {
    const ro = l.field("readonly-code"),
      disabled = l.field("disabled-device");
    await expect(ro).toHaveAttribute("readonly", "");
    await ro.click();
    await l.page.keyboard.press("ControlOrMeta+A");
    await l.page.keyboard.type("覆盖");
    await expect(ro).toHaveValue("LAB-INPUT-001");
    await expect(disabled).toBeDisabled();
    await ro.press("Tab");
    await l.page.keyboard.type("尝试输入");
    await expect(disabled).not.toBeFocused();
    await expect(disabled).toHaveValue("未启用设备采集");
  });
  behavior("inputs", "dirty-restore-refresh", async (l) => {
    await expect(l.root.locator(".draft-badge")).toHaveText("当前无修改");
    const before = await l.snapshot();
    await l.basic();
    await expect(l.root.locator(".draft-badge")).toHaveText("有未保存修改");
    const saved = { ...before, name: "UI配置", count: "7", weight: "1.234" };
    await l.persist(saved);
    await l.field("config-name").fill("未保存");
    await l.restore();
    await expect(l.field("config-name")).toHaveValue("UI配置");
    await l.field("free-text").fill("草稿");
    await l.reload();
    await expect(l.field("free-text")).toHaveValue("");
    await l.assertSaved(saved);
  });
  behavior("linkage", "unlock-retention-restore", async (l) => {
    for (const [x, y] of [
      ["a", "b"],
      ["b", "a"],
    ]) {
      await l.field(`checkbox-${x}`).check();
      await expect(l.field(`checkbox-${y}`)).toBeDisabled();
      await l.field(`checkbox-${x}`).uncheck();
      await expect(l.field(`checkbox-${y}`)).toBeEnabled();
    }
    await l.field("checkbox-c").check();
    await l.field("checkbox-c").uncheck();
    await expect(l.field("checkbox-d")).toBeChecked();
    await expect(l.field("checkbox-d")).toBeEnabled();
    await l.field("checkbox-c").check();
    await expect(l.field("checkbox-d")).toBeDisabled();
    await l.field("checkbox-c").uncheck();
    await l.field("source-manual").check();
    await l.field("manual-value").fill("37");
    await l.field("source-system").check();
    await l.field("source-manual").check();
    await expect(l.field("manual-value")).toHaveValue("37");
    const sw = l.root.getByRole("switch", { name: "启用高级配置" });
    await toggle(sw, true);
    await l.field("advanced-reason").fill("调试验证");
    await toggle(sw, false);
    await toggle(sw, true);
    await expect(l.field("advanced-reason")).toHaveValue("调试验证");
    await l.field("linkage-save").click();
    const saved = await l.snapshot();
    await l.field("checkbox-a").check();
    await l.restore();
    await expect(l.field("checkbox-a")).not.toBeChecked();
    await l.persist(saved, false);
  });
  for (const method of ["cancel", "x", "escape"]) {
    behavior("dialogs", `inner-${method}`, async (l) => {
      const before = await l.snapshot();
      await l.openDialog();
      await l.outer.getByTestId("dialog-source-variable").check();
      await l.variable("V-002", false);
      await close(l, "inner", method);
      await expect(l.outer).toBeVisible();
      await expect(l.outer.getByTestId("bound-variable")).toHaveValue("");
      await close(l, "outer", "cancel");
      await l.unchanged(before);
    });
    behavior("dialogs", `outer-${method}`, async (l) => {
      const before = await l.snapshot();
      await l.openDialog();
      await l.outer.getByTestId("dialog-source-variable").check();
      await l.variable("V-008");
      await expect(l.outer.getByTestId("bound-variable")).toHaveValue(/V-008/);
      await close(l, "outer", method);
      await l.unchanged(before);
      await l.openDialog();
      await expect(l.outer.getByTestId("dialog-source-fixed")).toBeChecked();
      await expect(l.outer.getByTestId("bound-variable")).toHaveValue("");
    });
  }
  behavior("dialogs", "search-pagination-confirm", async (l) => {
    const before = await l.snapshot();
    await l.openDialog();
    await l.outer.getByTestId("dialog-source-variable").check();
    await l.outer.getByTestId("choose-variable").click();
    await expect(l.inner.getByTestId("variable-confirm")).toBeDisabled();
    for (const [query, id] of [
      ["v-002", "V-002"],
      ["目标净重", "V-001"],
      ["kg", "V-001"],
    ]) {
      await l.inner.getByTestId("variable-search").fill(query!);
      await expect(l.inner.getByTestId(`variable-row-${id}`)).toBeVisible();
    }
    await l.inner.getByTestId("variable-search").fill("无此变量");
    await expect(l.inner.locator(".empty-table")).toBeVisible();
    await l.inner.getByTestId("variable-search").fill("");
    await l.inner
      .locator(".el-pager li")
      .filter({ hasText: /^\s*2\s*$/ })
      .click();
    await l.inner.getByTestId("select-V-008").check();
    await l.inner.getByTestId("variable-search").fill("kg");
    await expect(l.inner.locator(".el-pager li.is-active")).toHaveText("1");
    await l.inner.getByTestId("variable-search").fill("");
    await l.inner
      .locator(".el-pager li")
      .filter({ hasText: /^\s*2\s*$/ })
      .click();
    await expect(l.inner.getByTestId("select-V-008")).toBeChecked();
    await l.inner.getByTestId("variable-confirm").click();
    await expect(l.outer.getByTestId("bound-variable")).toHaveValue(/V-008/);
    expect(await l.stored()).toBeNull();
    await l.dialogPersist({
      ...before,
      source: "variable",
      variableId: "V-008",
    });
  });
  behavior("dialogs", "backdrops-mode-roundtrip", async (l) => {
    await l.openDialog();
    await l.outer.getByTestId("dialog-fixed").fill("42");
    await l.outer.click({ position: { x: 5, y: 5 } });
    await expect(l.outer).toBeVisible();
    await l.outer.getByTestId("dialog-source-variable").check();
    await l.variable("V-006", false);
    await l.inner.click({ position: { x: 5, y: 5 } });
    await expect(l.inner).toBeVisible();
    await l.inner.getByTestId("variable-confirm").click();
    await l.outer.getByTestId("dialog-source-fixed").check();
    await expect(l.outer.getByTestId("dialog-fixed")).toHaveValue("42");
    await expect(l.outer.getByTestId("bound-variable")).toBeDisabled();
    await l.outer.getByTestId("dialog-source-variable").check();
    await expect(l.outer.getByTestId("bound-variable")).toHaveValue(/V-006/);
    await expect(l.outer.getByTestId("dialog-fixed")).toBeDisabled();
  });
  behavior(
    "dialogs",
    "variable-metadata-does-not-overwrite-display",
    async (l) => {
      await l.openDialog();
      await l.outer.getByRole("tab", { name: "显示与校验" }).click();
      await l.select(l.outer.getByTestId("display-precision"), "1 位小数");
      await l.select(
        l.outer
          .locator(".el-select")
          .filter({ has: l.page.locator("#display-unit") }),
        "件",
      );
      await l.outer.getByRole("tab", { name: "基本配置" }).click();
      await l.outer.getByTestId("dialog-source-variable").check();
      await l.variable("V-008");
      await expect(l.outer.getByTestId("bound-variable")).toHaveAttribute(
        "readonly",
        "",
      );
      await l.outer.getByRole("tab", { name: "显示与校验" }).click();
      await expect(l.outer.getByTestId("display-precision")).toContainText(
        "1 位小数",
      );
      await expect(
        l.outer
          .locator(".el-select")
          .filter({ has: l.page.locator("#display-unit") }),
      ).toContainText("件");
    },
  );
  for (const destination of ["inputs", mode === "all" ? "dialogs" : "all"])
    behavior("dialogs", `navigation-${destination}`, async (l) => {
      await l.openDialog();
      await l.outer.getByTestId("dialog-source-variable").check();
      await l.variable("V-007", false);
      // 使用地址栏等价的 hash 导航离开页面；不绕过控件禁用。
      await l.page.goto(`/#/${destination}`);
      await expect(l.inner).toBeHidden();
      await expect(l.outer).toBeHidden();
      await l.page
        .getByTestId(`nav-${mode === "all" ? "all" : "dialogs"}`)
        .click();
      await l.openDialog();
      await expect(l.outer.getByTestId("dialog-source-fixed")).toBeChecked();
    });
  behavior("extended", "selection-search-clear-restore", async (l) => {
    const before = await l.snapshot();
    await l.priority("high");
    await l.priority("urgent");
    await l.workshop(["workshop-a", "line-2"]);
    await l.tags(["称重", "签名"]);
    const multi = l.field("feature-tags");
    await multi.locator(".el-select__wrapper").click();
    await multi.locator("input").fill("记录");
    await expect(l.page.getByTestId("feature-option-记录")).toBeVisible();
    await expect(l.field("feature-tags-count")).toHaveText("已选 2 项。");
    await multi.locator("input").fill("");
    await l.page
      .getByTestId("feature-option-称重")
      .filter({ visible: true })
      .click();
    await expect(l.field("feature-tags-count")).toHaveText("已选 1 项。");
    await l.page.keyboard.press("Escape");
    await expect(l.page.locator(".feature-tags-dropdown:visible")).toHaveCount(
      0,
    );
    await multi.hover();
    await multi.locator(".el-select__clear").click();
    await expect(l.field("feature-tags-count")).toHaveText("已选 0 项。");
    await multi.locator(".el-select__wrapper").click();
    await expect(
      l.page.locator(".feature-tags-dropdown[role=tooltip]:visible"),
    ).toBeVisible();
    await multi.locator("input").press("ArrowDown");
    await l.page.keyboard.press("Enter");
    await l.page.keyboard.press("Escape");
    await expect(l.field("feature-tags-count")).toHaveText("已选 1 项。");
    const cascade = l.root.locator(".el-cascader");
    await cascade.hover();
    await cascade.locator(".icon-circle-close").click();
    await expect(cascade.locator("input")).toHaveValue("");
    await l.restore();
    await expect(l.field("priority-select")).toContainText("常规处理");
    await expect(l.field("feature-tags-count")).toHaveText("已选 0 项。");
    await l.unchanged(before);
  });
  behavior("extended", "file-remove-replace-restore", async (l) => {
    const before = await l.snapshot();
    const upload = l.field("attachment");
    await upload.setInputFiles({
      name: "first.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("a"),
    });
    const saved = {
      ...before,
      file: { name: "first.txt", size: 1, type: "text/plain" },
    };
    await l.persist(saved);
    await upload.setInputFiles({
      name: "next.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("b"),
    });
    await expect(l.root.locator(".file-record")).toContainText("next.csv");
    await l.field("remove-attachment").click();
    await expect(l.root.locator(".file-record")).toHaveCount(0);
    await l.assertSaved(saved);
    await l.restore();
    await expect(l.root.locator(".file-record")).toContainText("first.txt");
    await expect(upload).toHaveValue("");
  });
  behavior("extended", "slider-keyboard", async (l) => {
    const slider = l.root.getByRole("slider");
    await slider.focus();
    await l.page.keyboard.press("ArrowRight");
    await expect(slider).toHaveAttribute("aria-valuenow", "65");
    await l.page.keyboard.press("ArrowLeft");
    await expect(slider).toHaveAttribute("aria-valuenow", "60");
    await toggle(l.root.getByRole("switch", { name: "启用阈值告警" }), false);
    await expect(l.root.locator(".el-slider__runway")).toHaveClass(
      /is-disabled/,
    );
    await l.page.keyboard.press("ArrowRight");
    await expect(slider).toHaveAttribute("aria-valuenow", "60");
  });
  behavior("extended", "calendar-time-panels-clear", async (l) => {
    const before = await l.snapshot();
    const range = l.root.locator(".el-date-editor--daterange");
    const start = range.getByPlaceholder("开始日期", { exact: true });
    const end = range.getByPlaceholder("结束日期", { exact: true });
    await start.fill("2026-10-07");
    await end.fill("2026-10-08");
    await end.press("Enter");
    await start.click();
    const calendar = l.page.locator(".el-date-range-picker:visible");
    await expect(
      calendar.getByRole("button", { name: "10 月", exact: true }),
    ).toBeVisible();
    const october = calendar.locator(".el-date-range-picker__content").filter({
      has: l.page.getByRole("button", { name: "10 月", exact: true }),
    }).getByRole("grid");
    await october.getByRole("gridcell", { name: "10", exact: true }).click();
    await october.getByRole("gridcell", { name: "12", exact: true }).click();
    await l.root.locator("#reminder-time").click();
    await expect(l.page.locator(".el-time-panel:visible")).toBeVisible();
    await l.root.locator("#reminder-time").fill("12:34");
    await l.root.locator("#reminder-time").press("Tab");
    await l.root.locator('label[for="mark-color"]').click();
    await expect(l.root.locator("#reminder-time")).toHaveValue("12:34");
    await l.root.locator("#reminder-time").click();
    const time = l.page.locator(".el-time-panel:visible");
    await expect(time).toBeVisible();
    // 时间列没有区分时/分/秒的公开语义，用控件支持的键盘操作。
    const reminder = l.root.getByLabel("提醒时间", { exact: true });
    await reminder.press("ArrowDown");
    await reminder.press("ArrowRight");
    await reminder.press("ArrowDown");
    await expect(reminder).toHaveValue("13:35");
    await time.getByRole("button", { name: "确定", exact: true }).click();
    const dt = l.root.locator("#planned-datetime");
    await dt.fill("2026-10-07 12:34:56");
    await dt.press("Enter");
    await dt.click();
    const panel = l.page.locator(".planned-datetime-dropdown:visible");
    await panel.getByRole("gridcell", { name: "8", exact: true }).click();
    await panel.getByRole("textbox", { name: "选择时间", exact: true }).click();
    await expect(time).toBeVisible();
    const clock = panel.getByRole("textbox", { name: "选择时间", exact: true });
    await clock.fill("13:35:57");
    await clock.press("Tab");
    await expect(time).toBeHidden();
    await expect(clock).toHaveValue("13:35:57");
    await clock.click();
    await time.getByRole("button", { name: "确定", exact: true }).click();
    await expect(time).toBeHidden();
    await panel.getByRole("button", { name: "确定", exact: true }).click();
    await l.persist({
      ...before,
      dates: ["2026-10-10", "2026-10-12"],
      time: "13:35",
      dateTime: "2026-10-08 13:35:57",
    });
    await range.hover();
    await range.locator(".el-range__close-icon").click();
    for (const id of ["reminder-time", "planned-datetime"]) {
      const input = l.root.locator(`#${id}`);
      const wrapper = l.root.locator(`.el-date-editor:has(input#${id})`);
      await wrapper.hover();
      await wrapper.locator(".clear-icon").click();
      await expect(input).toHaveValue("");
    }
    await l.persist(before);
  });
  for (const method of ["cancel", "confirm", "x", "escape", "backdrop"])
    behavior("table", `delete-${method}`, async (l) => {
      const before = await l.snapshot();
      await l.field("row-delete-row-002").click();
      if (method === "backdrop") {
        await l.page
          .locator(".el-overlay-message-box")
          .click({ position: { x: 5, y: 5 } });
        await expect(l.page.locator(".el-message-box")).toBeVisible();
        await messageClose(l.page, "cancel", "确认删除");
      } else await messageClose(l.page, method, "确认删除");
      await expect(l.row("row-002")).toHaveCount(method === "confirm" ? 0 : 1);
      await l.unchanged(before);
      if (method === "confirm") await l.persist([before[0]]);
    });
  behavior("table", "search-pagination-hidden-error-restore", async (l) => {
    await l.rowsCount(6);
    await l.root
      .locator(".el-pager li")
      .filter({ hasText: /^\s*1\s*$/ })
      .click();
    const search = l.field("material-search");
    for (const query of ["MAT-001", "原料 A", "mat-001", " MAT-001 "]) {
      await search.fill(query);
      await expect(l.row("row-001")).toBeVisible();
    }
    await search.fill("不存在");
    await expect(l.root.locator(".empty-table")).toBeVisible();
    await search.fill("");
    await l.root
      .locator(".el-pager li")
      .filter({ hasText: /^\s*2\s*$/ })
      .click();
    await expect(l.root.locator('[data-testid^="material-row-"]')).toHaveCount(
      1,
    );
    await search.fill("MAT");
    await expect(l.root.locator(".el-pager li.is-active")).toHaveText("1");
    await search.fill("");
    await l.field("row-name-row-001").fill("");
    await search.fill("NEW-6");
    await l.field("table-save").click();
    await expect(search).toHaveValue("");
    await expect(l.row("row-001")).toBeVisible();
    await expect(l.root.getByRole("alert")).toContainText("必填");
    await l.restore();
    await expect(l.root.locator('[data-testid^="material-row-"]')).toHaveCount(
      2,
    );
    await expect(l.root.getByRole("alert")).toHaveCount(0);
    await expect(search).toHaveValue("");
  });
  behavior("table", "add-clear-query-goto-end", async (l) => {
    await l.rowsCount(5);
    await l.field("material-search").fill("MAT-001");
    await l.field("add-row").click();
    await expect(l.field("material-search")).toHaveValue("");
    await expect(l.root.locator(".el-pager li.is-active")).toHaveText("2");
  });
  behavior("table", "delete-clamp-cross-edit", async (l) => {
    await l.rowsCount(5);
    const id = await l.addRow(6);
    await l.field(`row-name-${id}`).fill("跨页编辑");
    await l.root
      .locator(".el-pager li")
      .filter({ hasText: /^\s*1\s*$/ })
      .click();
    await expect(l.field("row-name-row-001")).toHaveValue("原料 A");
    await l.root
      .locator(".el-pager li")
      .filter({ hasText: /^\s*2\s*$/ })
      .click();
    await expect(l.field(`row-name-${id}`)).toHaveValue("跨页编辑");
    await l.field(`row-delete-${id}`).click();
    await messageClose(l.page, "confirm", "确认删除");
    await expect(l.root.locator(".el-pager li.is-active")).toHaveText("1");
    await expect(l.root.locator('[data-testid^="material-row-"]')).toHaveCount(
      5,
    );
  });
  behavior("table", "saved-add-edit-delete-restore", async (l) => {
    const before = await l.snapshot();
    await l.field("row-name-row-001").fill("已保存名称");
    const saved = [{ ...before[0], name: "已保存名称" }, before[1]];
    await l.persist(saved);
    await l.addRow(3);
    await l.field("row-code-row-001").fill("");
    await l.field("table-save").click();
    await expect(l.root.getByRole("alert")).toContainText("必填");
    await l.field("row-delete-row-002").click();
    await messageClose(l.page, "confirm", "确认删除");
    await l.field("material-search").fill("NEW");
    await l.restore();
    await expect(l.field("material-search")).toHaveValue("");
    await expect(l.root.getByRole("alert")).toHaveCount(0);
    await expect(l.field("row-name-row-001")).toHaveValue("已保存名称");
    await expect(l.row("row-002")).toBeVisible();
    await expect(l.root.locator('[data-testid^="material-row-"]')).toHaveCount(
      2,
    );
    await l.assertSaved(saved);
  });
}

test(
  "all global.navigation-jump-brand",
  metadata("all", "all", {
    id: "global.navigation-jump-brand",
    classification: "behavior",
  }),
  async ({ page }) => {
    await page.goto("/#/inputs");
    for (const [i, region] of [...regions, "all"].entries()) {
      await page.getByTestId(`nav-${region}`).click();
      await expect(page.getByTestId(`nav-${region}`)).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(page).toHaveTitle(
        `${[...titles, "全部组件"][i]} · 交互配置实验室`,
      );
      for (const r of regions)
        if (region === "all" || region === r)
          await expect(page.getByTestId(`section-${r}`)).toBeVisible();
        else await expect(page.getByTestId(`section-${r}`)).toBeHidden();
    }
    for (const [i, region] of regions.entries()) {
      await page.getByTestId(`jump-${region}`).click();
      await expect(page.getByTestId(`section-${region}`)).toBeFocused();
      await expect(page.getByTestId(`section-${region}`)).toBeInViewport();
      await page
        .getByRole("button", { name: `${titles[i]}：返回快速定位` })
        .click();
      await expect(page.locator("#component-section-top")).toBeFocused();
      await expect(page.locator("#component-section-top")).toBeInViewport();
    }
    await page.locator("a.brand").click();
    await expect(page).toHaveURL(/#\/inputs$/);
  },
);
for (const region of regions)
  test(
    `all global.draft-roundtrip.${region}`,
    metadata(region, "all", {
      id: `global.draft-roundtrip.${region}`,
      classification: "behavior",
    }),
    async ({ page }) => {
      const l = new Lab(page, region);
      await l.goto("category");
      if (region === "inputs") await l.field("free-text").fill("共享草稿");
      if (region === "linkage") await l.field("checkbox-c").check();
      if (region === "extended") await l.priority("urgent");
      if (region === "table")
        await l.field("row-name-row-001").fill("共享草稿");
      if (region === "dialogs") {
        await l.openDialog();
        await l.outer.getByTestId("dialog-name").fill("应丢弃的弹框草稿");
        await page.goto("/#/all");
        await expect(l.outer).toBeHidden();
      }
      for (const route of ["all", region]) {
        await page.getByTestId(`nav-${route}`).click();
        if (region === "inputs")
          await expect(l.field("free-text")).toHaveValue("共享草稿");
        if (region === "linkage")
          await expect(l.field("checkbox-c")).toBeChecked();
        if (region === "extended")
          await expect(l.field("priority-select")).toContainText("紧急处理");
        if (region === "table")
          await expect(l.field("row-name-row-001")).toHaveValue("共享草稿");
        if (region === "dialogs") {
          await l.openDialog();
          await expect(l.outer.getByTestId("dialog-name")).toHaveValue(
            "净重采集控件",
          );
          await close(l, "outer", "cancel");
        }
      }
      expect(await l.stored()).toBeNull();
    },
  );

async function fiveDrafts(page: Page) {
  const labs = Object.fromEntries(
    regions.map((r) => [r, new Lab(page, r)]),
  ) as Record<Region, Lab>;
  await labs.inputs.goto("all");
  const original: Record<string, unknown> = {};
  for (const r of regions) original[r] = await labs[r].snapshot();
  await labs.inputs.basic();
  await labs.linkage.field("checkbox-a").check();
  await labs.extended.priority("urgent");
  await labs.table.field("row-name-row-001").fill("独立草稿");
  return { labs, original };
}
for (const target of regions)
  test(
    `all global.section-save.${target}`,
    metadata(target, "all", {
      id: `global.section-save.${target}`,
      classification: "behavior",
    }),
    async ({ page }) => {
      const { labs, original } = await fiveDrafts(page);
      const l = labs[target];
      // 外层 dialog 的草稿只能在弹框中编辑；保存其他区前通过正常取消退出。
      await labs.dialogs.openDialog();
      await labs.dialogs.outer.getByTestId("dialog-name").fill("独立控件");
      if (target === "dialogs")
        await labs.dialogs.outer.getByTestId("dialog-confirm").click();
      else {
        await close(labs.dialogs, "outer", "cancel");
        await l.field(`${target === "inputs" ? "basic" : target}-save`).click();
      }
      for (const r of regions) {
        const snapshot = await labs[r].snapshot();
        if (r === target) expect(snapshot).not.toEqual(original[r]);
        else expect(snapshot).toEqual(original[r]);
      }
      await page.reload();
      for (const r of regions) {
        const snapshot = await labs[r].snapshot();
        if (r === target) expect(snapshot).not.toEqual(original[r]);
        else expect(snapshot).toEqual(original[r]);
      }
      if (target !== "inputs")
        await expect(labs.inputs.field("config-name")).toHaveValue("");
      if (target !== "linkage")
        await expect(labs.linkage.field("checkbox-a")).not.toBeChecked();
      if (target !== "extended")
        await expect(labs.extended.field("priority-select")).toContainText(
          "常规处理",
        );
      if (target !== "table")
        await expect(labs.table.field("row-name-row-001")).toHaveValue(
          "原料 A",
        );
    },
  );
for (const method of ["cancel", "x", "escape", "confirm"])
  test(
    `all global.reset.${method}`,
    metadata("all", "all", {
      id: `global.reset.${method}`,
      classification: "behavior",
    }),
    async ({ page }) => {
      const { labs, original } = await fiveDrafts(page);
      for (const r of ["inputs", "linkage", "extended", "table"] as const)
        await labs[r].field(`${r === "inputs" ? "basic" : r}-save`).click();
      await labs.dialogs.openDialog();
      await labs.dialogs.outer.getByTestId("dialog-name").fill("独立控件");
      await labs.dialogs.outer.getByTestId("dialog-confirm").click();
      const before = await labs.inputs.stored();
      expect(Object.keys(before.savedAt)).toHaveLength(5);
      await page.getByTestId("reset-all").click();
      await messageClose(page, method, "确认重置");
      if (method === "confirm") {
        expect(await labs.inputs.stored()).toBeNull();
        for (const r of regions)
          expect(await labs[r].snapshot()).toEqual(original[r]);
        await page.reload();
        expect(await labs.inputs.stored()).toBeNull();
      } else {
        expect(await labs.inputs.stored()).toEqual(before);
        await page.reload();
        expect(await labs.inputs.stored()).toEqual(before);
      }
    },
  );
