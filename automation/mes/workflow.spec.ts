import { test } from '@playwright/test';
import { loadMesCases } from './cases';
import { executeMesWorkflowCase } from '../pages/mes-workflow';

// 收集阶段校验全部用例；错误配置不会启动浏览器。
for (const scenario of loadMesCases().cases) {
  test(`${scenario.id} ${scenario.title}`, {
    annotation: { type: 'mes-case', description: JSON.stringify(scenario) },
  }, async ({ page }, info) => {
    await executeMesWorkflowCase(page, scenario, info);
  });
}
