# 当前工作流节点定位

测试只保存业务条件，不写死首次运行的 `node.basic.id`。每个工作流单独限定；不同工作流可以使用相同的节点数字。

## 前端合同

真实 EBR 的三个 MdNode 调用点使用 `node.basic.id`。画布提供 `data-workflow="mes"`；公共节点提供 `data-workflow-node-id`、`data-workflow-node-name`、`data-workflow-node-type`、`data-workflow-next`。后继数据仅导出 `shape.linkout[].id`，不导出业务表单或 Vue 私有状态。

读取器不执行页面操作、不滚动、不修改业务数据。只采集可见节点；存在隐藏节点、缺失/重复键、指向未观察节点的连接、预算不足或无效元数据时返回 `incomplete`，执行入口拒绝使用。

## 每次操作重新采集

```ts
import {
  clickWorkflowNode, readWorkflow, requireWorkflowNode,
} from '@mes-ui/config-enumerator/discovery';

// 已登录并由用例进入指定业务配方。此地址区分画布，不能用节点数字选择配方。
const workflow = { selector: '[data-testid="ebr-pi-workflow-canvas"]' };
const target = {
  name: '称量检查',
  type: '8', // 项目 EXCEL_TYPE 的判断节点；不是动态节点 ID。
  predecessor: { name: '投料' },
  successor: { name: '结束' },
};

const current = await readWorkflow(page.mainFrame(), workflow);
const observedNode = requireWorkflowNode(current, target); // 纯 JSON 查询，适合分析和断言
// observedNode.id 只说明当前观察，不能存为下次运行的测试条件。

const result = await clickWorkflowNode(page.mainFrame(), workflow, target);
// 上面重新采集 JSON、唯一匹配、复核图是否变化，再执行一次正常点击。
// 将 result.reading / result.node 附到测试报告；另行断言实际配置面板已出现。
```

自动化项目提供 `automation/pages/mes-workflow.ts` 的 `openMesWorkflowNode`：接收业务查询、预期面板地址、独立预期 checks 和 TestInfo，附加本轮 JSON 并断言面板及字段。正式 runner 已通过 `--suite mes --cases <文件>` 接入，详见 [MES 运行说明](../../automation/MES.md)。业务测试仍负责进入目标配方及定义独立的预期值；无需、也不应保存动态 ID。

`name`、`type` 精确匹配；至少提供其中一个。`predecessor`、`successor` 只匹配直接相邻节点，可各自使用名称和类型。它们表示存在这样的相邻节点，不断言整个工作流的正确性。同名且同类型的多个节点可用关系消歧；仍不唯一时抛错。查询不接受 `id` 等未知字段，不使用 `.first()`、坐标或节点序号兜底。

`resolveWorkflowNode` 是低层接口，返回本轮 ElementHandle，调用方必须及时 `dispose()`，不能缓存。通常使用 `clickWorkflowNode`；它会释放句柄且不会重试可能已生效的点击。动作和浏览器页面更新无法成为原子事务，业务用例必须验证点击后的预期界面。

Frame 由调用方提供实际 Frame，Shadow 用地址的 `shadowPath`。隐藏的 Frame/Shadow 宿主同样被拒绝。

## JSON 输出与关系

正常发现流程自动附加 `report.json` 的 `snapshots[].workflows`，CLI 另导出 `workflow.json`。`ui-model.json` 包含工作流、节点、包含关系和 `connects-to` 关系。动态节点观察只属于该快照，不能按相同数字跨运行合并。

旧发现报告没有此数据，必须重新扫描。读取旧 JSON 可用于分析历史证据；执行接口不接受旧 JSON 作为动作目标，也不从实际观察自动推导业务正确的预期值。

## 短名称与重复

公共适配器对已核对的 PI 路径使用业务别名。例如 `ebr-pi-workflow-metage-checkbox-auto-profit-loss`、`ebr-pi-parameters-input-btn-add`。未专门命名的超长基础名保留可读首尾和完整输入的确定性摘要，基础名不超过 112 字符。摘要不是业务 ID，自动化不需要手工拼接；短名本身也不构成绝对无碰撞保证。

真实输入/trigger/panel/option 保持统一基础名和固定后缀。表格记录键、选项值等动态后缀按实际值保留，不为了长度截掉区分信息。原本就短的标识和显式手写 `data-testid` 优先保留。相同页面存在多份组件时仍需不同 `test-id-scope`；重复目标由当前扫描与唯一性校验明确拒绝，不能靠随机后缀假装稳定。

## 验证边界

运行 `npm run test:workflow` 验证实际 EBR 节点模板、两次运行不同 ID、关系消歧、拒绝不完整/过期观察、Frame/Shadow、发现与模型导出。使用本地固定数据以及 JTH 安装的 Vue/组件依赖，不连接业务后端；不代表真实 EBR 依赖版本、业务保存或生产环境验收。
