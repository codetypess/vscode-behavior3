# Tree Custom Inspector Metadata

Status: Verifying
Date: 2026-05-07
Scope: tree inspector, updateTreeMeta, persistedTree.custom

## 1. Context

`PersistedTreeModel` 早已支持 `custom` 字段，但当前 Tree Inspector 只暴露了 `desc`、`prefix`、`export`、`group`、`variables`，没有提供树级自定义元数据的编辑入口。

用户当前只能离开 Inspector，手改 JSON 文件里的 `custom` 对象。这让树级业务元数据和其他 tree meta 一样可持久化，却不能通过 Inspector 一起编辑。

## 2. Goals

- 在 Tree Inspector 中新增树级 `custom` 编辑区域。
- 采用 `key:value` 的列表形式编辑，并写回 `persistedTree.custom`。
- 保持现有字段级独立提交节奏，不因为其他区域错误阻断 `custom` 提交。
- 保持 `custom` 只影响持久化 tree meta，不触发无关 graph rebuild。

## 3. Non-Goals

- 不新增节点级 `custom` 编辑。
- 不把 `custom` 接入 graph 搜索、变量高亮或节点校验。
- 不引入复杂 schema 编辑器或任意深度 UI。

## 4. Current Behavior

- `PersistedTreeModel.custom` 会被解析、保留并参与序列化。
- Tree Inspector 没有任何 `custom` 可视化或编辑能力。
- `updateTreeMeta` reducer 目前也不接收 `custom` 更新。

## 5. Proposed Behavior

- Tree Inspector 在 import refs 之后新增 `custom` section。
- section 使用可增删的 `key:value` 行编辑树级自定义数据。
- `key` 必填，按 trim 后参与存储，且同一棵树内不得重复。
- `value` 使用原始文本输入：
  - 普通未加引号文本按字符串存储
  - 数字、`true`、`false`、带引号字符串按字面量解析
  - 对象、数组或无法解析的结构化字面量拒绝提交并保留表单错误
- 每一行显示一个根据当前输入推断出来的类型徽章，区分 `string`、`number`、`boolean` 与非法输入。
- 成功提交后写回 `persistedTree.custom`，并通过既有 save / undo / redo 流程生效。

## 6. Design

- `TreeInspectorForm` 新增 `customRows` 表单值，用于承载对象到列表的投影。
- Tree Inspector UI 本次只负责编辑 `string | number | boolean` 这三类 `custom` value。
- `custom` 行左侧增加类型徽章，帮助用户在输入阶段理解当前值会按哪种类型写入。
- `createTreeInspectorFormValues()` 负责把 `document.custom` 转成可编辑行。
- `buildTreeCustomRecord()` 负责把 `customRows` 还原成 `UpdateTreeMetaInput.custom`。
- `updateTreeMeta` reducer 负责：
  - 比较 `custom` 是否变化
  - 在变化时写回新 tree
  - 仅当 `prefix` 或 `group` 变化时才 `rebuildGraph`
- 这次规则会成为长期行为，因此同步更新 `16-inspector-contract.md` 与 `17-editor-semantics.md`。

## 7. Implementation Plan

1. 补 work-item spec，并更新相关 baseline spec。
   Exit: spec 清楚描述 UI、解析规则、提交流程和验收标准。
2. 实现 Tree Inspector `custom` section 与 payload 转换。
   Exit: UI 能显示、增删、校验并提交 `custom` 行。
3. 扩展 reducer 与 contracts。
   Exit: `updateTreeMeta` 能稳定持久化 `custom`，且 noop / rebuildGraph 语义正确。
4. 补测试并验证。
   Exit: helper、reducer、controller 回归通过。

## 8. Testing Plan

- 为 `buildTreeCustomRecord()` 补充 `custom` 解析测试。
- 为 shared reducer 补充 `updateTreeMeta` 写入 `custom` 的测试。
- 运行 `npm run check`。
- 运行 `npm run test:shared`。

## 9. Acceptance Criteria

- Tree Inspector 选中树时，能看到并编辑 `custom` key/value 列表。
- 提交合法 `custom` 值后，`persistedTree.custom` 会更新并参与保存。
- `custom` 的重复 key、对象/数组字面量或非法结构化输入不会静默写入主文档。
- 仅修改 `custom` 时不会额外触发 graph rebuild。

## 10. Risks and Rollback

- 风险：value 的文本到持久化值转换若过于激进，可能把用户期望的字符串误解析成其他类型。
  - 缓解：只解析布尔、数字和带引号字符串，普通裸文本保持字符串。
- 风险：重复 key 若不拦截，会出现最后一项覆盖前一项的隐式行为。
  - 缓解：在表单校验阶段明确阻止重复 key。
- 回滚方式：移除 Tree Inspector `custom` section，并让 reducer 忽略 `updateTreeMeta.custom`。
