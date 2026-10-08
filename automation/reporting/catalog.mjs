// 这里只解释已确认的用例，不参与执行或计算断言预期值。
export const pageNames = {
  inputs: "基础输入", linkage: "联动规则", dialogs: "嵌套弹框",
  extended: "扩展输入", table: "动态表格", all: "全部组件",
};
export const fieldNames = {
  name: "名称", count: "数量/行数", weight: "重量", raw: "原始输入",
  a: "复选框 A", b: "复选框 B", c: "复选框 C", d: "复选框 D",
  mode: "数据来源", manual: "手动值", advanced: "启用高级配置", reason: "高级配置原因",
  source: "数值来源", precision: "小数位数", unit: "单位", required: "必填",
  priority: "优先级", workshop: "车间/产线", tags: "功能标签", enabled: "启用",
  threshold: "阈值", color: "颜色", file: "附件", code: "物料编码",
  quantity: "物料数量", location: "重复位置",
  "config-name": "配置名称", "free-text": "自由文本", "integer-count": "整数数量",
  "decimal-weight": "小数重量", "limited-note": "限长备注", "readonly-code": "只读编码",
  "disabled-device": "禁用的设备输入", "manual-value": "手动值", "advanced-reason": "高级配置原因",
  "material-search": "物料搜索", "add-row": "新增物料按钮", "mark-color": "标记颜色",
  "reminder-time": "提醒时间", "planned-datetime": "计划日期时间", attachment: "附件",
};
export function groupId(id = "") { return id.split("@")[0]; }
export function pageName(route) {
  return pageNames[String(route).split("/").at(-1)] ?? route ?? "未记录页面";
}
const entry = (title, steps, expected) => ({ known: true, title, steps, expected });
const groups = {
  "basic.required": ["名称、整数数量与重量的组合校验", "填写名称、整数数量和小数重量；点击保存", "合法输入保存并刷新回显；空名称、数量越界或重量不合法时显示对应错误，原保存值不变"],
  "basic.free": ["自由文本与特殊字符", "填写自由文本并保存、刷新", "文本正确回显；输入框中的换行按规则转为空格"],
  "basic.integerFormat": ["整数输入格式拦截", "先填合法整数 7，再输入候选中的非法格式", "保留原值 7，并提示只允许整数"],
  "basic.decimalFormat": ["小数输入格式拦截", "先填合法小数 1.234，再输入候选中的非法格式", "保留原值 1.234，并显示小数格式提示"],
  "basic.note": ["备注的 100 字符边界", "填写候选备注；检查计数；保存、刷新", "按 Unicode 码点截取前 100 个字符，计数、保存值与回显一致"],
  "linkage.abcd": ["A/B 互斥与 C/D 依赖", "按目标选择 A/B/C/D；A/B 同开目标分别验证 A→B 和 B→A 两条路径", "选 A 禁用 B，选 B 禁用 A；选 C 自动勾选并禁用 D；合法目标可保存，非法目标由正常 UI 拦截或联动修正"],
  "linkage.conditional": ["来源切换与条件必填", "填写手动值及高级原因，再切换来源和高级开关；尝试保存", "系统来源禁用手动输入；手动模式必填；高级开关控制原因输入和必填；合法值保存刷新，非法值不覆盖保存记录"],
  "dialogs.display": ["弹框来源、变量、精度、单位和必填组合", "打开配置弹框；选择固定值或变量；在显示与校验页设置精度、单位及必填；确认", "缺少变量时留在弹框并提示；合法配置保存、刷新及重新打开后正确回显，来源控制相关字段禁用"],
  "dialogs.name": ["弹框名称必填", "打开配置弹框，填写名称并确认", "空白名称显示错误且不保存；合法名称保存后重新打开正确回显"],
  "dialogs.fixed": ["弹框固定值边界", "打开配置弹框，填写固定值并确认", "仅允许 0–100000 且最多 3 位小数；非法值不覆盖保存记录"],
  "dialogs.format": ["弹框固定值格式拦截", "先填写 1.234，再输入非法数字格式", "保留 1.234 并显示格式提示"],
  "dialogs.remark": ["弹框备注长度", "打开弹框的显示与校验页，填写备注并确认；刷新、重新打开", "保留前 100 个 Unicode 码点，保存和回显一致"],
  "extended.selections": ["单选、级联和多选组合", "选择优先级、车间产线、功能标签；保存并刷新", "全部选值保存正确，多选标签和已选数量一致"],
  "extended.threshold": ["告警开关与阈值组合", "输入阈值并切换告警开关；保存并刷新", "阈值与滑块读数一致，关闭告警时输入禁用；刷新后状态保留"],
  "extended.thresholdBoundary": ["阈值越界修正", "输入 -1 或 101；离开输入框并保存、刷新", "实际阈值被限制在 0–100，保存值与界面实际值一致"],
  "extended.color": ["颜色选择与保存", "填写颜色值；检查页面颜色文字；保存并刷新", "颜色文字、保存记录与刷新后的输入一致"],
  "extended.files": ["附件类型与 2 MiB 大小边界", "选择测试附件；非法附件前先选择 previous.txt；保存并刷新", "合法附件保存元数据；非法类型或超限显示错误且保留原附件；刷新后元数据保留，文件输入为空"],
  "extended.dates": ["日期区间输入与校验", "填写开始和结束日期；结束输入并保存、刷新", "合法区间正确保存；非法区间不能原样保存，最终值须为空或有效且按时间排序的日期区间"],
  "extended.time": ["时间输入与校验", "填写提醒时间；结束输入并保存、刷新", "合法时间正确保存；非法时间不能原样保存，最终值须为空或有效的时分"],
  "extended.dateTime": ["日期时间输入与校验", "填写计划日期时间；结束输入并保存、刷新", "合法值正确保存；非法值不能原样保存，最终值须为空或真实存在的日期时间"],
  "table.row": ["物料行字段组合", "编辑物料编码、名称、数量、单位和启用状态；保存、刷新", "编码名称必填并去首尾空格；禁用行的数量和单位不可编辑；合法行保存回显，非法行不覆盖原记录"],
  "table.rowCount": ["物料行数 1–20 边界", "增删至候选行数，检查边界按钮；保存、刷新", "最少 1 行、最多 20 行；边界按钮禁用；行标识唯一，新增行内容和保存行数正确"],
  "table.duplicates": ["同页或跨页重复物料编码", "在同页或第 2 页填写重复编码，再点击保存", "忽略大小写与首尾空格识别重复；定位到问题行并提示，原保存值不变"],
  "table.quantityBoundary": ["物料数量非法输入", "填写空值、零、负数、超上限或非数字并保存", "空值提示错误且不保存；被控件修正的值须大于 0 且不超过 100000，再核对保存和刷新"],
};
const behaviors = {
  "behavior.inputs.readonly-disabled": entry("只读与禁用输入保护", ["点击只读编码并尝试覆盖", "用 Tab 导航并尝试输入禁用字段"], "只读编码保持 LAB-INPUT-001；禁用字段不获焦且值保持不变"),
  "behavior.inputs.dirty-restore-refresh": entry("修改提示、恢复和刷新", ["填写合法配置并保存", "修改名称后恢复；再修改自由文本并刷新"], "修改提示正确；恢复及刷新丢弃未保存草稿，保留已保存值"),
  "behavior.linkage.unlock-retention-restore": entry("联动解除、保留与恢复", ["依次勾选、取消 A/B 和 C/D", "切换手动来源和高级开关，检查输入保留", "保存，再修改并恢复、刷新"], "解除互斥恢复可用；取消 C 后 D 保持选中且可编辑；切换保留草稿，恢复回到保存值"),
  "behavior.dialogs.search-pagination-confirm": entry("变量搜索、分页与确认", ["打开变量选择弹框，按编码、名称、单位及无结果条件搜索", "选择第 2 页 V-008；搜索后清空并检查选择保留", "内层确认，再外层确认保存并刷新"], "未选择时确认禁用；搜索回第 1 页且保留选择；内层确认不直接持久化，外层确认才保存"),
  "behavior.dialogs.backdrops-mode-roundtrip": entry("弹框遮罩与来源往返", ["填写固定值 42，再选择 V-006", "点击内外层空白区域；切换固定值与变量来源"], "空白区域点击不关闭弹框；来源切换保留已填值，并正确禁用不适用输入"),
  "behavior.dialogs.variable-metadata-does-not-overwrite-display": entry("变量选择不覆盖显示设置", ["先设置 1 位小数、单位件", "选择 V-008，再查看显示与校验页"], "绑定变量只读；已设精度和单位不被变量元数据覆盖"),
  "behavior.extended.selection-search-clear-restore": entry("下拉选择、搜索、清空和恢复", ["选择优先级、级联、多选；搜索标签并移除、清空", "键盘选择标签，清空级联，再恢复"], "标签数量正确；搜索不丢已选值；Escape 收起；恢复回默认，未保存值不持久化"),
  "behavior.extended.file-remove-replace-restore": entry("附件替换、移除和恢复", ["保存 first.txt", "选择 next.csv 后移除，再恢复"], "未保存替换或移除不改变原保存记录；恢复显示 first.txt 元数据，文件输入为空"),
  "behavior.extended.slider-keyboard": entry("滑块键盘操作与禁用", ["聚焦滑块，按右键再按左键", "关闭告警，再按右键"], "阈值从 60 到 65 再回 60；关闭后滑块禁用且保持 60"),
  "behavior.extended.calendar-time-panels-clear": entry("日期时间面板选择与清空", ["通过输入及面板选择日期区间、提醒时间、计划日期时间", "保存刷新，再逐项清空并保存"], "保存值分别为 2026-10-10 至 2026-10-12、13:35、2026-10-08 13:35:57；清空后正确保存为空"),
  "behavior.table.search-pagination-hidden-error-restore": entry("表格搜索、跨页错误定位和恢复", ["准备 6 行，按编码名称、大小写及空格搜索，测试无结果及翻页", "让第 1 行名称为空，搜索其他行后保存，再恢复"], "搜索回第 1 页；保存发现隐藏问题行时清空搜索并定位提示；恢复后回到原行数，错误消失"),
  "behavior.table.add-clear-query-goto-end": entry("搜索后新增物料，应跳到最后一页", ["准备 5 行物料，正好占满第 1 页（每页 5 行）", "在物料搜索框输入 MAT-001", "点击“新增物料”，产生第 6 行", "检查搜索框已清空，当前页为第 2 页"], "搜索框为空，分页器选中第 2 页，让用户继续编辑新增的第 6 行"),
  "behavior.table.delete-clamp-cross-edit": entry("跨页编辑保留与删除后页码收缩", ["准备 5 行，再新增第 6 行并改名", "在第 1、2 页往返；删除第 6 行"], "跨页不丢编辑；删除末页唯一行后回第 1 页，显示剩余 5 行"),
  "behavior.table.saved-add-edit-delete-restore": entry("表格复杂草稿恢复", ["修改第 1 行并保存", "新增、清空编码触发校验、删除第 2 行并搜索", "点击恢复"], "恢复已保存名称和两行数据，清除搜索及错误，保存记录不变"),
  "global.navigation-jump-brand": entry("六页导航与全部组件快速定位", ["逐页点击导航，检查标题和分区", "在全部组件页依次快速定位、返回顶部", "点击品牌入口"], "当前导航、标题、分区及焦点正确，品牌入口返回基础输入页"),
};
const methods = { cancel: "取消按钮", x: "右上角关闭按钮", escape: "Escape 键", confirm: "确认按钮", backdrop: "遮罩空白区域" };

export function describeCase(meta = {}) {
  const id = groupId(meta.candidate?.id);
  if (meta.modelVersion && meta.modelVersion !== "2026-10-07.1")
    return unknown(id, "该模型版本尚未登记中文场景说明");
  if (groups[id]) {
    const [title, step, expected] = groups[id];
    return entry(title, [step, "按该场景的断言检查页面状态及适用的保存/刷新结果"], expected);
  }
  if (behaviors[id]) return behaviors[id];
  let match = id.match(/^behavior\.dialogs\.(inner|outer)-(cancel|x|escape)$/);
  if (match) return entry(`${match[1] === "inner" ? "内层变量" : "外层配置"}弹框通过${methods[match[2]]}退出`,
    ["打开配置弹框并选择变量", `使用${methods[match[2]]}关闭${match[1] === "inner" ? "内层" : "外层"}弹框`],
    match[1] === "inner" ? "内层选择丢弃，外层仍打开且未绑定；取消外层后原保存值不变" : "外层草稿丢弃，原保存值不变；重新打开显示原配置");
  match = id.match(/^behavior\.dialogs\.navigation-(inputs|all|dialogs)$/);
  if (match) return entry(`嵌套弹框中导航到${pageNames[match[1]]}`, ["打开两层弹框并选择未确认变量", `导航到${pageNames[match[1]]}，再返回配置页`], "两层弹框关闭；重新打开为原配置，未确认草稿丢弃");
  match = id.match(/^behavior\.table\.delete-(cancel|confirm|x|escape|backdrop)$/);
  if (match) return entry(`删除物料行：${methods[match[1]]}`, ["点击第 2 行删除", `通过${methods[match[1]]}处理确认框${match[1] === "backdrop" ? "，检查仍打开后取消" : ""}`],
    match[1] === "confirm" ? "第 2 行从草稿删除；保存前持久化值不变，保存刷新后只剩第 1 行" : "第 2 行保留，原保存值不变");
  match = id.match(/^global\.(draft-roundtrip|section-save)\.(inputs|linkage|dialogs|extended|table)$/);
  if (match) return entry(`${pageNames[match[2]]}：${match[1] === "draft-roundtrip" ? "分类页与全部组件草稿往返" : "分区独立保存"}`,
    match[1] === "draft-roundtrip" ? ["编辑该区域草稿", "往返分类页与全部组件页"] : ["准备多个分区草稿", "仅保存目标分区，再刷新"],
    match[1] === "section-save" ? "只有目标分区保存，其余分区保存值不变，刷新丢弃其余草稿" : match[2] === "dialogs" ? "未确认弹框草稿在导航后丢弃，不持久化" : "两个入口共享当前草稿，不自动持久化");
  match = id.match(/^global\.reset\.(cancel|x|escape|confirm)$/);
  if (match) return entry(`全站重置：${methods[match[1]]}`, ["保存五个区域的修改", `打开全站重置确认框，通过${methods[match[1]]}处理并刷新`],
    match[1] === "confirm" ? "五区恢复默认，localStorage 记录清除，刷新仍为默认" : "全部保存记录保留，刷新后不变");
  return unknown(id, "该用例尚未登记中文场景说明");
}
function unknown(id, reason) {
  return { known: false, title: `${reason}（${id || "无标识"}）`, steps: ["请查看原始执行记录中的操作步骤"], expected: "请以原始断言为准；当前中文目录未提供业务解释" };
}
