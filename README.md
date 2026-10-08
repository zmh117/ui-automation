# MES UI 自动化项目

- [交互配置实验室：启动与页面规则](playground/README.md)：已实现的 Vue 前端被测站，覆盖输入边界、复选框联动、嵌套弹框、扩展控件和动态表格。
- [全量配置枚举器：运行与跨 Vue 项目接入](packages/config-enumerator/README.md)：独立 TypeScript 包，流式生成全部有限候选，保留合法/非法分类及全部违规原因；当前不执行 UI。
- [页面自动发现：指定入口、模型确认与真实项目测试](packages/config-enumerator/DISCOVERY.md)：用 Playwright 读取 DOM，生成发现报告和待确认模型；仅展开指定入口，不保存配置。
- [六页 UI 自动执行：用例、命令与结果报告](automation/README.md)：使用已确认的分组全量模型实际操作页面，包含非法输入、保存刷新和失败证据。
- [本地验收记录](playground/VERIFICATION.md)：构建及浏览器验证范围、截图和限制。
- [MES UI 自动化测试方案](MES_UI自动化测试方案.md)：现有整体设计。

## 启动前端

```bash
cd playground
npm ci
npm run dev
```

访问 http://127.0.0.1:5173/ ，或直接进入 [全部组件页](http://127.0.0.1:5173/#/all) 集中体验。数据保存在当前浏览器的 localStorage，提供确认重置。前端练习站和对应的六页 UI 自动执行工程均已提供，执行范围见 automation/README.md。

## 运行全量枚举

```bash
cd packages/config-enumerator
npm ci
npm test
mkdir -p output
npm run enumerate -- --model examples/abcd.json --out output/abcd-full
```

输出目录必须是新目录。A/B/C/D 产生 16 条候选（9 合法、7 非法）；查看 `cases.jsonl` 与 `manifest.json`。其他项目只需提供自己的模型，算法无需修改；本项目浏览器操作路径见 automation/README.md；PICT 冒烟选例留待后续实现。

## 从本项目页面发现字段

保持练习站服务运行，另开终端：

```bash
cd packages/config-enumerator
npm ci
npm run build
npm run discover -- --plan examples/playground-discovery.json --out output/my-discovery
npm run test:discovery
```

默认使用本机 Chrome 和隔离上下文。示例计划包含一个禁用的内层变量入口，因此预期发现状态为 `partial`、退出码为 2；已发现内容正常导出。查看 `report.md` 和 `draft-model.json`，再按发现模块文档确认范围、取值和规则。

## 自动执行六页 UI 用例

保持前端服务运行，在根目录执行：

```bash
npm --prefix automation ci
npm run ui:plan
npm run test:ui
```

首次还需构建枚举器。可见慢速调试、结果说明和跨项目接入边界见 [执行工程说明](automation/README.md)。
