import { test as base, expect } from "@playwright/test";
import { captureDiscoveryEvidence } from "./pages/discovery";

export const test = base.extend<{ observation: void }>({
  observation: [
    async ({ page }, use, info) => {
      await use();
      if (page.isClosed()) return;
      // 仅观察，禁止向 DOM、Vue 或存储写入值来帮助用例通过。
      try {
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
        if (page.url().includes('/#/discovery')) await info.attach("Frame与Shadow现场证据", {
          body: JSON.stringify(await captureDiscoveryEvidence(page), null, 2), contentType: "application/json",
        });
      } catch (error) {
        await info.attach("收尾采集错误", { body: String(error), contentType: "text/plain" });
      }
    },
    { auto: true },
  ],
});
export { expect };
