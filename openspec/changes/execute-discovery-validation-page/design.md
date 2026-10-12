## Context

现有执行目录为六页 2453 条分组全量及操作场景，PICT 从相同目录生成合法 n-way，再补违规代表和全部有限样本。新页没有保存能力，列表没有选中处理；本轮以实际可操作语义建模，不复制保存断言。

## Goals / Non-Goals

**Goals:** 新页的分组全量及 PICT 复用同一执行器；正常 UI 操作与独立预期；可读中文结果和范围准确的完成状态。

**Non-Goals:** 不增加新页业务功能、不遍历无限文本、不把闭合根或列表未实现的选择/确认当成功，不更改原六页规则。

## Decisions

1. 六组有限模型：输入和原生单位、两层弹框退出、开放 Shadow 编辑、Frame 编辑、列表展开/翻段、发现入口/采集预算。明确样本见 coverage-review.md；组间不相乘。
2. 通过 Playwright 标准 fill/click/selectOption 执行。Frame/Shadow 入口复用精确地址解析，UI 预期来自固定场景规格，不能从发现器输出推导期望。每例独立上下文；不通过 evaluate 修改 DOM、Vue 或 localStorage。
3. 页面级 `--scope discovery` 在 Playwright testMatch 处限定独立文件。PICT 从该范围完整目录生成，生成和执行共享范围及版本；默认 all 包含原六页及新页。不用 grep 冒充页面完整目录。
4. 报告增加 catalogScope 与 pageCoverageComplete，全项目 coverageComplete 仅在全部目录执行时成立。PICT 对当前所选范围声明 smokeComplete，保留 n-way 元组核验。
5. 报告收尾采集 Frame/Shadow 的字段和显示证据，错误时收尾采集不能遮盖原失败。中文场景说明、输入、步骤、截图和 trace 沿用原设施。
6. 实跑新页全量、2-way、3-way；生成全部页面清单核对旧 2453 条仍存在。远程成功访问项目真实 GET；加载延迟和错误分支以受控请求明确标记。

## Risks / Trade-offs

- 选项展示被误当可选择配置 → 明确只检查列表窗口，不声明保存或选择完成。
- 多 Frame 同名字段定位串扰 → 每例填写后核对其他 12 个同名字段未变，保留完整地址。
- 单页成功被误报全项目成功 → 独立范围标识和完成字段，并对中文总结做回归测试。
- 虚拟列表声明总量不等于当前展示数据 → 只验证指定窗口与 partial 标记，不推断全部 100 项可达。
- 原系统已知失败 → 本轮执行新增页；原六页只核对目录和必要回归，不宣称旧失败已修复。
- 原生下拉菜单不能等同于 DOM 控件点击 → kg/g 用 selectOption 实际执行，禁用 t 读取原生 disabled 与 selected 属性。当前本机无头 Chrome 的按键探针没有改变值，selectOption 却可设置 t；禁止据此注入非法值或把超时当成 UI 拒绝，报告明确未验证系统菜单点击拦截。
