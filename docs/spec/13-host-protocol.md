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
- `update`
  - payload: `{ content: string }`
- `undo`
- `redo`
- `saveDocument`
  - payload: `{ requestId }`
- `revertDocument`
  - payload: `{ requestId }`

### 代理与同步

- `mutateDocument`
  - payload: `{ requestId, mutation }`
- `documentMutationResult`
  - payload: `{ requestId, success, error?, content? }`
- `treeSelected`
  - payload: `{ tree }`
- `reportInspectorSelection`
  - payload: `{ selectedNode }`
- `focusVariable`
  - payload: `{ names }`

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
- `documentSessionChanged`
- `documentUpdated`
- `fileChanged`
- `documentReloaded`

语义区别：

- `documentSessionChanged`
  - 宿主把权威 document session 元数据广播给 editor 或 sidebar
- `documentUpdated`
  - 宿主提交了主文档 update、undo、redo 或 host-first mutation 后，把最新内容同步给当前视图
- `fileChanged`
  - 磁盘文件外部变化到来，但当前编辑器可能仍 dirty，需要走冲突判断
- `documentReloaded`
  - 宿主已经决定用磁盘版本或已保存版本覆盖当前文档，应强制 reload

### 编辑命令代理

- `executeDocumentMutation`
- `focusVariable`

### 环境与依赖变化

- `settingLoaded`
- `varDeclLoaded`
- `themeChanged`
- `subtreeFileChanged`
- `buildResult`

### Inspector Sidebar 同步

- `inspectorSelectionChanged`
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

### NodeInstanceRef

- `instanceKey`
- `displayId`
- `structuralStableId`
- `sourceStableId`
- `sourceTreePath`
- `subtreeStack`

它是 graph、Inspector、drag/drop、side panel selection sync 使用的稳定业务引用。

### DocumentMutation

当前仅有两种代理 mutation：

- `updateTreeMeta`
- `updateNode`

它们用于 Inspector Sidebar 代理主编辑器修改。

补充：

- `updateNode` 在“解绑 subtree 引用为本地节点”时可以携带 `detachedSubtreeRoot`
- 该快照由 sidebar 当前 runtime 提供，供 host reducer 直接提交

## 会话规则

### 1. `ready` 握手

主编辑器或侧栏 webview 启动后，先发 `ready`，宿主返回：

1. `init`
2. 如果变量索引成功，再补发 `varDeclLoaded`

### 2. 主文档操作串行化

在 extension-host session 中，以下操作共用一条主文档操作队列：

- `update`
- `undo`
- `redo`
- `saveDocument`
- `revertDocument`
- 外部主文件 reload
- 侧栏代理 mutation 回写

目的是避免 watcher 与多来源消息交错，把文档推进到不一致状态。

### 3. Sidebar 代理

- Sidebar 不能直接执行主文档 mutation
- 宿主收到 `mutateDocument` 后优先尝试在 host 侧直接 reduce 并提交
- 只有在 host 当前缺少必要上下文时，才回退为 `executeDocumentMutation`
- 若走兼容回退，主编辑器执行后再把结果回给宿主，再由宿主回复 sidebar

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
