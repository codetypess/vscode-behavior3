# Runtime and Commands

## 设计约束

当前运行时必须满足以下约束：

1. 主编辑器内唯一可写结构化文档是真实的 `documentStore.persistedTree`。
2. 图层、Inspector、搜索和变量高亮都只能消费派生数据，不能各自维护第二份可写树。
3. Extension-host 负责磁盘 IO、监听器、项目索引、构建与检查脚本运行。
4. 所有主文档结构修改都必须经过 `EditorCommand`。
5. Inspector Sidebar 的编辑只是代理，不拥有独立文档真源。

## 稳定内部接口

当前内部接口以以下文件为准：

- [`contracts.ts`](../../webview/shared/contracts.ts)
- [`graph-contracts.ts`](../../webview/shared/graph-contracts.ts)
- [`message-protocol.ts`](../../webview/shared/message-protocol.ts)
- [`protocol.ts`](../../webview/shared/protocol.ts)

当前稳定关注点：

- `DocumentState`
- `WorkspaceState`
- `SelectionState`
- `GraphUiState`
- `GraphAdapter`
- `HostAdapter`
- `EditorCommand`

## 状态归属表

| 状态 | 当前归属 |
| --- | --- |
| `persistedTree` / host-projected `dirty` / reload conflict | `documentStore` |
| `nodeDefs` / `allFiles` / `settings` / `usingVars` / `subtreeSources` / `nodeCheckDiagnostics` | `workspaceStore` |
| host-projected tree/node 选中、本地 Inspector selection projection | `selectionStore` |
| `activeVariableNames` / `search` / `selectionVisualHint` | `graphUiStore` |
| `ResolvedDocumentGraph` | controller runtime 私有缓存 |
| 图节点尺寸、布局结果、视口、选中视觉态、drag intent | `graphAdapter` |
| 主文档序列化文本、custom editor dirty、磁盘写入抑制 | extension-host `TreeEditorDocument` |
| 文件监听、项目索引、build、check scripts、当前激活 inspector 会话、共享 selection snapshot | extension-host session / coordinator |

## EditorCommand Catalog

### 启动与宿主同步

- `initFromHost(payload)`
- `applyDocumentSnapshot(snapshot)`
- `applyNodeDefs(defs)`
- `applyHostVars(payload)`
- `markSubtreeChanged()`
- `dismissReloadConflict()`

职责：

- 初始化四类 store
- 吸收宿主推送的主文档、变量声明、nodeDefs、subtree 变化
- 管理 reload conflict 状态

### 选中与可视状态

- `selectTree()`
- `selectNode(nodeKey, opts?)`
- `focusVariable(names)`
- `openSearch(mode)`
- `updateSearch(query)`
- `nextSearchResult()`
- `prevSearchResult()`
- `refreshGraph(opts?)`

职责：

- 维护本地 graph UI store（search / variable-focus / selection visual hint）
- 对用户选中手势发送 `HostAdapter.selectTree/selectNode` intent
- 仅通过宿主 `selection` snapshot 投影共享 tree/node selection 到 `selectionStore`
- `focusVariable(names)` 只更新 editor-local variable focus；sidebar 来源也只是 host relay，不是 snapshot authority
- 驱动 graph adapter 应用 selection/highlight/search 状态；graph-only 本地选中 hint 只进入 `graphUiStore`
- 在必要时触发节点聚焦

### 文档修改

- `updateTreeMeta(payload)`
- `updateNode(payload)`
- `performDrop(intent)`
- `copyNode()`
- `pasteNode()`
- `insertNode()`
- `replaceNode()`
- `deleteNode()`
- `undo()`
- `redo()`

职责：

- 是唯一允许修改主树结构或 `overrides` 的入口
- 必要时同步 subtree cache、重建图、通知宿主；history 推进由 host session 在提交后完成

### 文件与构建

- `saveDocument()`
- `revertDocument()`
- `buildDocument(opts?)`
- `openSubtreePath(path)`
- `openSelectedSubtree()`
- `saveSelectedAsSubtree()`

职责：

- 将文档操作映射到 host request / VS Code command
- 管理 subtree 打开与另存路径

## Controller Runtime 共享流程

当前 command 模块共享几条核心内部流程：

### `applyDocumentTree(tree, opts?)`

- 设置 `persistedTree`
- 视情况同步 reachable subtree sources
- 视情况 rebuild graph 或仅重放 visual state

### `applyDocumentTree(tree, opts?)`

- 可在提交前准备下一次选中状态
- 应用新树
- 视情况同步 subtree cache、重建 graph 或仅重放 visual state
- 不维护 webview-local history 镜像

### `rebuildGraph(opts?)`

- 根据当前主树、subtreeSources、nodeDefs、`subtreeEditable` 重新 resolve graph
- 重新请求节点参数检查结果
- 重建 `ResolvedGraphModel`
- 交给 `graphAdapter.render`
- 恢复 selection，再应用 visual state

### `applyVisualState()`

- 根据 `selectionStore + graphUiStore` 计算 selection/highlights/search
- 分别调用 `graphAdapter.applySelection/applyHighlights/applySearch`

### `syncReachableSubtreeSources()`

- 对当前主树可达 subtree 递归 `readFile`
- 解析成功则填充缓存
- 若加载时发现缺少稳定 id，则回写规范化 subtree

## HostAdapter 责任

`HostAdapter` 当前负责：

- 连接 webview 与 `window.postMessage`
- 归一化 `init` / `documentSnapshotChanged` / `varDeclLoaded` 等宿主消息
- 管理带 `requestId` 的异步请求
- 发送 `selectTree` / `selectNode` 这类轻量宿主 intent
- 为 `readFile` / `saveSubtree` / `saveDocument` / `mutateDocument` / `validateNodeChecks` 提供 Promise 风格 API
- 对 host request 设置超时保护

## Host-First Mutation 规则

当前 `mutateDocument` 已经同时服务于 Inspector Sidebar 和主编辑器 canvas：

1. webview 发送 `mutateDocument`
2. 宿主优先尝试在 host 侧直接 reduce 并提交
3. 当前 `updateTreeMeta` / `updateNode` / `performDrop` / `pasteNode` / `insertNode` / `replaceNode` / `deleteNode` / `saveSelectedAsSubtree` 已可直接在 host 提交
4. `updateNode` 在发送 intent 前会补齐 `currentNodeSnapshot`，若发生 subtree 脱链再补 `detachedSubtreeRoot`
5. webview 不在发送前运行 shared reducer 来判定 noop/error；是否提交、是否 noop、错误文案都由宿主 reducer / session 决定
6. 对于需要改选中的结构命令，宿主在内部消费 reducer `nextSelection`，并只通过 committed `documentSnapshotChanged.selection` 公开共享选中结果
7. 若宿主无法提交 mutation，则直接返回错误，不再把执行权转回主编辑器

这条规则意味着：

- canvas / sidebar 都先表达 mutation intent，而不是直接拥有主文档权威提交权
- tree/node 共享选中也先表达 host intent，再由 host snapshot fanout 回 editor / sidebar
- 侧栏可以触发表单提交、保存、撤销、重做，但不拥有独立的 mutation runtime

## 验收标准

- 任意 persisted tree 写入都能指出唯一的 `EditorCommand`
- 任意宿主请求都能指出唯一的 `HostAdapter` 方法
- 任意图视觉状态变化都能指出唯一的 `graphAdapter` 入口
- 任一字段只存在于一个明确的可写真源中
