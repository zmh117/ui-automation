import {
  expect,
  test,
  type Page,
  type Locator,
  type TestInfo,
} from "@playwright/test";
import type { ConfigurationCase } from "@mes-ui/config-enumerator";
import { version } from "../models/cases";

export const regions = [
  "inputs",
  "linkage",
  "dialogs",
  "extended",
  "table",
] as const;
export type Region = (typeof regions)[number];
export const modes = ["category", "all"] as const;
export const sectionKey = {
  inputs: "basic",
  linkage: "linkage",
  dialogs: "dialog",
  extended: "extended",
  table: "rows",
};
export function metadata(
  region: string,
  mode: string,
  candidate:
    | ConfigurationCase
    | { id: string; values?: unknown; classification?: string },
  paths = 1,
) {
  return {
    annotation: {
      type: "case",
      description: JSON.stringify({
        modelVersion: version,
        source: "coverage-review.md",
        region,
        route: mode === "all" ? "/#/all" : `/#/${region}`,
        candidate,
        paths,
      }),
    },
  };
}
export async function record(info: TestInfo, data: unknown) {
  await info.attach("输入与实际结果", {
    body: JSON.stringify(data, null, 2),
    contentType: "application/json",
  });
}
export class Lab {
  constructor(
    readonly page: Page,
    readonly region: Region,
  ) {}
  get root() {
    return this.page.getByTestId(`section-${this.region}`);
  }
  field(id: string) {
    return this.root.getByTestId(id);
  }
  get outer() {
    return this.page.getByRole("dialog", { name: "控件设置", exact: true });
  }
  get inner() {
    return this.page.getByRole("dialog", { name: "选择数值变量", exact: true });
  }
  async goto(mode: string) {
    await this.page.goto(`/#/${mode === "all" ? "all" : this.region}`);
    await expect(this.root).toBeVisible();
  }
  async reload() {
    await this.page.reload();
    await expect(this.root).toBeVisible();
  }
  async snapshot(): Promise<any> {
    const result = this.root.getByTestId(
      `${sectionKey[this.region]}-saved-result`,
    );
    const details = result.locator("details");
    if ((await details.getAttribute("open")) === null)
      await details.locator("summary").click();
    await expect(details.locator("pre")).toBeVisible();
    return JSON.parse(await details.locator("pre").innerText());
  }
  async stored() {
    return this.page.evaluate(() => {
      const s = localStorage.getItem("mes-interaction-lab:v1");
      return s === null ? null : JSON.parse(s);
    });
  }
  async assertSaved(expected: unknown) {
    await expect.poll(() => this.snapshot()).toEqual(expected);
    const storage = await this.stored();
    expect(storage?.data[sectionKey[this.region]]).toEqual(expected);
  }
  async persist(expected: unknown, click = true) {
    await test.step("通过 UI 保存，核对结果与持久化，刷新后再次核对", async () => {
      if (click)
        await this.field(
          `${this.region === "inputs" ? "basic" : this.region}-save`,
        ).click();
      await this.assertSaved(expected);
      await this.reload();
      await this.assertSaved(expected);
    });
  }
  async unchanged(before: unknown) {
    expect(await this.snapshot()).toEqual(before);
    expect(await this.stored()).toBeNull();
  }
  async basic() {
    await this.field("config-name").fill("UI配置");
    await this.field("integer-count").fill("7");
    await this.field("decimal-weight").fill("1.234");
  }
  async restore() {
    await this.root
      .getByRole("button", { name: "恢复已保存", exact: true })
      .click();
  }
  async openDialog() {
    await this.field("open-config-dialog").click();
    await expect(this.outer).toBeVisible();
  }
  async variable(id: string, confirm = true) {
    await this.outer.getByTestId("choose-variable").click();
    await expect(this.inner).toBeVisible();
    // V-005…V-008 必须通过第二页点选，保留分页路径覆盖。
    if (Number(id.slice(-3)) > 4)
      await this.inner
        .locator(".el-pager li")
        .filter({ hasText: /^\s*2\s*$/ })
        .click();
    await this.inner.getByTestId(`select-${id}`).check();
    if (confirm) {
      await this.inner.getByTestId("variable-confirm").click();
      await expect(this.inner).toBeHidden();
    }
  }
  async dialogPersist(expected: unknown) {
    await this.outer.getByTestId("dialog-confirm").click();
    await expect(this.outer).toBeHidden();
    await this.persist(expected, false);
  }
  async select(root: Locator, label: string) {
    await root.locator(".el-select__wrapper").click();
    await this.page
      .getByRole("option", { name: label, exact: true })
      .filter({ visible: true })
      .click();
  }
  async priority(value: string) {
    await this.select(
      this.field("priority-select"),
      (
        { normal: "常规处理", high: "优先处理", urgent: "紧急处理" } as Record<
          string,
          string
        >
      )[value]!,
    );
  }
  async workshop(values: string[]) {
    if (!values.length) return;
    await this.root.locator(".el-cascader").click();
    const popup = this.page.locator(".el-cascader__dropdown:visible");
    await popup
      .getByRole("menuitem", {
        name: values[0] === "workshop-a" ? "一号车间" : "二号车间",
        exact: true,
      })
      .click();
    await popup
      .getByRole("menuitem", {
        name: (
          {
            "line-1": "配料产线",
            "line-2": "包装产线",
            "line-3": "灌装产线",
          } as Record<string, string>
        )[values[1]!]!,
        exact: true,
      })
      .click();
  }
  async tags(values: string[]) {
    await this.field("feature-tags").locator(".el-select__wrapper").click();
    for (const value of values)
      await this.page
        .getByTestId(`feature-option-${value}`)
        .filter({ visible: true })
        .click();
    await this.page.keyboard.press("Escape");
    await expect(this.field("feature-tags-count")).toHaveText(
      `已选 ${values.length} 项。`,
    );
  }
  row(id: string) {
    return this.field(`material-row-${id}`);
  }
  async addRow(n: number) {
    await this.field("add-row").click();
    const row = this.root.locator('[data-testid^="material-row-"]').last();
    await expect(row.locator(".row-number")).toHaveText(String(n));
    const id = (await row.getAttribute("data-testid"))!.slice(
      "material-row-".length,
    );
    await row.getByTestId(`row-code-${id}`).fill(`NEW-${n}`);
    await row.getByTestId(`row-name-${id}`).fill(`新增物料 ${n}`);
    return id;
  }
  async rowsCount(n: number) {
    if (n === 1) {
      await this.field("row-delete-row-002").click();
      await this.page
        .getByRole("button", { name: "确认删除", exact: true })
        .click();
    }
    for (let i = 3; i <= n; i++) await this.addRow(i);
  }
}
export async function toggle(locator: Locator, value: boolean) {
  if (((await locator.getAttribute("aria-checked")) === "true") !== value)
    await locator.locator("..").locator(".el-switch__core").click();
  await expect(locator).toHaveAttribute("aria-checked", String(value));
}
export async function numberInput(locator: Locator, value: string | number) {
  await locator.fill(String(value));
  await locator.press("Tab");
}
