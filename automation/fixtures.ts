import { test as base, expect } from "@playwright/test";

export const test = base.extend<{ observation: void }>({
  observation: [
    async ({ page }, use, info) => {
      await use();
      if (page.isClosed()) return;
      // 仅观察，禁止向 DOM、Vue 或存储写入值来帮助用例通过。
      const actual = await page.evaluate(() => ({
        url: location.href,
        fields: Array.from(
          document.querySelectorAll<HTMLInputElement>("input,textarea,select"),
        ).map((e) => ({
          id: e.id || e.getAttribute("data-testid"),
          type: e.type,
          value: e.type === "file" ? (e.files?.[0]?.name ?? "") : e.value,
          checked: e.checked,
          disabled: e.disabled,
        })),
        saved: localStorage.getItem("mes-interaction-lab:v1"),
      }));
      await info.attach("实际页面与保存状态", {
        body: JSON.stringify(actual, null, 2),
        contentType: "application/json",
      });
    },
    { auto: true },
  ],
});
export { expect };
