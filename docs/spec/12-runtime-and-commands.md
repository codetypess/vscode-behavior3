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
- `GraphAdapter`
- `HostAdapter`
- `EditorCommand`

## 状态归属表

| 状态 | 当前归属 |
| --- | --- |
| `persistedTree` / `dirty` / `history` / `lastSavedSnapshot` / reload conflict | `documentStore` |
| `nodeDefs` / `allFiles` / `settings` / `usingVars` / `subtreeSources` / `nodeCheckDiagnostics` | `workspaceStore` |
| tree/node 选中、Inspector snapshot、variable focus、search 状态 | `selectionStore` |
| `ResolvedDocumentGraph` | controller runtime 私有缓存 |
| 图节点尺寸、布局结果、视口、选中视觉态、drag intent | `graphAdapter` |
| 主文档序列化文本、custom editor dirty、磁盘写入抑制 | extension-host `TreeEditorDocument` |
| 文件监听、项目索引、build、check scripts、当前激活 inspector 会话 | extension-host session / coordinator |

## EditorCommand Catalog

### 启动与宿主同步

- `initFromHost(payload)`
- `syncDocumentFromHost(content)`
- `reloadDocumentFromHost(content, opts?)`
- `applyNodeDefs(defs)`
- `applyHostVars(payload)`
- `markSubtreeChanged()`
- `dismissReloadConflict()`

职责：

- 初始化三类 store
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

- 改写 selection/search 相关 store
- 驱动 graph adapter 应用 selection/highlight/search 状态
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
- 必要时同步 subtree cache、重建图、推进 history、通知宿主

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

### `commitTreeMutation(tree, opts?)`

- 可在提交前准备下一次选中状态
- 应用新树
- 推进 history
- 触发 `treeSelected`

### `rebuildGraph(opts?)`

- 根据当前主树、subtreeSources、nodeDefs、`subtreeEditable` 重新 resolve graph
- 重新请求节点参数检查结果
- 重建 `ResolvedGraphModel`
- 交给 `graphAdapter.render`
- 恢复 selection，再应用 visual state

### `applyVisualState()`

- 根据 `selectionStore` 计算 selection/highlights/search
- 分别调用 `graphAdapter.applySelection/applyHighlights/applySearch`

### `syncReachableSubtreeSources()`

- 对当前主树可达 subtree 递归 `readFile`
- 解析成功则填充缓存
- 若加载时发现缺少稳定 id，则回写规范化 subtree

## HostAdapter 责任

`HostAdapter` 当前负责：

- 连接 webview 与 `window.postMessage`
- 归一化 `init` / `varDeclLoaded` 等宿主消息
- 管理带 `requestId` 的异步请求
- 为 `readFile` / `saveSubtree` / `saveDocument` / `mutateDocument` / `validateNodeChecks` 提供 Promise 风格 API
- 对 host request 设置超时保护

## Sidebar 代理规则

Inspector Sidebar 当前不是直接改主树，而是：

1. 发送 `mutateDocument`
2. 由宿主转发到当前激活主编辑器
3. 主编辑器执行真正的 `EditorCommand`
4. 宿主把结果和更新后的文档内容回传给侧栏

这条规则意味着：

- 只有主编辑器 webview 会真正执行树结构修改
- 侧栏可以触发表单提交、保存、撤销、重做，但不拥有独立的 mutation runtime

## 验收标准

- 任意 persisted tree 写入都能指出唯一的 `EditorCommand`
- 任意宿主请求都能指出唯一的 `HostAdapter` 方法
- 任意图视觉状态变化都能指出唯一的 `graphAdapter` 入口
- 任一字段只存在于一个明确的可写真源中
