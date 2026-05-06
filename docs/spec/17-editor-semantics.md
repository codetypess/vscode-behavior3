# Editor Semantics

## 目的

本文件定义当前编辑器命令、图刷新、save/reload/history、Inspector Sidebar 代理与宿主往返流程的稳定语义。

## 总规则

### Rule 1. 所有主文档写入都走 `EditorCommand`

无论变更来自：

- 主编辑器图交互
- Inspector Sidebar 表单
- 快捷键
- 宿主代理 mutation

最终都必须落到主编辑器 runtime 的 `EditorCommand`。

### Rule 2. “改树”和“改视觉状态”要分开

- 结构化主树更新统一走 `applyDocumentTree`
- 纯选中、高亮、搜索变化走 `applyVisualState`

### Rule 3. reload conflict 不是自动合并

- 外部磁盘变化与本地未保存修改冲突时，只进入 `alertReload`
- 需要用户显式选择 reload 或 dismiss

### Rule 4. Inspector Sidebar 是代理而不是第二套写模型

- 侧栏可以发起 mutation/save/undo/redo
- 真正执行这些动作的是当前激活主编辑器或宿主 custom editor 生命周期

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

- 从 `selectionStore` 计算 graph selection
- 计算 variable highlights
- 计算 search result keys 与 active index
- 分别下发到 graph adapter

### `applyDocumentTree(tree, opts?)`

- 可预先写入“待恢复 selection”
- 应用新树
- 同步 subtree cache
- rebuild graph
- 不维护 webview-local history projection
- 不直接把主文档内容写回宿主
- 调度 `treeSelected`

## Selection 语义

### `selectTree()`

- 清空节点选中
- 保留或清除 variable focus，取决于调用路径
- 向侧栏同步 tree 级上下文

### `selectNode(nodeKey, opts?)`

- 选中 resolved graph 中的实例节点
- 若节点已选中且未强制刷新，可只重发侧栏选中
- 若来自变量热点点击，可选择保留 variable focus

### `focusVariable(names)`

- 仅更新 `activeVariableNames`
- 不修改文档或 history
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

### `nextSearchResult()` / `prevSearchResult()`

- 在结果集内循环移动
- 同步选中和图聚焦

## Host 驱动命令

### `initFromHost(payload)`

- 初始化 workspace state
- 解析主文档文本为 `persistedTree`
- 选择 tree
- 构建首个 resolved graph
- 应用宿主 document session projection

### `syncDocumentFromHost(content)`

- 用于吸收其他视图或宿主推送的最新主文档内容
- 若内容与当前结构化快照等价，则只清理 conflict 状态
- 否则更新主树并保持 selection 尽量稳定，不在 webview 本地推进 history

### `reloadDocumentFromHost(content, opts?)`

- 用于磁盘 reload
- 若 dirty 且未 `force`，进入 conflict 状态
- 否则直接替换当前主树并清理 conflict projection

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
- 立即触发 `treeSelected`

## 文档变更命令

### `updateTreeMeta(payload)`

- 规范化 `desc`、`prefix`、`export`
- 校验 import paths
- 排序 locals 与 import refs
- 仅在值确实变化时提交 mutation

### `updateNode(payload)`

当前分三条路径：

- payload 会先补齐 `currentNodeSnapshot`
- 若本次是把 subtree link 改回本地节点，还会补齐 `detachedSubtreeRoot`

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
- 宿主当前会优先直接提交，并在 response 中回传 `nextSelection`
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
- 宿主直接提交后回传新节点的 `nextSelection`
- 从剪贴板读取 persisted snapshot
- 为整棵粘贴子树分配新的稳定 id
- 追加到当前节点 children

### `insertNode()`

- canvas 先发送 `mutateDocument(insertNode)`
- 宿主直接提交后回传新节点的 `nextSelection`
- 在当前节点下追加一个最小节点：
  - `uuid`
  - `id: ""`
  - `name: "unknown"`

### `replaceNode()`

- canvas 先发送 `mutateDocument(replaceNode)`，并携带剪贴板节点快照
- 用剪贴板节点替换当前主树节点
- 保留当前节点根部的 `uuid`
- 子节点重新分配稳定 id

### `deleteNode()`

- canvas 先发送 `mutateDocument(deleteNode)`
- 宿主直接提交后回传父节点的 `nextSelection`
- 不能删除根节点
- 删除后默认选中父节点

## Undo / Redo / History

### `undo()` / `redo()`

- 通过 host session 恢复序列化快照实现
- webview 接收宿主回推的 committed content 后重新应用主树、subtree cache、图和选中

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
- 真正 reload 由宿主后续 `documentReloaded` 驱动

### `buildDocument(opts?)`

- 只是把 build 请求交给宿主
- 结果通过 `buildResult` 回推

## Subtree 相关命令

### `openSubtreePath(path)`

- 规范化 path
- 通过 host `readFile(..., { openIfSubtree: true })` 打开对应 subtree

### `openSelectedSubtree()`

- 优先读取当前节点 `path`
- 若当前选中的是 subtree 内部节点，则退回 `subtreeStack` 的最后一个路径

### `saveSelectedAsSubtree()`

- canvas 先发送 `mutateDocument(saveSelectedAsSubtree)`，并携带当前子树快照与建议文件名
- 宿主直接负责弹保存路径、写盘，并在 response 中回传当前节点的 `nextSelection`
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
