# Host Protocol

## 目的

本文件定义当前 extension-host 与 webview 之间的 raw message、归一化 DTO、路径语义以及侧栏代理规则。

原则：

- raw message 可以面向 VS Code 生命周期和宿主实现
- webview controller 与业务层只消费归一化后的 DTO
- 路径规范化、请求超时和消息兼容细节只能停留在 host/session/adapter 层

## Path Rules

编辑器内部当前只承认两类路径：

- `AbsoluteFsPath`
  - 仅用于宿主返回或持有的绝对文件路径，例如主文档 `filePath`
- `WorkdirRelativeJsonPath`
  - 编辑器内部对 subtree、import、allFiles、`NodeInstanceRef.sourceTreePath` 使用的相对 `.json` 路径

规则：

1. `WorkdirRelativeJsonPath` 必须是 workdir 内部路径。
2. 不允许绝对路径、URI scheme、`..`、空段或非 `.json` 结尾。
3. 进入 controller 之前，路径必须已经被 `parseWorkdirRelativeJsonPath` 规范化。
4. 图层和 Inspector 不负责路径拼接或越界判断。

## Editor -> Host Raw Messages

### 生命周期与主文档

- `ready`
- `undo`
- `redo`
- `saveDocument`
  - payload: `{ requestId }`
- `revertDocument`
  - payload: `{ requestId }`

### 代理与同步

- `mutateDocument`
  - payload: `{ requestId, mutation }`
- `selectTree`
- `selectNode`
  - payload: `{ target: NodeInstanceRef }`
- `requestFocusVariable`
  - payload: `{ names }`
  - 语义：sidebar 请求把变量聚焦作为一次性视觉 intent relay 给当前 active editor；不是共享状态同步

### 项目与设置

- `requestSetting`
- `build`
  - payload: `{ buildScriptDebug? }`
- `validateNodeChecks`
  - payload: `{ requestId, content, treePath, nodes }`

### 文件读写

- `readFile`
  - payload: `{ requestId, path, openIfSubtree? }`
- `saveSubtree`
  - payload: `{ requestId, path, content }`
- `saveSubtreeAs`
  - payload: `{ requestId, content, suggestedBaseName }`

### 诊断与日志

- `webviewLog`
  - payload: `{ level, message }`

## Host -> Editor Raw Messages

### 初始化与文档同步

- `init`
- `documentSnapshotChanged`

语义区别：

- `init`
  - 宿主返回当前 committed `content`、`HostDocumentSessionState`、`HostSelectionState`
  - 用于 editor / sidebar 的统一启动快照
- `documentSnapshotChanged`
  - 宿主把权威 committed document snapshot 广播给 editor 或 sidebar
  - payload 同时包含：
    - committed `content`
    - `HostDocumentSessionState`
    - `HostSelectionState`
    - `syncKind` (`update` / `reload`)
  - 外部文件 dirty 冲突也通过这条消息提升 session 冲突态，而不是另发一条内容消息

### 编辑命令代理

- `relayFocusVariable`
  - 语义：宿主向 editor 投递一次新鲜变量聚焦 relay
  - 不属于 `init` / `documentSnapshotChanged` 的 snapshot 内容

### 环境与依赖变化

- `settingLoaded`
- `varDeclLoaded`
- `themeChanged`
- `subtreeFileChanged`
- `buildResult`

### Inspector Sidebar 同步

- `inspectorContextCleared`

### request/response 结果消息

- `readFileResult`
- `saveSubtreeResult`
- `saveSubtreeAsResult`
- `saveDocumentResult`
- `mutateDocumentResult`
- `revertDocumentResult`
- `validateNodeChecksResult`

## Normalized DTOs

### HostInitPayload

- `filePath`
  - 当前主文档绝对路径
- `workdir`
  - 当前行为树项目根目录，不一定等于 VS Code workspace folder
- `content`
  - 当前主文档文本
- `nodeDefs`
- `allFiles`
- `settings`
- `documentSession`
  - 当前宿主 document session 元数据
- `selection`
  - 当前宿主共享选中快照
  - 只承载 tree/node selection，不承载 variable focus

### HostDocumentSessionState

- `dirty`
- `historyIndex`
- `historyLength`
- `lastSavedSnapshot`
- `alertReload`
- `pendingExternalContent`

### HostVarsPayload

- `usingVars`
  - 合并后的变量可见视图
- `allFiles`
  - 可选更新后的文件列表
- `importDecls`
  - import 文件的有序变量声明视图
- `subtreeDecls`
  - subtree 文件的有序变量声明视图

### HostSelectionState

- `{ kind: "tree" }`
- `{ kind: "node", ref: NodeInstanceRef }`

说明：

- 它是 host 当前共享 tree/node 选中的权威 DTO
- editor 与 sidebar 都只消费这个快照，再各自在本地 resolved graph 上做 projection
- variable focus 不属于 `HostSelectionState`；它只通过瞬时 `relayFocusVariable` relay 进入 editor-local graph UI state

### HostDocumentSnapshot

- `content`
- `documentSession`
- `selection`
- `syncKind`

说明：

- `selection` 是 committed fanout 时唯一公开的共享选中权威结果
- reducer `nextSelection` 及其 helper 类型只保留在 host session / reducer 内部，不属于稳定对外协议或 public contracts
- snapshot 不承载 variable focus；reload/save/undo/redo/webview re-init 都不能从 snapshot 恢复变量高亮

### NodeInstanceRef

- `instanceKey`
- `displayId`
- `structuralStableId`
- `sourceStableId`
- `sourceTreePath`
- `subtreeStack`

它是 graph、Inspector、drag/drop、side panel selection sync 使用的稳定业务引用。

### DocumentMutation

当前 `mutation` intent 包含两组：

1. shared reducer 已直接支持的 mutation：
   - `updateTreeMeta`
   - `updateNode`
2. 已迁入 host intent，并默认由宿主直接提交的结构命令：
   - `performDrop`
   - `pasteNode`
   - `insertNode`
   - `replaceNode`
   - `deleteNode`
   - `saveSelectedAsSubtree`

这些 intent 既可以来自 Inspector Sidebar，也可以来自主编辑器 canvas。

补充：

- `updateNode` intent 会携带 `currentNodeSnapshot`
- 该快照来自当前发起 webview 的选中节点投影，包含 host reducer 需要的当前节点数据、subtree 标记和 `subtreeOriginal`
- `updateNode` 在“解绑 subtree 引用为本地节点”时可以携带 `detachedSubtreeRoot`
- `detachedSubtreeRoot` 由当前 webview runtime 提供，供 host reducer 直接提交
- 真正的共享 selection authority 在 `init.selection` / `documentSnapshotChanged.selection`
- reducer `nextSelection` 及其 helper 类型只用于 host 在提交时更新自身 `sharedSelection`
- `mutateDocumentResult` 只承担成功/失败应答，不再承载共享选中结果

## 会话规则

### 1. `ready` 握手

主编辑器或侧栏 webview 启动后，先发 `ready`，宿主返回：

1. `init`
2. 如果变量索引成功，再补发 `varDeclLoaded`

### 2. 主文档操作串行化

在 extension-host session 中，以下操作共用一条主文档操作队列：

- `undo`
- `redo`
- `saveDocument`
- `revertDocument`
- 外部主文件 reload
- host-first mutation 回写

目的是避免 watcher 与多来源消息交错，把文档推进到不一致状态。

### 3. Host-First Mutation Intent

- Sidebar 和 canvas 都不能绕过宿主直接提交主文档 mutation
- 宿主收到 `mutateDocument` 后优先尝试在 host 侧直接 reduce 并提交
- 若宿主无法提交 mutation，则直接返回错误给发起方

### 4. 请求超时

`HostAdapter` 对 request/response 风格调用设置超时保护；超时后返回失败结果或空内容，而不是无限等待。

## 版本保护规则

当前宿主协议还承担“新版本文件保护”：

- 若主文档版本高于当前扩展支持版本，则阻止编辑与保存
- 若目标 subtree 文件版本更高，则阻止覆盖保存

该保护发生在 extension-host session 层，而不是图层或 Inspector 层。

## 验收标准

- 任意 host message 的 raw shape 都能只靠本文件理解
- 任意 DTO 字段都能指出它属于宿主原始数据还是归一化内部语义
- 任一路径值都能判断它是绝对路径还是 workdir-relative `.json` 路径
