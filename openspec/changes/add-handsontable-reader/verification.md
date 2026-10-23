# 验证记录（2026-10-23）

## 交付范围

- UI 自动化项目新增 Handsontable DOM 读取器、公开读取/查找 API、发现集成、专用 JSON 与关系模型。
- 核对 EBR/JTH 的 1717 个源码文件 SHA-256，本次前后无变化；没有提交或推送代码。保留此前已有未提交改动。
- 不访问 Vue 私有实例、不安装页面监听器、不调用组件写操作；浏览器测试比较读取前后数据、DOM、修改回调计数和滚动位置，保持不变。

## 已执行检查

| 检查 | 结果 |
|---|---|
| TypeScript 构建与单元测试 | 31/31 通过 |
| 浏览器回归 | 串行 68/68 通过，其中 Handsontable 8 项 |
| 组件证据 | npm 公开 Handsontable Pro 6.2.3，真实 Chrome，固定本地数据 |
| CLI 导出 | 成功输出七个标准文件，含 handsontable.json；退出码 2，正确保留部分发现状态 |
| OpenSpec | `openspec validate add-handsontable-reader --strict` 通过 |
| 差异格式 | `git diff --check` 通过 |
| 进程清理 | 最终回归记录 169 个本次所属进程（含测试/辅助/服务），全部退出，未关闭用户 Chrome |

浏览器专项覆盖格式化文本、内层样式、合并跨度、嵌入输入/复选状态、敏感值排除、固定副本一致/冲突、虚拟滚动、预算/文本截断、缺失/重复标题、隐藏祖先、Frame/Shadow、报告指纹与模型关系。真实组件隐藏主表标题，读取器从对应可见固定区域按轴匹配；允许 1 CSS 像素边框差，匹配不唯一不推断。

第一次完整回归并行运行有两项旧用例失败：其中一项示例固定访问 5173，而启动站点使用 5189；另一项为新窗口等待未完成。改用原端口并串行复跑后全部通过，未放宽测试断言或修改业务逻辑。

## 可检查产物

- `output/handsontable-cli-20261023-verified/report.json`
- `output/handsontable-cli-20261023-verified/handsontable.json`
- `output/handsontable-cli-20261023-verified/ui-model.json`
- `output/handsontable-cli-20261023-verified/cell-example.json`：从真实导出提取的温度单元格示例。
- `output/handsontable-cli-20261023-verified/verification-summary.json`
- `/tmp/mes-hot-verification-processes.json`：本次进程来源及退出核对。

CLI 的部分发现原因是固定示例中三个嵌入输入没有独立稳定定位；专用表格读取保留了它们的 DOM 状态。未添加单元格 test ID 来掩盖此缺口。表格状态 observed 仅表示已观察区域成功，coverage.allDataCovered 始终为 false。

## 验收边界

EBR 声明的 handsontable-pro@6.2.6 在公共 npm 不存在，未运行该版本或真实 MES 后端验收。测试包 6.2.3 仅为开发依赖，不进入读取器运行时，旧依赖的 npm 审计提示仍存在。

当前结果不包含后台原始值、Excel 数字格式配置、未渲染区域或跨工序业务身份。格式为限定计算 CSS 与选定内层元素状态，不是截图验收。预期值必须来自独立测试输入及已确认规则；标题定位仅限当前任务/模板的已观察范围。
