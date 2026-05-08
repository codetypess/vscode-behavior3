# Editor Semantics

## 目的

本文件定义当前编辑器命令、图刷新、save/reload/history、Inspector Sidebar 代理与宿主往返流程的稳定语义。

## 总规则

### Rule 1. 所有主文档写入都先由 `EditorCommand` 表达 intent，再由 host 提交

无论变更来自：

- 主编辑器图交互
- Inspector Sidebar 表单
- 快捷键
- 宿主代理 mutation

在 webview 内都必须先落到 `EditorCommand` catalog，随后通过 `HostAdapter` 进入 extension-host session。真正的主文档提交、dirty/history 推进与 committed snapshot fanout 都由 host session 完成。

### Rule 2. “改树”和“改视觉状态”要分开

- 结构化主树更新统一走 `applyDocumentTree`
- 纯选中、高亮、搜索变化走 `applyVisualState`

### Rule 3. reload conflict 不是自动合并

- 外部磁盘变化与本地未保存修改冲突时，只进入 `alertReload`
- 需要用户显式选择 reload 或 dismiss

### Rule 4. Inspector Sidebar 是代理而不是第二套写模型

- 侧栏可以发起 mutation/save/undo/redo
- 真正执行这些动作的是当前激活 custom editor 对应的 extension-host session 与 VS Code custom editor 生命周期

## 共享内部流程

### `syncReachableSubtreeSources()`

- 递归读取当前主树可达 subtree
- 构建 `workspaceStore.subtreeSources`
- subtree 解析到缺失稳定 id 时进行规范化回写

### `rebuildGraph(opts?)`

- 基于 `persistedTree + subtreeSources + nodeDefs + subtreeEditable` 重新 resolve graph
- 请求节点参数检查结果
- 重建 `ResolvedGraphModel`
- 交给 graph adapter render
- 视情况恢复 selection
- 最后重放 selection/highlight/search

### `applyVisualState()`

- 从 `selectionStore` 的 host-projected selection 与 `graphUiStore.selectionVisualHint` 计算 graph selection
- 从 `graphUiStore.activeVariableNames` 计算 variable highlights
- 从 `graphUiStore.search` 计算 search result keys 与 active index
- 分别下发到 graph adapter

### Graph-Local Collapse State

- 节点折叠不进入 `selectionStore`、`graphUiStore`、宿主 snapshot 或 persisted tree
- 折叠由 graph adapter 按节点 identity 维护为本地视觉状态
- `rebuildGraph()` 只重建 `ResolvedGraphModel`；adapter 自行在新模型中裁剪已失效的 collapsed identity，并尽量保留仍可匹配的折叠节点

### `applyDocumentTree(tree, opts?)`

- 可预先写入“待恢复 selection”
- 应用新树
- 同步 subtree cache
- rebuild graph
- 不维护 webview-local history projection
- 不直接把主文档内容写回宿主
- 不再调度 `treeSelected`；宿主直接基于 committed snapshot 刷新变量声明视图

## Selection 语义

### `selectTree()`

- 不直接改写 `selectionStore` 中的共享 tree/node authority 字段
- 保留或清除 variable focus，取决于调用路径
- 向宿主发送 `selectTree` intent
- 如有需要，可立即更新 graph-only 本地视觉 hint
- 后续以宿主 `documentSnapshotChanged.selection` 作为共享选中权威结果

### `selectNode(nodeKey, opts?)`

- 选中 resolved graph 中的实例节点
- 不直接改写 `selectionStore` 中的共享 tree/node authority 字段
- 向宿主发送 `selectNode(target)` intent
- 若节点已选中且未强制刷新，可只重发宿主 intent
- 若来自变量热点点击，可选择保留 variable focus
- 如有需要，可立即更新 graph-only 本地视觉 hint
- 后续以宿主 `documentSnapshotChanged.selection` 作为共享选中权威结果

### `focusVariable(names)`

- 仅更新 `graphUiStore.activeVariableNames`
- 不修改文档、history、dirty 或 host-projected selection
- 不进入 `init` / `documentSnapshotChanged`，也不跨 reload/save/undo/redo/webview re-init 持久化
- sidebar 触发时，raw request 使用 `requestFocusVariable`，宿主转发到 active editor 的 raw relay 使用 `relayFocusVariable`
- 触发图高亮与灰化

## Search 语义

### `openSearch(mode)`

- 打开 search overlay
- `mode` 为：
  - `content`
  - `id`

### `updateSearch(query)`

- 更新 query 并重算结果
- 若结果非空，自动选中并聚焦第一个结果
- 若目标结果当前位于已折叠祖先之下，graph adapter 会在聚焦前自动展开祖先链

### `nextSearchResult()` / `prevSearchResult()`

- 在结果集内循环移动
- 同步选中和图聚焦
- 若目标结果当前被折叠隐藏，graph adapter 会在聚焦前自动展开祖先链

## Host 驱动命令

### `initFromHost(payload)`

- 初始化 workspace state
- 解析主文档文本为 `persistedTree`
- 应用宿主 `selection`
- 重置 editor-local graph UI state，因此不会从 init 恢复 variable focus
- 构建首个 resolved graph
- 应用宿主 document session projection

### `applyDocumentSnapshot(snapshot)`

- 用于吸收宿主推送的最新 committed document/session/selection snapshot
- 若内容与当前结构化快照等价，则只重放宿主 selection projection 与 session 状态
- 否则更新主树并保持 selection 尽量稳定，不在 webview 本地推进 history
- reload snapshot 会清除 editor-local graph UI state；snapshot 本身不能携带或恢复 variable focus

### `applyNodeDefs(defs)`

- 更新 nodeDefs 与 groupDefs
- 重新构建图与 Inspector 结构

### `applyHostVars(payload)`

- 更新 `usingVars`、`allFiles`、`importDecls`、`subtreeDecls`
- 若变量视图实际变化，重建图

### `markSubtreeChanged()`

- 增加 subtree refresh 序号
- 重新加载 reachable subtree cache
- rebuild graph
- 不承担 host vars 刷新职责；宿主会直接补发新的 `varDeclLoaded`

## 文档变更命令

### `updateTreeMeta(payload)`

- 规范化 `desc`、`prefix`、`export`
- 校验 import paths
- 若 payload 显式携带 `custom`，则按 Inspector 规则接收 `string | number | boolean` 值
- 排序 locals 与 import refs
- Inspector 可按字段或局部列表独立构造 payload；无关字段错误不应阻断本次 intent
- `custom` 的重复 key、对象/数组字面量或非法结构化输入不得静默写入主文档
- webview 只发送 intent，宿主仅在值确实变化时提交 mutation

### `updateNode(payload)`

webview 在发送 intent 前只补齐 host reducer 需要的上下文：

- payload 会先补齐 `currentNodeSnapshot`
- 若本次是把 subtree link 改回本地节点，还会补齐 `detachedSubtreeRoot`
- Inspector 可按单字段或局部提交单元构造本次 payload；无关字段错误不应阻断本次 intent
- 当节点类型切换引入新的 required args 时，未显式设置的 arg 在首次提交中保持 unset，不应被静默写成占位空值
- 是否 noop、是否错误、是否提交由宿主 reducer 决定

host reducer 当前分三条路径：

#### A. 主树普通节点

- 直接在主文档结构上修改该节点
- 若新填入 `path` 且与原值不同，清空本地 `children`

#### B. subtree 内部节点

- 不改 subtree 源文件
- 以 payload 自带的 `subtreeOriginal` 对比出 diff
- 写入或清理主文档 `overrides`

#### C. 从 subtree link 脱链

- 若原节点有 `path`，且这次清空 `path`
- 先把当前 resolved 子树重新持久化为主树节点结构
- 再应用当前表单值

### `performDrop(intent)`

- canvas 先发送 `mutateDocument(performDrop)` intent 给宿主
- 宿主当前会优先直接提交，在内部消费 reducer `nextSelection`，并只通过 committed `documentSnapshotChanged.selection` 公开共享选中结果
- 拒绝拖动 subtree 内部节点
- 拒绝向 subtree link 直接添加 child
- 拒绝移动根节点、围绕根节点 before/after、移动到自己的后代下
- 合法时在主树结构中重排 children

### `copyNode()`

- 从当前 resolved node 构建 persisted snapshot
- 根节点 `path` 会被清掉，避免复制出 link 壳子
- 写入系统剪贴板 JSON

### `pasteNode()`

- canvas 先发送 `mutateDocument(pasteNode)`，并携带剪贴板节点快照
- 宿主直接提交后把新节点选中折叠进 committed snapshot `selection`
- 从剪贴板读取 persisted snapshot
- 为整棵粘贴子树分配新的稳定 id
- 追加到当前节点 children

### `insertNode()`

- canvas 先发送 `mutateDocument(insertNode)`
- 宿主直接提交后把新节点选中折叠进 committed snapshot `selection`
- 在当前节点下追加一个最小节点：
  - `uuid`
  - `id: ""`
  - `name: "unknown"`

### `saveDocument()`

- 主编辑器或侧栏发起保存后，最终都进入 VS Code custom editor 保存生命周期
- 宿主写盘前会重新解析当前主文档，并用 resolved graph 的主树 display id 回写 persisted `id`
- 该回写只作用于主树结构节点，不把 subtree 内部实例 id 反写到主文档
- 保存成功后，宿主当前 history 游标快照同步替换为写盘后的规范化内容

### `replaceNode()`

- canvas 先发送 `mutateDocument(replaceNode)`，并携带剪贴板节点快照
- 用剪贴板节点替换当前主树节点
- 保留当前节点根部的 `uuid`
- 子节点重新分配稳定 id

### `deleteNode()`

- canvas 先发送 `mutateDocument(deleteNode)`
- 宿主直接提交后把父节点选中折叠进 committed snapshot `selection`
- 不能删除根节点
- 删除后默认选中父节点

## Undo / Redo / History

### `undo()` / `redo()`

- 通过 host session 恢复序列化快照实现
- webview 接收宿主 `documentSnapshotChanged` 后重新应用主树、subtree cache、图和选中

### history push 规则

- host-first 正常路径下，权威 history 只由 host session 推进
- webview 不再维护局部 projection history

## Save / Revert / Build

### `saveDocument()`

- 比较文档版本，拒绝保存“新版本生成的文件”
- 通过 host `saveDocument` 请求落盘
- 成功后清理 dirty 与 reload conflict

### `revertDocument()`

- 通过 host `revertDocument` 请求回滚
- 真正 reload 由宿主后续 `documentSnapshotChanged(syncKind: "reload")` 驱动

### `buildDocument(opts?)`

- 只是把 build 请求交给宿主
- 结果通过 `buildResult` 回推

### `behavior3.batchProcess`

- 这是 extension-host 项目命令，不经过 editor `EditorCommand` catalog
- 选择一次性批处理脚本后，对当前 project 的 persisted tree 源文件做批量处理
- 仅当整次批处理通过校验时才统一写回源文件，避免部分写盘

### `behavior3.runBatchProcessScript`

- 这是 extension-host 项目命令，不经过 editor `EditorCommand` catalog
- 直接把当前选择的 `.ts` / `.mts` / `.js` / `.mjs` 文件当成批处理脚本执行
- 与 `behavior3.batchProcess` 共享同一套项目解析、校验和统一写回语义

## Subtree 相关命令

### `openSubtreePath(path)`

- 规范化 path
- 通过 host `readFile(..., { openIfSubtree: true })` 打开对应 subtree

### `openSelectedSubtree()`

- 优先读取当前节点 `path`
- 若当前选中的是 subtree 内部节点，则退回 `subtreeStack` 的最后一个路径

### `saveSelectedAsSubtree()`

- canvas 先发送 `mutateDocument(saveSelectedAsSubtree)`，并携带当前子树快照与建议文件名
- 宿主直接负责弹保存路径、写盘，并把当前节点选中折叠进 committed snapshot `selection`
- 将当前选中子树序列化为新的 `PersistedTreeModel`
- 通过宿主 `saveSubtreeAs` 选择路径并写盘
- 成功后将主树中的当前节点替换成 subtree link

## Selection Restore 规则

graph rebuild 后，恢复选中按以下优先级回绑：

1. 原 `instanceKey`
2. `structuralStableId + sourceStableId + sourceTreePath`
3. `sourceStableId + sourceTreePath`
4. `structuralStableId`
5. 若仍失败，则退回 tree 选中

## 验收清单

- 任一用户动作都能指出最终进入了哪个 command
- 任一 reload/save/undo 路径都能说明何时改树、何时改视觉状态
- 侧栏代理编辑与主编辑器本地编辑得到的最终语义一致
