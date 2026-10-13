# 稳健定位验收记录

日期：2026-10-12。范围：主项目的页面发现、地址重放、去重和受影响的执行用例。

## 现场依据

只读分析 `现场使用/ui-automatic/` 中的发现实现与报告。最新 `packages/config-enumerator/output/mes-ebr-combo-9/report.json` 有 40 个快照、302 条控件观测，其中 108 条定位包含 `nth-*` 或 XPath 数字索引；部分虽标记 combo，仍依赖位置。还存在下拉外壳与内部 input 重复识别，以及无法唯一匹配时继续使用结构兜底的问题。

原现场材料完整保留，没有复制凭证、会话或执行生产登录脚本。本次夹具按现场实现与观测到的控件结构编写，属于脱敏本地复现，不是完整生产页面录制。

## 实现结果

- 稳定属性、精确语义和父子/兄弟关系生成地址，生成后回查唯一性与目标身份；不生成序号路径。
- 命名区域内的同名控件保持不同身份；新开同名弹框不改变原区域字段的地址。
- Element Plus/iView/md 的已知组件合并外壳和内部代理，独立子输入保持独立；单次扫描缓存，不复用重渲染前的 DOM。
- 扫描与执行使用同一解析内核，Frame 和开放 Shadow 上下文不丢失。地址多匹配时报错，不取第一个。
- 未定位控件在中文报告单列，不进入草稿或正式映射，发现状态为 partial。
- 现有执行用例移除 nth/first；月份按按钮关联，日期按开始/结束语义，时间通过明确输入和键盘操作。业务断言、保存与刷新验证保留。

## 验证结果

| 检查 | 结果 |
|---|---|
| `npm --prefix packages/config-enumerator test` | 24/24 通过；核心枚举与 CLI |
| `npm --prefix packages/config-enumerator run test:discovery` | 当前 40/40 通过；原有 25 项 + 定位 8 项 + 隐藏边界 7 项 |
| `npm --prefix automation run typecheck` | 通过 |
| `npm run test:ui -- --scope discovery --workers 2` | 212/212 通过，4.7 分钟 |
| 最后区域锚点调整后，`--scope discovery --grep 'discovery.observation\|behavior.discovery' --workers 2` | 所有调用发现内核的相关 UI 观察与操作用例 23/23 再次通过 |
| `--grep 'calendar-time-panels-clear\|extended.dates\|table.duplicates' --workers 2` | 日期区间与物料重复配置 26/26 通过；2 条日历操作最初失败，修复真实键盘方向及失焦关闭处理后单独重跑 2/2 通过 |
| `openspec validate robust-discovery-locators --strict` / `git diff --check` | 通过 |

新增测试覆盖：无唯一 ID、父子与兄弟关系、重复标签的区域限定、隐藏副本、组件去重、真实独立子输入、字段重排、插入同类型输入、重新渲染、动态 ID 变化、新开同名弹框、歧义拒绝、序号拒绝、开放 Shadow 默认 type 输入、匿名字段排除与跨快照合并。

## 可查看的产物

- [脱敏现场结构发现报告](../../../packages/config-enumerator/output/robust-locators-20261012/report.md)：19 个控件、15 个可靠地址、4 个刻意设计为不可区分的控件；4 个均排除，11 个字段进入候选草稿。
- [发现页 212 条中文测试报告](../../../automation/output/2026-10-12T12-43-24-664Z-8a1731fb/中文测试报告.md)。
- [最终观察内核 23 条中文测试报告](../../../automation/output/2026-10-12T12-51-17-070Z-bb8e2191/中文测试报告.md)。
- [日期区间与物料配置运行报告](../../../automation/output/2026-10-12T12-46-02-754Z-a80880e8/中文测试报告.md)：保留当时 2 条失败记录。
- [日历与时间操作修复后报告](../../../automation/output/2026-10-12T12-47-55-510Z-65970df5/中文测试报告.md)：2/2 通过。

以上 output 目录为本地运行产物，不提交 Git；测试代码与夹具可以重新生成证据。

## 现场重新使用

使用主项目更新后的源码，在 `packages/config-enumerator` 执行 `npm run build`。计划和报告升级为 `schemaVersion: 3`；旧报告、草稿与映射需重新生成。现场入口的序号/XPath 选择器必须换成稳定属性或语义关系，不能仅修改版本号后沿用旧序号。

示例命令：`npm run discover -- --plan examples/playground-discovery.json --out output/my-discovery-v3`。输出必须使用新目录。自定义项目仍需提供明确入口并确认值域与规则，发现结果不是完整执行脚本。

没有连接真实 MES 重跑；本地通过不能代表生产所有私有组件已覆盖。缺少任何可区分语义、闭合 Shadow 和 Canvas 仍需补充标识或适配，不以脆弱定位兜底。

## 隐藏元素补充验收

用户追加要求：隐藏元素，以及父元素隐藏的子元素，都不能被定位到。

修复前的真实浏览器反例确认了三个缺口：CSS/ID 返回隐藏目标、隐藏的重复 ID 干扰唯一性、已取得的跨源 Frame 在外层入口透明后仍能返回内部控件。现在 CSS 与关联定位每一步都先过滤可见性，再检查唯一性；Shadow 沿宿主和 slot 检查，Frame 经 Playwright 检查所有入口。不提供隐藏绕过开关。

`findElement` 对隐藏目标返回空；`waitElement` 等待目标与入口恢复可见，且共享同一个超时预算。弹框尚未打开时不匹配，展开后正常等待；模态弹框隐藏原编辑区时继续采集已关联的可见弹框。可见 disabled 字段保留。

- 7 项新增浏览器测试包括自身/多层祖先的 8 种隐藏方式、visibility 子元素覆盖、隐藏重复 ID、旧地址失效与恢复、隐藏关系锚点、Shadow/slot、跨源嵌套 Frame 和 Teleport。
- 全部发现测试 40/40 通过，构建与自动化类型检查通过。
- 本轮受影响的观察与操作 UI 用例 23/23 通过：[中文报告](../../../automation/output/2026-10-12T14-52-06-251Z-eada6faf/中文测试报告.md)。此前 212 条结果保留为上一轮证据，本轮未重跑不涉及发现内核的配置组合。
- 严格规格校验与差异检查通过；本轮仍为本地浏览器验证，没有连接生产系统。
