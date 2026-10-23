## ADDED Requirements

### Requirement: Contextual identity and observations
系统 SHALL 为扫描到的 UI 元素建立上下文限定的身份和逐快照观察。未知定位 MUST 仅作为不可执行的观察保留。

#### Scenario: Repeated controls in different contexts
- **WHEN** 相同 test-id 出现在不同路由、Frame、Shadow 或稳定业务行
- **THEN** 模型保留不同身份，同一上下文中可靠定位不变的元素跨快照合并观察，不按文案或行序号合并

#### Scenario: Unknown and changed states
- **WHEN** 两次观察的值或禁用状态不同，或控件没有唯一定位
- **THEN** 每次观察均可追溯；未定位项不跨快照合并，不成为可执行定位或业务依赖规则

### Requirement: Evidence-backed structural relationships
系统 SHALL 根据扫描到的真实容器、表格和面板证据建立包含、选项归属及浮层归属关系，所有边 MUST 引用有效端点与证据。

#### Scenario: Stable table rows
- **WHEN** 记录行通过稳定标识定位且排序发生改变
- **THEN** 该行、单元格及操作仍保持正确归属，行号仅用于展示；无业务键时不将行号升级为身份

#### Scenario: Transferred dropdown
- **WHEN** 两个 md/iView 下拉的面板位于 body 下并分别具有明确 ARIA 或准确的组件 test-id 关联
- **THEN** 每个下拉只关联所属面板及选项，歧义目标不选择第一个，隐藏面板不作为当前可见证据

### Requirement: Verified interaction relationships
系统 SHALL 仅从成功展开步骤、弹框关联或成功探索的目标界面建立打开关系；关系不授权自动执行。

#### Scenario: Nested dialog
- **WHEN** 已验证入口打开外层弹框，外层入口再打开内层弹框
- **THEN** 模型保留两个入口及目标关系和父弹框关系，证据引用相应快照

#### Scenario: Failed or dangerous entry
- **WHEN** 入口仅被发现、动作失败、遭到阻止或尚未执行
- **THEN** 模型不得生成已验证的打开关系或点击该入口来补证据

### Requirement: Reviewable model export
发现 CLI SHALL 同时导出 `ui-model.json`、中文关系摘要，提供按元素查询关系的 API，保留扫描预算及未知项限制。

#### Scenario: Partial discovery
- **WHEN** 报告含截断、未定位或未扫描文档
- **THEN** 输出明确说明模型部分覆盖且不等于业务规则或测试通过，现有配置确认门槛保持有效

#### Scenario: Modified report
- **WHEN** 报告内容与其指纹不符
- **THEN** 模型生成失败，不输出貌似可信的关系结果
