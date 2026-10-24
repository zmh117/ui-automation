# MES 工作流自动化

正式入口已接入新的短 `data-testid` 和当前工作流 JSON。它验证指定工作流节点的定位、打开配置面板及独立预期；不自动生成保存、审核、签名或生产执行操作。原有练习站全量/冒烟命令不变，MES 结果单独统计。

## 运行

首次安装依赖见 [automation README](README.md)。更新本项目后先构建读取器：

```bash
# 在项目根目录运行
npm --prefix packages/config-enumerator run build

# 复制示例，再修改真实地址、入口、业务节点条件和独立预期
cp automation/mes/cases.example.json automation/mes/cases.local.json

# 校验并列计划，不打开浏览器、不访问 MES
npm run ui:mes:plan -- --cases automation/mes/cases.local.json

# 执行；也可用 npm run test:ui -- --suite mes --cases ...
MES_STORAGE_STATE=automation/.auth/mes.json \
  npm run test:ui:mes -- --cases automation/mes/cases.local.json --headed
```

`MES_STORAGE_STATE` 可省略。需要登录时，使用你为测试环境导出的 Playwright storageState 文件；它不是日常 Chrome 会话，也不包含 sessionStorage。如果目标系统的认证依赖 sessionStorage 或需要专门登录步骤，应在业务测试中通过正常登录 UI 准备上下文后调用页面适配器；当前 JSON 入口不内置该系统的登录流程。登录失效会按页面无法就绪失败，不会自动登录或跳过断言。`.auth/` 和 `mes/*.local.json` 已忽略，勿提交真实会话数据。

示例的 `.invalid` 地址是占位，节点名称及前后关系也是示例业务数据，必须按真实测试配方核对。画布、面板、输入短名对应目前 EBR PI 编辑页的命名合同；其他业务入口可能不同，以重新采集的 JSON 为准。JTH 页面只有提供相同 `data-workflow` 元数据时才能使用此工作流套件，普通页面仍使用原有发现/控件接口。

## 用例字段

| 字段 | 含义 |
|---|---|
| `schemaVersion` | 固定为 2；旧版须补齐需求与步骤信息后再运行 |
| `cases` | 指定用例清单，每项有唯一 `id` 和 `title` |
| `requirements` | 至少一条 `{id, version, text}`，填写真实需求编号、版本与正文；同编号同版本不得出现冲突正文 |
| `url` | 当前测试数据的工作流入口 URL，必须为 HTTP(S) |
| `framePath` | 可选，按外到内进入 iframe 的地址；进入后执行 `open` |
| `open` | 可选，一组 `{id, title, target, expected, requirementIds?}`；正常点击打开入口/切换页签，然后等待指定区域可见 |
| `workflow` | 唯一可见的画布地址，不能使用某个节点数字代替画布作用域 |
| `node` | 名称/类型，及可选前驱/后继条件；不接受动态 `id` |
| `expectedPanel` | 点击后预期的唯一可见配置面板 |
| `checks` | 至少一项独立预期，每项 `{id, title, requirementIds, target, kind, expected}`，目标必须属于该面板；需求引用必须存在且非空 |

每个地址使用 `{ "selector": "...", "shadowPath": ["..."] }`。`shadowPath` 可省略；可从本轮发现 JSON 提取这两个字段，或使用发现器的 `anchor=` 业务关联地址。不要整段复制 `locator` 的 `basis/unique/reason` 元信息。相同短名的多个可见实例必须增加业务区域限定，不使用 `.first()`、位置索引或固定动态 ID 兜底。

`open` 与 `checks` 的步骤 id 在同一用例内不得重复。基础导航、Frame、节点定位等系统步骤使用 `$` 前缀；用户步骤编号不允许该前缀。导航/等待本身不自动算作满足某条需求，未显式关联的基础步骤 `requirementIds` 为空。示例文件的需求编号和正文仅用于演示，运行真实环境前须替换，程序不会从 discover 的观察值编造需求。

`checks.kind` 支持 `value`（真实 input/textarea/select 的字符串）、`checked`（真实 checkbox/radio 的布尔值）、`text`（可见文本，空白归一后精确比较）。`expected` 来自确认的业务规则或测试输入，不能直接拷贝本次采集实际值当作预期。当前工作流 JSON 用于匹配和关系分析；Handsontable 的值、格式、合并关系仍由 [专用读取器](../packages/config-enumerator/HANDSONTABLE.md) 提供，两者不互相替代。

例如打开某个页签后等待画布：

```json
"open": [
  {
    "id": "open-workflow-tab",
    "title": "打开工作流页签",
    "target": { "selector": "[data-testid=\"已核对的工作流页签\"]" },
    "expected": { "selector": "[data-testid=\"ebr-pi-workflow-canvas\"]" }
  }
]
```

`open` 只用于经核对的入口与页签，勿配置保存、提交或删除按钮。用例从 URL 指向的数据开始；本工具不会创建配方，也不会猜测菜单路径。完整轨迹通过标准 `executeMesWorkflowCase(page, scenario, info)` 生成。直接使用底层 `openMesWorkflowNode` 仅提供原有节点/断言附件，不能把调用前的自定义操作冒充已记录路径。

## 执行与证据

单 worker、零重试，每条用例使用独立上下文。每次动作重新采集当前 JSON，按名称/类型及相邻关系匹配；ID 全部重建仍使用相同业务查询。同名无法消歧、重复/缺失 ID、隐藏节点或未知连接会停止点击。字段异步变化仅轮询读取，不重复点击。

每次在 `automation/output/<时间戳>-<唯一编号>/` 输出：

- `plan.json`、`invocation.json`：实际选中的用例、需求原文与版本、完整步骤计划及调用范围。
- `execution.json`：整次运行的 Agent 分析入口，包含每个用例的需求、逐步执行、操作路径、实际/预期、时间和证据索引；计划/未执行用例也有明确状态。
- `results.jsonl`、HTML 附件：逐用例业务轨迹、Playwright 嵌套步骤、独立预期、点击前 JSON、匹配节点和面板实际值；失败后再次采集的 JSON 明确标为失败现场。JSON 中的附件路径相对于本次报告目录。
- `artifacts/.../mes-execution-<执行编号>.json`：每次执行实例独立的过程记录，每步开始、动作发出/完成及结束时落盘；浏览器或进程异常退出后可能保留 `running`，不能认为完成。
- `summary.json`、`中文测试报告.md`：计划、尝试、通过、失败、未运行统计。`coverageComplete` 只表示本次选中用例均已执行，`allPassed` 才表示全部通过；计划模式两者都为 false。`--grep` 筛选会标为 `filtered-mes-cases`。
- 成功与失败都保留收尾截图和 trace；每步前后另外保存只读结构化状态。截图并非该步前后瞬间，结合时间和 trace 回查；任何失败返回非零退出码。

重名或数据错误不会自动换一个节点继续。报告可能包含当前业务名称/表单值，请在项目本地保留。这里只证明指定 UI 行为，不能证明后端持久化、设备行为或全系统覆盖。

### Agent 对照所需字段

`execution.json` 的 `cases[]` 以 `caseId` 对应业务用例，`id` 是 Playwright 测试标识；`requirements[]` 为需求版本快照。`execution.steps[]` 是完整计划及执行结果：

| 字段 | 解释 |
|---|---|
| `id / sequence / title / action` | 稳定步骤编号、顺序、用例定义的名称与动作类型 |
| `requirementIds` | 显式关联需求；空列表不代表业务需求已覆盖 |
| `status` | `not-run`、`running`、`passed`、`failed`、`interrupted` |
| `startedAt / finishedAt / durationMs` | 实际步骤时间；未执行或未结束时保留 null |
| `before / after` | 各自采集时间、页面和 Frame URL、Frame 路径，以及相关目标的 Shadow 地址、文字、值、选中/禁用状态；文本最多 500 字符并标记截断 |
| `target / expected` | 来自用例的目标与独立预期，不能当作实际执行结果 |
| `actual` | 当步实际结果；节点定位包含当前完整工作流和匹配节点，断言保留最后一次实际读数 |
| `actionAttempted / actionCompleted` | 动作是否开始尝试、API 是否返回完成；false 表示未记录完成，不证明动作未生效，也不代表业务成功，不能据此再点击一次 |
| `observations` | 断言轮询的只读观察次数，不是业务动作重试次数 |
| `error` | 当步原始错误，采集缺口不会覆盖它 |

`execution.operationPath` 只包含已开始的步骤，按顺序引用步骤编号及当时 URL/Frame；步骤标题和目标来自用例，真实匹配对象与结果仍看对应 `steps[].actual` 和状态证据。失败后的剩余步骤为 `not-run`，不进入实际路径。

状态目标为 `not-visible-or-absent` 只表示当前没有唯一可见目标，不能据此区分未渲染与隐藏。重复定位、关闭页面等采集失败标为 `unavailable`；截断/采集失败导致 `evidenceComplete: false`。密码/验证码输入不采集值。`businessVerdict: "not-inferred"` 表示程序没有自动判断整个需求是否成立。

单选/复选框没有显式原生 `value` 属性时，保留 `value: null / valueKnown: false`，不把浏览器默认的 `on` 或 test ID 后缀当成业务值；选中状态另由 `checked` 记录。普通输入保留原始字符串，包括前后空格。

可将 `execution.json` 和需求文档交给 Agent，要求按“需求编号 → 用例编号 → 步骤编号”报告：预期、实际、证据位置，以及“明确不符 / 漏步骤或断言 / 证据不足”。Agent 应核对需求版本，不把 not-run 说成已执行，不从采集值生成预期，不把 UI 通过说成数据库或设备验收。程序本次只产出证据，不调用外部 Agent。

旧 schemaVersion 1 不做兼容转换。成功 trace 会增加磁盘占用，归档时保留整个运行目录（包含 artifacts）；本功能不删除历史报告。强制结束整个进程时只承诺最近已落盘的步骤，若 reporter 未运行则没有完整汇总；正常 reporter 会将未结束的记录标为 `interrupted`。

## 本地验证

```bash
npm --prefix automation run typecheck
npm --prefix automation run test:mes-adapter
```

验证使用隔离的本地测试页面和临时 HTTP 服务，覆盖动态 ID 重建、关系消歧、重复短名、Frame/Shadow、独立预期失败、正式 runner 的计划/执行/错误报告。读取器的真实 EBR Vue 模板回归见 `packages/config-enumerator` 的 `test:workflow`。本机没有业务后端，这些测试不是 EBR/JTH 真实业务联测。
