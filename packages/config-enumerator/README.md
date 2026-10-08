# 全量配置枚举器

独立 TypeScript/ESM 包：接收有限字段模型，逐条枚举**全部候选组合**，分类合法与非法并列出所有违规原因。核心零运行时依赖，不导入 Vue、DOM、Element Plus 或 Node 模块。

核心入口只生成配置候选；新增可选 [页面发现模块](DISCOVERY.md)，读取实际网页并按指定入口展开下拉、标签页、弹框，输出候选模型，确认后接入枚举。仍不生成完整业务操作路径，不执行配置用例，不保存配置或写入应用存储。PICT 留作后续冒烟候选集生成。

本项目另有 [六页 UI 执行工程](../../automation/README.md)，复用本包的 `createEnumeration`，按用户确认的分组模型生成并实际执行配置、记录断言与失败证据。运行入口是根目录 `npm run test:ui`；本包的 `enumerate` / `discover` 命令职责不变。

已完成的本地验证与边界见 [验收记录](VERIFICATION.md)。

## 本地运行

从本目录执行：

```bash
npm ci
npm test
mkdir -p output
npm run enumerate -- --model examples/abcd.json --out output/abcd-full
```

`npm test` 会先构建；也可单独执行 `npm run build`。每次导出使用新的目录，已有结果不会被覆盖。

结果包含：

| 文件 | 内容 |
|---|---|
| `model.json` | 本次模型快照 |
| `cases.jsonl` | 每行一条完整候选，含取值、合法性及违规规则 |
| `manifest.json` | 精确总数、生成计数、完成状态、模型/候选文件 SHA-256 |

`abcd.json` 应产生 16 条：9 合法、7 非法。`other-vue-form.json` 是独立的通用表单示例，应产生 48 条：30 合法、18 非法；它的示例规则不代表现有 MES 业务规则。

```bash
npm run enumerate -- --model examples/other-vue-form.json --out output/other-form-full
# 只输出 3 条，退出码为 2，清单明确未完成
npm run enumerate -- --model examples/abcd.json --out output/abcd-partial --max-cases 3
```

退出码：0 完整导出；2 达到数量预算；130 收到中断；1 参数、模型或 I/O 错误。Ctrl+C 会尽量写出未完成清单；断电或强制终止没有清单时不得视为完成。`summary.complete` 仅表示算法生成完成，文件导出还需检查 `exportComplete`；二者均不表示测试通过。

## 接入其他 Vue 项目

先构建此包，然后在另一个项目中本地安装：

```bash
npm install /Users/mhz/Develop/mes_UI自动化项目/packages/config-enumerator
```

也可在本包运行 `npm pack`，将生成的 `.tgz` 安装到其他机器或项目；无需发布到 npm。包为 ESM，核心使用 BigInt，适用于支持现代 ESM 与 BigInt 的浏览器和构建环境。CLI 需要 Node 20.19 或以上。

```ts
import { createEnumeration } from '@mes-ui/config-enumerator'
import model from './my-form-model.json'

const run = createEnumeration(model)
console.log(run.getSummary().totalCandidates) // 尚未生成即可知道精确总数

for (const candidate of run.cases) {
  console.log(candidate.values, candidate.classification, candidate.violations)
  // 后续路径生成器在这里消费，不要一次缓存巨大组合集。
}

console.log(run.getSummary())
```

`examples/EnumeratorDemo.vue` 和 `examples/other-vue-form.json` 可以一起复制进另一个 Vue 3 项目的同一目录，作为可运行组件。算法不使用 Vue 生命周期，其他 Vue 版本可用对应组件写法调用相同 API；不保证旧版构建器或不支持 BigInt 的浏览器兼容。

小模型可直接消费；大型模型在 Web Worker 或 Node 中运行，分批传递结果。迭代器本身是同步的，`async` 包一层不会自动避免主线程阻塞。UI 预览截断也必须显示未完成，不能把前 1000 条称作全量。

## 模型格式

```json
{
  "id": "checkbox-example",
  "version": "1",
  "fields": [
    { "id": "A", "label": "选项 A", "values": [false, true] },
    { "id": "B", "label": "选项 B", "values": [false, true] }
  ],
  "rules": [{
    "id": "A_B_EXCLUSIVE",
    "message": "A 和 B 不能同时选中",
    "when": { "op": "eq", "field": "A", "value": true },
    "assert": { "op": "eq", "field": "B", "value": false }
  }]
}
```

- `fields` 非空，每个 `values` 是有限、非空、无重复的 JSON 值数组；无约束时 `rules: []`。
- `id` 使用字母/下划线开头的稳定标识，可包含数字、点和连字符；中文显示名放 `label`。点是标识的一部分，不是嵌套属性访问语法。
- `when` 可省略；省略时无条件检查 `assert`。当 `when` 为真而 `assert` 为假时，该规则违规。所有规则都会被检查，顺序不决定优先级。
- 模型字段/规则拼写错误、空值域和未知字段引用会抛出带路径的 `ModelValidationError`；业务非法候选正常输出。
- `values` 支持布尔、数字、字符串、null、数组及普通 JSON 对象。数字不自动转换字符串。NaN、Infinity、undefined、Date、函数、循环引用等拒绝；时间先转换为明确格式的字符串。
- 数字遵循 JavaScript Number 精度；超过安全整数范围的业务编号请使用字符串，避免读取 JSON 时已丢失精度。
- 对象比较忽略属性排列顺序，数组比较保留顺序。若多选业务按集合处理，应在模型中统一排列选项，不同时把不同排列当作两个候选。
- 数字和文本先选定边界/典型样本。多选若有 N 个独立选项，要么拆成 N 个布尔字段，要么在 `values` 中明确提供全部合法及非法目标子集；只提供空/单选/全选不代表全部子集覆盖。
- 日期时间候选与其他 JSON 值一样被枚举，不自动判断真实日期、业务时区或时间先后；相关业务规则需显式建模，无法表达的规则不要声称已验证。
- 被禁用但保留值的字段不自动丢弃；候选代表完整目标取值，是否可通过 UI 达到由后续路径层验证。

支持的条件：

| 运算符 | 属性 | 语义 |
|---|---|---|
| `eq` / `neq` | `field`, `value` | JSON 类型及结构相等 / 不等 |
| `in` | `field`, `values` | 属于非空候选集合 |
| `lt` / `lte` / `gt` / `gte` | `field`, 数字 `value` | 数值比较；字段值非数字时结果为假 |
| `includes` | `field`, `value` | 数组中存在该 JSON 值；不用于字符串子串 |
| `length` | `field`, `min` 和/或 `max` | 字符串 Unicode 码点数或数组项数的闭区间；其他类型为假 |
| `all` / `any` | 非空 `conditions` | 所有 / 至少一个条件成立 |
| `not` | `condition` | 条件取反 |

例如必填且最多 100 字符：`{"op":"length","field":"name","min":1,"max":100}`。这只检查长度，空格是否算空值、Unicode 字素簇如何计数等规则需另行定义，不隐式修剪或格式化输入。`not` 是布尔取反，若需同时要求数字类型，可用 `all` 包含数值上下限。

## 输出与后续执行

```json
{
  "id": "checkbox-linkage@1#15",
  "ordinal": "15",
  "values": { "A": true, "B": true, "C": true, "D": false },
  "classification": "invalid",
  "violations": [
    { "ruleId": "A_B_EXCLUSIVE", "message": "A 和 B 不能同时选中" },
    { "ruleId": "C_REQUIRES_D", "message": "选中 C 时必须选中 D" }
  ]
}
```

这表示一条应尝试验证规则的非法目标，不表示浏览器必须成功进入这个状态，也不表示测试失败。后续操作层根据规则标识生成正常 UI 的禁用、联动或保存校验断言；一条候选可能对应多条路径。本包不使用 `force` 点击、不注入存储、不推断期望错误文案。

枚举按字段声明顺序、候选声明顺序进行，末字段变化最快；同模型得到相同顺序和标识。修改字段、候选顺序或规则必须更新 `version`，因为标识依赖版本和顺序号。CLI 额外保存模型指纹；跨模型比较时应同时核对指纹，不能只比较 id。

## 计数、预算与取消

```ts
const controller = new AbortController()
const run = createEnumeration(model, {
  maxCases: 10000, // 可传正 bigint；省略即不设数量预算
  signal: controller.signal,
})
for (const candidate of run.cases) {
  consume(candidate)
  if (shouldStop()) controller.abort() // 在下一次迭代检查
}
console.log(run.getSummary())
```

汇总中的 `totalCandidates/generated/valid/invalid/remaining` 为十进制字符串，避免超过 JavaScript 安全整数后失真。状态为 `ready/running/completed/limited/cancelled`；`break` 会关闭迭代器并记录取消。手动调用 `next()` 后暂不继续属于挂起的运行，应显式 `return()` 结束。开始前从未消费的生成器仍为 `ready`。

`cases` 只消费一次；再次运行请新建 `createEnumeration`。模型和输出数据隔离，外部修改不会改变后续候选。总量为各字段候选数的乘积，算法没有按合法性过滤，也没有自动降级为 PICT 或随机采样。

空间开销与模型和单条候选大小相关，不随已生成用例数累积；枚举运行时间仍随候选总数增长。规则表达能力保持有限，当前不支持远程接口查询、任意脚本和字段间算术求值。
