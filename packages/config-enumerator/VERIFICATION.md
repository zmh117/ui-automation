# 本地验收记录

日期：2026-10-06（Asia/Shanghai）。范围：全量配置枚举包、命令行与独立 Vue 3 接入；不代表真实 MES UI 测试通过。

## 算法与导出

`npm test` 已通过 24 项 Node 内置测试，包括：

- A/B/C/D 的 16 种布尔组合按固定顺序全部出现，9 合法、7 非法；`A=true,B=true,C=true,D=false` 同时记录两条违规。
- 独立三重循环对照 36 种不同值域规模，检查没有遗漏、重复或顺序偏差。
- 70 个布尔字段总数为 `1180591620717411303424`，预算 3 条时仅生成 3 条并报告未完成。
- 条件、逻辑、数值边界、Unicode 长度、数组成员和对象结构比较，不做隐式类型转换。
- 原模型与输出值修改隔离；格式错误提前拒绝；取消、提前结束、预算等于总量等完成性边界。
- 完整 CLI 导出退出码 0；预算导出为 2；SIGINT 为 130；错误模型或写入失败为 1。
- CLI 文件写入故障注入只作用于测试进程文件输出，验证生成数与写入数分别报告；没有向练习站注入数据。
- 已存在目录不被覆盖；模型和 JSONL 的 SHA-256 与实际字节一致。

实际导出结果：

| 模型 | 候选 | 合法 | 非法 | 清单 |
|---|---:|---:|---:|---|
| A/B/C/D | 16 | 9 | 7 | [manifest.json](output/abcd-full/manifest.json) |
| 独立表单（单选、数字、多选、时间样本） | 48 | 30 | 18 | [manifest.json](output/other-form-full/manifest.json) |

结果是本地生成产物，位于忽略的 `output/` 下；新环境按 README 命令重建。后续若改模型，使用新的版本和输出目录。

## 独立 Vue 接入

1. `npm pack` 生成独立 tarball。
2. 在临时目录建立另一个 Vue 3 / Vite 项目，通过 tarball 安装包，未引用练习站源码。
3. 将交付的 `EnumeratorDemo.vue` 和 `other-vue-form.json` 复制进去；`vue-tsc --noEmit && vite build` 通过。
4. 安装后的 `config-enumerate --help` 正常运行，证明命令行入口随包可用。
5. Chrome 通过 Playwright 点击“生成全量配置”，页面显示“候选 48 · 已生成 48 · 合法 30 · 非法 18”和“全量枚举完成”。逐行读取 48 行取值并以独立业务表达式核对分类，全部符合。

浏览器截图：[独立 Vue 结果](../../output/playwright/enumerator-independent-vue.png)。临时验证页只出现 favicon.ico 的 404，未观察到功能脚本错误。最初的沙箱 Chrome 启动失败，获得启动权限后完成上述验证。

## 项目检查

- 包 TypeScript 构建通过，核心入口没有 Vue 或 Node 运行时导入。
- 原练习站 `npm run build` 通过；仍有原有大于 500 kB 的 bundle 提示，本次没有修改练习站代码。
- `openspec validate --all --strict` 通过。
- 当前根目录不是 Git 仓库；使用文件检查核对变更，没有提交或发布。

## 边界

上一阶段的枚举核心由调用方提供模型；本次新增页面发现与确认转换，见下节。非法分类是配置目标的业务约束判断，不是 UI 测试失败；完整配置操作路径、Playwright 业务回归执行器、PICT 冒烟或绕过 UI 的业务数据测试仍未实现。Vue 2 与旧浏览器未实际验收；现代 ESM/BigInt 环境之外的兼容性不作承诺。

## 页面发现：本项目实例验收

日期：2026-10-06。使用本项目 `playground/`，地址 `http://127.0.0.1:5173/`，Playwright 1.63.0 + 本机 Chrome，独立上下文。没有复用用户浏览器会话，也没有修改练习站源码。

执行 `examples/playground-discovery.json` 的结果：

| 项目 | 结果 |
|---|---|
| 页面 | inputs、linkage、extended、dialogs、table、all 六页 |
| 入口场景 | 12 个，11 completed、1 blocked |
| 页面快照 | 20 份，无预算截断 |
| 候选字段 | 82 个路由内合并后的字段来源，包含全部组件页的重复展示，不是 82 个独立业务因子 |
| 未探索项 | “选择变量”默认禁用；没有切换单选、进入内层弹框或读取其列表 |
| 报告状态 | partial，CLI 退出码 2，符合限定入口预期 |

产物：

- [发现报告](output/playground-discovery-20261006/report.md)
- [完整快照与计划](output/playground-discovery-20261006/report.json)
- [待确认模型](output/playground-discovery-20261006/draft-model.json)
- [默认确认模板](output/playground-discovery-20261006/review-template.json)
- [13 项发现验收日志](output/discovery-test-20261006.tap)

发现集成测试 `npm run test:discovery`：**13/13 通过**。覆盖实际字段、下拉单/多选、日期时间、滑块去重、弹框场景隔离、禁止操作检查、预算、取消、错误定位、模型来源和确认门槛。补充原生组件页验证密码/验证码脱敏、ARIA/native radio 分组和选项截断，不替代真实项目验证。核心 `npm test`：**24/24 通过**，合计 37 项。

扫描前后 `context.storageState()` 相同，隔离上下文原本没有保存配置；没有通过保存或存储注入构造测试数据。A/B/C/D 均保持未选中，扩展页的既有字段值在展开后不变；未观察到非 GET/HEAD/OPTIONS 的 HTTP 请求。该结果证明本项目这些入口的行为，不等同于其他自动保存系统的无写入保证。

实际 DOM 核验修正了以下假设：Element Plus 的若干测试标识没有透传到 DOM；部分选择框的输入被显示内容覆盖，需点击外层交互容器；同 URL 导航不会清除已打开弹框，因此每场景重建文档。备注框通过 input 事件限制 100 个 Unicode 码点，不具有 maxlength 属性；这些规则没有被发现器自动批准。

### 发现结果接入全量枚举

只对用户此前确认过的 A/B/C/D 使用布尔值域和两个约束，其余字段仍待确认。四个字段来源实际发现报告，规则显式取自已确认的 `examples/abcd.json`。

- [ABCD 确认输入](output/playground-discovery-20261006/review-abcd.json)
- [正式模型](output/discovered-abcd-model/model.json) 与 [定位来源映射](output/discovered-abcd-model/mapping.json)
- [16 条候选](output/discovered-abcd-cases/cases.jsonl) 与 [导出清单](output/discovered-abcd-cases/manifest.json)

发现 → 确认转换 → 枚举 CLI 均实际运行，完整输出 **16 条、9 合法、7 非法**；manifest 中 `exportComplete=true`、`execution=not-performed`。没有把非法组合写入页面或存储，也没有宣称执行了这些配置用例。

包与练习站构建通过，练习站原有的 bundle 超过 500 kB 提示仍存在；`openspec validate --all --strict` 为 3/3 通过。复用方式、明确确认过程和 iframe/虚拟列表等限制见 [页面发现说明](DISCOVERY.md)。
