# data-testid 设置规则

本文约定 MES 页面和公共组件的测试标识命名、属性落点与定位方式。代码片段是接入示例，不代表真实 MES 已完成改造或浏览器验收。

**统一原则：稳定的业务名称标识控件，稳定的数据 ID 标识记录，固定后缀标识操作；定位时明确作用域。**

## 1. 命名规则

基础名按照业务位置和功能组织：

```text
模块-页面-区域-控件类型-字段或操作
```

示例：

```text
org-legal-list-search-select-status
org-legal-edit-form-select-major_type
org-legal-list-table-btn-detail
```

- 使用稳定的代码字段、业务编码和操作名，例如 `status`、`major_type`、`detail`。
- 使用 `-` 分隔语义层级；已有字段名中的 `_` 可以保留。
- 不根据可编辑的中文显示名称、选项顺序、随机数或时间戳生成标识。
- 展开／收起、选中／未选中、启用／禁用时，标识保持不变。
- 同页同时存在的同类控件，基础名应能区分业务位置和实例；不同作用域内的重复操作可以复用固定标识。
- 如果测试目标是特定记录，使用该记录的稳定 ID。只有明确验证排序位置时，才按“第几行”定位。

## 2. 属性必须落在正确的 DOM 节点上

| 目的 | 属性落点 |
|---|---|
| 读取或验证输入框显示值 | 实际的原生 `<input>` 或 `<textarea>` |
| 点击展开下拉 | 实际接收展开点击的可见区域或箭头 |
| 判断浮层是否展开 | 负责显示／隐藏的浮层容器 |
| 选择一条数据 | 对应的选项容器，例如 `<li>` |
| 验证表格字段 | 对应行内的单元格 |
| 执行按钮操作 | 实际按钮或实际可点击元素 |

不要把交互入口标识加在 `<input type="hidden">` 上。也不要把同一个基础名同时加在包装层、隐藏输入框和展示输入框上。

给 Vue 组件写 `<Input data-testid="...">`，不一定会传到内部原生 `<input>`；它可能落在组件根节点的包装 `<div>` 上。接入时必须检查最终渲染结果。

`data-testid` 可以重复，但最终用于单次点击、填写等操作的定位结果必须唯一。出现多个匹配时，应修正作用域或命名，不能用 `.first()` 掩盖冲突。

## 3. 表格：行区分记录，单元格和按钮区分功能

| 元素 | 命名示例 | 规则 |
|---|---|---|
| 表格 `table` | `org-legal-list-table` | 固定 |
| 表头 `thead` | `org-legal-list-table-head` | 固定 |
| 表体 `tbody` | `org-legal-list-table-body` | 固定 |
| 表头单元格 `th` | `org-legal-list-table-th-name` | 使用稳定列标识 |
| 数据行 `tr` | `org-legal-list-table-row-${row.id}` | 使用记录 ID，不使用行号 |
| 数据单元格 `td` | `org-legal-list-table-td-name` | 各行复用，限定在目标行内查找 |
| 行内详情按钮 | `org-legal-list-table-btn-detail` | 各行复用，限定在目标行内查找 |

示例结构：

```html
<table data-testid="org-legal-list-table">
  <thead data-testid="org-legal-list-table-head">
    <tr>
      <th data-testid="org-legal-list-table-th-name">法人名称</th>
      <th data-testid="org-legal-list-table-th-actions">操作</th>
    </tr>
  </thead>
  <tbody data-testid="org-legal-list-table-body">
    <!-- 1024 是记录 ID -->
    <tr data-testid="org-legal-list-table-row-1024">
      <td data-testid="org-legal-list-table-td-name">某法人组织</td>
      <td data-testid="org-legal-list-table-td-actions">
        <button data-testid="org-legal-list-table-btn-detail">详情</button>
      </td>
    </tr>
  </tbody>
</table>
```

先定位记录，再定位该行内的操作：

```ts
// recordId 来自当前测试目标记录。
const table = page.getByTestId('org-legal-list-table');
const row = table.getByTestId(`org-legal-list-table-row-${recordId}`);

await expect(row.getByTestId('org-legal-list-table-td-name'))
  .toHaveText('某法人组织');
await row.getByTestId('org-legal-list-table-btn-detail').click();
```

普通单元格和按钮不必重复拼接记录 ID。表头只有一行时，表头 `tr` 通常不需要单独标识。

如果表格组件确实无法给行加属性，可以直接给按钮使用 `org-legal-list-table-btn-${row.id}-detail`，仍然不能使用不稳定的行序号。

## 4. 单选与多选：一个基础名，固定功能后缀

以 `org-legal-list-search-select-status` 为基础名。下表的“基础名”是占位说明，实际生成完整字符串。

| 部位 | 命名规则 |
|---|---|
| 实际展示值的输入框 | `基础名` |
| 实际展开入口 | `基础名-trigger` |
| 下拉浮层 | `基础名-panel` |
| 普通选项 | `基础名-option-${item.value}` |
| 多选的“所有”选项 | `基础名-select-all` |
| 清空按钮（有需要时） | `基础名-clear` |

选项标识使用在该控件内唯一、稳定且非空的 `value` 或 `code`，不能用显示名称或选项序号。数值 `0` 是合法选项值，不应按空值处理；同时避免数字 `1` 与字符串 `'1'` 作为两个独立选项造成相同后缀。

显示字段与定位字段分别处理：

| 数据 | 显示字段示例 | 选项标识后缀示例 |
|---|---|---|
| 行业 | `label`：IT服务 | `option-1001` |
| 国家 | `cname`：阿富汗 | `option-2` |
| 状态 | `label`：启用 | `option-2` |

如果公共组件允许配置取值字段，生成标识时应复用组件现有的取值逻辑。例如已有 `optionValue` 配置时，使用 `item[optionValue]`。

多选项内已经有原生 checkbox 时，通常只需给选项容器加标识，再在容器内用 `getByRole('checkbox')` 定位，无需给每层 `label`、`span` 都增加标识。

## 5. 公共组件统一生成标识

业务页面只传基础名。以下组件名、表单和选项变量是示例，接入时沿用项目现有接口：

```vue
<MdSelectCheckbox
  v-model="query.status"
  :optionItem="statusOptions"
  test-id="org-legal-list-search-select-status"
/>
```

公共组件声明 `testId` prop，内部统一生成属性值。将下面内容合并到现有 `props`、`methods`，保留原有逻辑：

```js
export default {
  props: {
    testId: {
      type: String,
      default: ''
    }
  },
  methods: {
    tid(suffix = '') {
      if (!this.testId) return undefined;
      return suffix ? `${this.testId}-${suffix}` : this.testId;
    }
  }
};
```

自己渲染的原生节点直接绑定：

```vue
<!-- 下面仅展示属性绑定位置，保留节点原有的属性、事件和内容。 -->
<input :data-testid="tid()" />
<i :data-testid="tid('trigger')"></i>
<li :data-testid="tid('select-all')"></li>
<!-- item 为现有选项循环中的变量。 -->
<li :data-testid="tid('option-' + item.value)"></li>
```

如果实际展开入口是一个容器，就把 `-trigger` 加在该容器上，不必强行加到箭头上。只保留一个明确的展开入口标识。

未传基础名时不生成 `undefined-panel`、`-trigger` 等无意义值。不要同时在业务页面传入会与内部输入框重名的 `data-testid`。

## 6. transfer 到 body 的浮层

浮层脱离控件原来的 DOM 层级后，仍必须能独立识别所属控件：

- 将 `基础名-panel` 设置到实际浮层容器，属性应随浮层一起渲染或转移。
- 优先使用组件公开支持的属性或插槽。没有对应接口时，在公共组件内集中维护一个明确的适配点。
- 通过当前组件实例或明确关联找到自己的浮层，不使用全局第一个 `.ivu-select-dropdown`。
- 初始化、重新渲染或展开后应保证当前浮层拥有正确标识；如果支持基础名变化或清空，也要同步更新或移除原属性。
- 第三方内部 `$refs` 属于版本相关实现，升级依赖时需要重新核对。

此前核对的 iView 3.5.4 源码中，Select 通过 `$refs.reference` 引用展开区域，通过 `$refs.dropdown.$el` 引用浮层；Input 通过 `$refs.input` 引用原生输入框。`transfer` 移动的是同一个 DOM 节点，组件引用仍然有效。这些引用是适配依据，不是所有 iView 版本的公共接口，也不代表已验证真实 MES 的依赖版本。

浮层从页面作用域定位：

```ts
const base = 'org-legal-list-search-select-status';
const panel = page.getByTestId(`${base}-panel`);
```

不要依赖浮层仍是输入框或表格行的后代。同页多个同类控件必须能够区分各自的浮层。

**表格行内的下拉框，如果浮层会转移到 body，基础名应包含稳定行 ID。** 例如：

```text
org-legal-list-table-row-1024-select-status
org-legal-list-table-row-1024-select-status-panel
```

这是浮层脱离行作用域后的实例区分需求；普通行内单元格和按钮仍可使用固定标识。

## 7. 状态验证规则

| 场景 | 验证方式 |
|---|---|
| 浮层展开 | `toBeVisible()` |
| 浮层收起 | `toBeHidden()`；不要求节点从 DOM 删除 |
| 输入框当前值 | `toHaveValue()`；不依赖复制出来的 HTML 是否包含 `value` 属性 |
| checkbox 选中 | `toBeChecked()` |
| checkbox 未选中 | `not.toBeChecked()` |
| 设置多选状态 | `setChecked(true/false)`，避免无条件点击造成反向切换 |

多选下拉不一定在选择后收起，应先验证实际勾选状态；执行组件支持的收起操作后，再验证浮层隐藏。

例如，设置为“仅选择启用”：

```ts
const base = 'org-legal-list-search-select-status';

await page.getByTestId(`${base}-trigger`).click();
const panel = page.getByTestId(`${base}-panel`);
await expect(panel).toBeVisible();

const checkbox = (value: string) => panel
  .getByTestId(`${base}-option-${value}`)
  .getByRole('checkbox');

await checkbox('1').setChecked(false);
await checkbox('2').setChecked(true);
await checkbox('3').setChecked(false);

await expect(checkbox('1')).not.toBeChecked();
await expect(checkbox('2')).toBeChecked();
await expect(checkbox('3')).not.toBeChecked();
```

添加标识不改变控件的可见、禁用或只读行为。只读展示框通过下拉选项改变值；由 `input`、`div`、`li` 组成的自定义下拉不能直接套用原生 `<select>` 的 `selectOption()`。

## 8. 添加范围与验证边界

按定位和断言需求添加标识，优先覆盖有意义的区域、数据行、字段、交互入口和浮层；不必给每个包装节点、图标内部节点或普通展示文本都加。

普通分页表格中，增加这些属性的开销通常较小。命名方案优先考虑稳定性、作用域和可维护性；大列表的性能应结合 DOM 数量、组件复杂度和实际测量判断。

改造后的验证至少覆盖：标识唯一性、同页多个控件的浮层归属、展开与收起、选中状态、组件重新挂载，以及隐藏输入框是否残留同名标识。文档或源码检查不能替代真实页面上的交互验证。

## 参考依据

- [Playwright：定位与严格匹配](https://playwright.dev/docs/locators#strictness)
- [Playwright：checkbox 操作](https://playwright.dev/docs/input#checkboxes-and-radio-buttons)
- [Playwright：自动重试断言](https://playwright.dev/docs/test-assertions)
- [Vue 2：非 prop 属性与根节点继承](https://v2.vuejs.org/v2/guide/components-props.html#Non-Prop-Attributes)
- [iView：Select 源码](https://github.com/iview/iview/blob/2.0/src/components/select/select.vue)
- [iView：Input 源码](https://github.com/iview/iview/blob/2.0/src/components/input/input.vue)
- [iView：transfer 指令源码](https://github.com/iview/iview/blob/2.0/src/directives/transfer-dom.js)
