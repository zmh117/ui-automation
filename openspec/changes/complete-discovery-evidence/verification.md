# 四类发现缺口验收记录

日期：2026-10-11。环境：macOS arm64，Node.js v22.14.0，Playwright 1.63.0，系统 Chrome（headless），本项目 Vue/Vite 服务 `http://127.0.0.1:5173/`。

本次为本项目受控实例的实际浏览器验收，不是实际 MES、数据库、Redis 或设备联调验收。

## 结果

| 检查 | 实际结果 |
|---|---|
| `npm --prefix packages/config-enumerator run test:discovery` | **25/25 通过**；12 项新增发现/导航检查 + 13 项原六页发现回归 |
| `npm --prefix packages/config-enumerator test` | **24/24 通过**；枚举核心与原 CLI 回归 |
| `npm --prefix playground run build` | 通过，含 Vue 类型检查及两个 HTML 入口；保留已有主包超过 500 kB 的体积提示 |
| `npm --prefix automation run typecheck` | 通过 |
| `npm run ui:plan` | **2453 条**，与原六页分组执行范围一致；本轮只列清单，没有执行这 2453 条 |
| 新实例发现 CLI | 退出码 0，10/10 场景完成，21 快照、24 候选字段 |
| `openspec validate complete-discovery-evidence --strict` | 通过 |
| `git diff --check` | 通过 |

## 浏览器证据

- **弹框**：scope 外两层 Teleport 均采集；记录入口、父弹框和隐藏到可见转换。同名无关弹框未混入。打开模态实例后原编辑器变为 inert，关联弹框继续被扫描。已可见目标、歧义定位和非弹框根分别被拒绝。
- **选项**：原生集合 3/3 和自定义集合 5/5 标为 complete；分页 2/5、虚拟片段 3/100 标为 partial；无总量依据的 2 项标为 unknown。远程未完成为 partial，完成后 5/5 为 complete。另验证矛盾 ARIA、加载中的原生 select、选项截断不会误标完整。测试通过暂停目标 GET 请求控制远程未完成状态，不依赖电脑速度。
- **文档边界**：初始编辑器采集 7 个文档，含同 URL 兄弟 Frame、二层 Frame、跨源 Frame 和 Shadow 内 Frame。主文档、Frame 及嵌套开放 Shadow 共 13 个同名字段保留独立身份；自动生成路径与手写路径归一后不重复建模。闭合根内部未扫描，报告明确限制。
- **路径复用**：实际按 report 中的 Frame/Shadow 路径重新进入并读取控件、弹框和单元格；结构性地址也能回到当次元素。Frame 内弹框、Shadow 内弹框及两者组合均测试；正式模型映射保留上下文。
- **单元格**：称重显示 `12.30 kg`、业务值数值 `12.3` 独立保留，隐藏旧值 `999` 不混入；ARIA grid 温度显示 `20.0 °C`、业务值 `20`。未声明业务值保持 unknown，单元格没有成为枚举字段。显示截断被标记。
- **边界与只读**：Frame/Shadow/单元格/选项预算限制、失效扫描区域、旧版计划和报告拒绝均验证。发现前后 storageState 一致，无非读取 HTTP 请求；原 A/B/C/D 业务值及展开前后配置值不变。导航至新页面再返回，原配置草稿保留、验证弹框已清理。
- **原六页**：仍为 12 场景、20 快照，11 场景完成。默认禁用的变量入口为 blocked，符合只展开指定可用入口的边界，不为了发现隐藏字段而切换业务单选。

## 可复核产物

最终报告目录（运行产物由 Git 忽略）：

`packages/config-enumerator/output/discovery-evidence-20261011-final/`

- [中文发现报告](../../../packages/config-enumerator/output/discovery-evidence-20261011-final/report.md)
- [JSON 证据](../../../packages/config-enumerator/output/discovery-evidence-20261011-final/report.json)
- [候选模型](../../../packages/config-enumerator/output/discovery-evidence-20261011-final/draft-model.json)
- [默认未确认模板](../../../packages/config-enumerator/output/discovery-evidence-20261011-final/review-template.json)

报告指纹：`2bac473fdf13b2a8ce964684386e03cf62c12dd2df6dd0911b8e8e9a457a0834`。

复现方式：

```bash
# 终端一，在项目根目录
npm --prefix playground run dev
# 终端二，在项目根目录
npm --prefix packages/config-enumerator run build
npm --prefix packages/config-enumerator run test:discovery
cd packages/config-enumerator
npm run discover -- --plan examples/discovery-evidence.json --out output/my-evidence
```

输出必须使用尚不存在的新目录。计划与报告为 schemaVersion 2，旧发现数据不做兼容；枚举核心格式未变化。

## 限制

`completed` 只说明指定计划执行完成。选项的 complete 只针对当前 DOM/ARIA 声明集合，不证明业务全集；分页、搜索和虚拟数据仍需受控值域或单独遍历。虚拟示例是本项目的分段 DOM 受控实例，未验证 Handsontable 等第三方表格。闭合 Shadow、Canvas 内部、像素级显示和真实业务正确性不在本次通用发现能力内。

本次没有重跑 2453 条全量 UI 执行或 PICT 冒烟；旧全量执行中的已知业务失败不能由发现测试通过宣称修复。没有提交或推送代码；用户原有未跟踪方案文档保留。
