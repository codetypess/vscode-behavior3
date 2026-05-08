# Inspector Contract

## 目的

当前 Inspector 是一个独立的 VS Code Sidebar webview，用于展示并编辑当前激活 Behavior3 编辑器的树与节点上下文。

它与主编辑器共享同一套业务语义，但不直接拥有主文档真源。

## 总体原则

### Principle 1. Inspector 是独立侧栏，而不是主编辑器内面板

当前主编辑器只显示画布；Tree Inspector 与 Node Inspector 运行在独立 sidebar 中。

### Principle 2. Inspector 通过宿主代理修改主文档

侧栏中的树/节点编辑不会直接改 `persistedTree`，而是通过：

1. `mutateDocument`
2. 宿主定位当前激活主编辑器对应的 extension-host session
3. host session 执行真实 mutation 并提交权威文档状态
4. 宿主再把结果与最新上下文回传侧栏

### Principle 3. Inspector 既展示结构，也展示校验与降级信息

Inspector 不只是字段表单，还需要表达：

- subtree resolution error
- 节点参数校验错误
- subtree override 差异
- 当前无激活文档时的空状态

## 外层状态

### No Active Document

- 显示空状态文案
- 不保留上一份文档的陈旧字段

### Tree Selected

- 显示 Tree Inspector

### Node Selected

- 显示 Node Inspector

### Reload Conflict

- 顶部显示 warning banner
- 提供 reload 与 dismiss 操作

## Tree Inspector Contract

当前 Tree Inspector 结构为：

### Section Order

1. `name`
2. `desc`
3. `prefix`
4. `export`
5. `group`（仅在存在 groupDefs 时显示）
6. local vars
7. subtree declarations
8. import refs
9. custom metadata

### Tree Meta

- `name` 只读
- `desc` / `prefix` 可编辑
- `export` 用 `Switch`
- `group` 用多选 `Select`

### Local Vars

- 支持新增、删除
- `name` 必须是合法变量名
- `desc` 必填
- 提交后进入 `updateTreeMeta` intent，由 host session 决定是否提交

### Subtree Decls

- 由宿主 `subtreeDecls` 驱动
- 只读展示每个 subtree 的变量列表
- 可通过 inline action 打开对应 subtree 文件

### Import Refs

- 由 `document.variables.imports` 驱动
- 使用工作目录 `allFiles` 作为自动补全来源
- 每个 import path 下展示宿主解析出的变量声明

### Custom Metadata

- 由 `document.custom` 驱动
- 使用可增删的 `key:value` 行编辑
- 每行左侧显示一个根据当前输入推断出的类型徽章
- `key` 必填且不能重复
- `value` 仅支持 `string`、`number`、`boolean`
- 裸文本默认按字符串处理；布尔字面量、数字字面量和带引号字符串按值解析
- 对象、数组或非法结构化输入拒绝提交

## Node Inspector Contract

当前 Node Inspector 至少包含以下区域：

### Section Order

1. `id`
2. `type`
3. `group`（若 nodeDef 声明）
4. `children`
5. `name`
6. `desc`
7. `debug`
8. `disabled`
9. `path`
10. nodeDef markdown doc（若存在）
11. input slots
12. output slots
13. structured args
14. raw node JSON fallback（仅未知节点）

### Readonly Meta

- `id` 只读，来自 `displayId`
- `type` 只读，来自 nodeDef.type 或 unknown fallback
- `children` 只读，展示当前 children 约束结果

### Editable Core Fields

- `name` 可通过 nodeDefs 自动补全切换节点类型
- `desc`、`debug`、`disabled` 可编辑
- `path` 可编辑 subtree link；subtree 内部节点自身不允许再改 path

### Inputs / Outputs

- 按 nodeDef 的 slot 声明渲染
- variadic 槽位使用数组式列表
- required / optional / oneof 约束即时校验

### Args

- 按 arg 类型渲染为 `Select` / `Switch` / `InputNumber` / `TextArea` 等
- `bool` / `bool?` 标量参数统一渲染为 `Switch`；项目内 bool 参数不通过 `options` 配置枚举值
- 表达式型参数校验变量引用与表达式合法性
- 自定义 node check 结果会映射到对应 arg 校验提示
- 新切入的 required arg 若当前还没有 committed 值，初始态保持 unset；在用户显式输入前不得静默序列化成 `""`、`false` 或其他占位值

### Unknown Fallback

- 当前 nodeDef 不存在时，不渲染结构化 args
- 显示原始节点 JSON 只读视图

## Override Contract

当前 override 交互只用于 subtree 内部节点：

### 显示条件

- `selectedNode.subtreeNode === true`
- 且存在 `subtreeOriginal`

### Reset Scope

可逐字段 reset：

- `desc`
- `debug`
- `disabled`
- 输入槽
- 输出槽
- 结构化 args

### 语义

- reset 后提交新的 node 数据
- host reducer 会重新计算 override diff
- 若 diff 为空，则从主文档 `overrides` 中删除

## 可编辑性规则

当前 Inspector 中有两类“不可编辑”：

### 1. 业务只读

- `name`、`id`、`type` 等元字段本就只读或半只读
- `path` 对 subtree 内部节点只读

### 2. subtree 结构锁

当节点来自外部 subtree 且 `subtreeEditable = false` 时：

- 字段编辑会被禁用
- 但仍可查看当前解析结果

注意：

- 节点自身的 `data.disabled` 是 persisted 字段
- `selectedNode.disabled` 在 Inspector snapshot 中表达的是“当前是否因 subtree 规则而不可编辑”

## 提交节奏

当前 Inspector 提交通常遵循：

- 文本输入：`onBlur`
- `Switch` / `Select`：立即排队提交
- 列表增删：立即排队提交

提交粒度规则：

- 每次只提交当前编辑字段，或该字段所属的最小局部列表单元
- 某个字段的校验错误不会阻断无关字段的提交
- 非法字段保留本地错误提示，不得静默写入主文档
- `oneof` 这类显式耦合字段允许继续按局部约束拒绝提交

Sidebar 在执行保存、撤销、重做前，会先 flush 待提交的 Inspector 编辑。

## 变量聚焦契约

- 侧栏中点击变量行时，发送 raw `requestFocusVariable`，请求宿主把变量聚焦 relay 给当前主编辑器
- 主编辑器图层热点点击也会驱动相同变量聚焦语义
- 变量聚焦不直接修改文档，只影响 editor-local graph UI 视觉状态
- 变量聚焦不写入 `init` / `documentSnapshotChanged`，也不跨 reload/save/undo/redo 持久化

## 验收要点

- 侧栏永远展示当前激活 Behavior3 编辑器的上下文
- Tree Inspector 与 Node Inspector 的字段、校验和提交路径稳定
- subtree override 与 resolution error 能在 UI 中明确表达
