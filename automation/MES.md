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
| `schemaVersion` | 固定为 1 |
| `cases` | 指定用例清单，每项有唯一 `id` 和 `title` |
| `url` | 当前测试数据的工作流入口 URL，必须为 HTTP(S) |
| `framePath` | 可选，按外到内进入 iframe 的地址；进入后执行 `open` |
| `open` | 可选，一组 `{target, expected}`；正常点击打开入口/切换页签，然后等待指定区域可见 |
| `workflow` | 唯一可见的画布地址，不能使用某个节点数字代替画布作用域 |
| `node` | 名称/类型，及可选前驱/后继条件；不接受动态 `id` |
| `expectedPanel` | 点击后预期的唯一可见配置面板 |
| `checks` | 至少一项独立预期，每项 `{target, kind, expected}`，目标必须属于该面板 |

每个地址使用 `{ "selector": "...", "shadowPath": ["..."] }`。`shadowPath` 可省略；可从本轮发现 JSON 提取这两个字段，或使用发现器的 `anchor=` 业务关联地址。不要整段复制 `locator` 的 `basis/unique/reason` 元信息。相同短名的多个可见实例必须增加业务区域限定，不使用 `.first()`、位置索引或固定动态 ID 兜底。

`checks.kind` 支持 `value`（真实 input/textarea/select 的字符串）、`checked`（真实 checkbox/radio 的布尔值）、`text`（可见文本，空白归一后精确比较）。`expected` 来自确认的业务规则或测试输入，不能直接拷贝本次采集实际值当作预期。当前工作流 JSON 用于匹配和关系分析；Handsontable 的值、格式、合并关系仍由 [专用读取器](../packages/config-enumerator/HANDSONTABLE.md) 提供，两者不互相替代。

例如打开某个页签后等待画布：

```json
"open": [
  {
    "target": { "selector": "[data-testid=\"已核对的工作流页签\"]" },
    "expected": { "selector": "[data-testid=\"ebr-pi-workflow-canvas\"]" }
  }
]
```

`open` 只用于经核对的入口与页签，勿配置保存、提交或删除按钮。用例从 URL 指向的数据开始；本工具不会创建配方，也不会猜测菜单路径。需要复杂前置步骤时，在普通 Playwright 用例中用正常 UI 准备页面，再调用 `openMesWorkflowNode(frame, workflow, node, expectedPanel, checks, info)`。

## 执行与证据

单 worker、零重试，每条用例使用独立上下文。每次动作重新采集当前 JSON，按名称/类型及相邻关系匹配；ID 全部重建仍使用相同业务查询。同名无法消歧、重复/缺失 ID、隐藏节点或未知连接会停止点击。字段异步变化仅轮询读取，不重复点击。

每次在 `automation/output/<时间戳>-<唯一编号>/` 输出：

- `plan.json`、`invocation.json`：实际选中的用例与调用范围。
- `results.jsonl`、HTML 附件：独立预期、点击前 JSON、匹配节点、面板实际值；失败后再次采集的 JSON 明确标为失败现场。
- `summary.json`、`中文测试报告.md`：计划、尝试、通过、失败、未运行统计。`coverageComplete` 只表示本次选中用例均已执行，`allPassed` 才表示全部通过；计划模式两者都为 false。`--grep` 筛选会标为 `filtered-mes-cases`。
- 失败截图与 trace；任何失败返回非零退出码。

重名或数据错误不会自动换一个节点继续。报告可能包含当前业务名称/表单值，请在项目本地保留。这里只证明指定 UI 行为，不能证明后端持久化、设备行为或全系统覆盖。

## 本地验证

```bash
npm --prefix automation run typecheck
npm --prefix automation run test:mes-adapter
```

验证使用隔离的本地测试页面和临时 HTTP 服务，覆盖动态 ID 重建、关系消歧、重复短名、Frame/Shadow、独立预期失败、正式 runner 的计划/执行/错误报告。读取器的真实 EBR Vue 模板回归见 `packages/config-enumerator` 的 `test:workflow`。本机没有业务后端，这些测试不是 EBR/JTH 真实业务联测。
