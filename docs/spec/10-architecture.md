# Architecture

## 总体结构

当前架构由三层组成：

1. Extension-host 层
2. Webview runtime 层
3. Shared domain / protocol 层

推荐理解方式：

```text
VS Code Providers
  -> TreeEditorProvider
  -> InspectorSidebarProvider
  -> InspectorSidebarCoordinator
  -> per-document TreeEditorSession

TreeEditorSession
  -> document save/revert queue
  -> file / subtree / settings watchers
  -> project index
  -> build + node-check runtime
  -> host <-> webview message bridge

Webview Runtime
  -> documentStore
  -> workspaceStore
  -> selectionStore
  -> graphUiStore
  -> controller runtime + EditorCommand
  -> G6GraphAdapter
  -> Inspector forms / GraphPane / SearchBar

Shared Layer
  -> contracts.ts
  -> message-protocol.ts
  -> protocol.ts
  -> tree / subtree / resolve-graph utilities
```

## 层职责

### Extension-host

职责：

- 管理 VS Code custom editor 生命周期
- 维护 `TreeEditorDocument.content` 与磁盘文件的保存/回滚关系
- 维护主文档 `sessionState` 的 dirty、history、save/reload conflict 元数据
- 串行化主文档 save、revert、external reload、sidebar proxy mutation
- 执行 save、undo、redo 这类主文档 intent，并把权威结果广播回 webview
- 对 editor / sidebar 的 `updateTreeMeta` / `updateNode` 运行 host-first shared reducer；`updateNode` 所需节点快照由 intent 显式携带，不再回退到主编辑器兼容执行链
- 维护当前共享 tree/node 选中，并把它折叠进 `init` / `documentSnapshotChanged`
- 监听主文件、subtree 文件、setting 文件、workspace 文件、VS Code 配置与主题变化
- 解析 nodeDefs、工作目录、变量声明、可见文件列表
- 运行 build 与节点参数自定义检查脚本
- 协调 Inspector Sidebar 与当前激活编辑器之间的上下文同步

### Webview Runtime

职责：

- 持有结构化文档状态、工作区状态、host-projected selection authority 与本地 graph UI state
- 解析 `persistedTree + subtreeSources + nodeDefs` 为 resolved graph
- 将 resolved graph 投影到 G6 画布模型
- 执行本地 UI / graph / Inspector projection 命令；主文档编辑命令只组装 intent 与必要 payload context
- 把 save、undo、redo 作为用户 intent 发给宿主，再消费宿主回推的权威 session/content
- editor / sidebar 的 `updateTreeMeta` / `updateNode` 都只发送 intent，不再先在本地 reducer 判定提交结果或提交主文档状态
- 管理 selection restore、search、variable focus、graph-only selection hint，以及宿主回推 document/session/selection snapshot 的本地 projection 刷新逻辑

### Shared Layer

职责：

- 定义 host/webview 协议和内部稳定 DTO
- 封装 workdir-relative path 规范
- 统一 persisted tree 的解析、序列化、subtree 遍历与 stable id 生成
- 提供 resolved graph 与图视图模型转换工具

## 关键组件

### TreeEditorProvider

- 注册自定义编辑器
- 为每个打开的主文档建立 `TreeEditorSession`
- 向对应 webview 投递宿主消息

### InspectorSidebarCoordinator

- 维护当前激活文档的快照
- 将主编辑器的 init/documentSnapshot/vars 镜像到侧栏
- 将侧栏发起的保存、回滚、变更代理回当前激活编辑器

### TreeEditorSession

- 是 extension-host 侧的文档会话核心
- 负责消息分发、监听器、项目索引、文档版本保护、host document session 与主文档操作队列

### EditorCommand + Controller Runtime

- 是 webview 内唯一的业务命令入口
- 统一负责应用文档树、同步 subtree 缓存、重建图与通知宿主；history/save/dirty 语义由 host session 推进

### G6GraphAdapter

- 是唯一图层运行时
- 只接收 `ResolvedGraphModel` 和视觉状态，不直接接触 persisted tree

## 关键事件流

### 启动

1. webview 发送 `ready`
2. extension-host 返回带当前 `selection` 的 `init`
3. extension-host 计算变量与文件列表后补发 `varDeclLoaded`
4. webview 初始化 stores，构建 resolved graph，渲染 G6

### 本地交互与投影

1. 用户在图或 Inspector 中触发命令
2. controller 对主文档编辑只组装 `mutateDocument` intent 与必要 payload context
3. extension-host session reduce、提交并 fanout 权威 snapshot
4. runtime 消费 snapshot，更新 `persistedTree` projection
5. runtime 同步 reachable subtree cache，重建 resolved graph 与 graph view model
6. runtime 只维护本地 graph / Inspector projection；变量声明视图由宿主直接基于已提交 snapshot 刷新

说明：

- 主文档 mutation 已全部走 host-first intent 提交
- save、undo、redo 已不再由该路径直接落地执行

### Save / Undo / Redo

1. editor 或 sidebar webview 发送 `saveDocument` / `undo` / `redo` intent
2. extension-host session 在主文档操作队列内执行对应的 save 或 history 迁移
3. 宿主以带当前 `selection` 的 `documentSnapshotChanged` 回推权威结果；若变量视图受影响，再单独补发 `varDeclLoaded`

### Host-First Mutation Intent

1. Inspector Sidebar 或主编辑器 canvas 发送 `mutateDocument`
2. extension-host document session 在 host 侧直接 reduce 并提交权威 snapshot
3. host 若无法提交，则直接返回权威错误，而不是转回主编辑器执行
4. 普通 tree/node 选中通过 `selectTree` / `selectNode` 先进入 host；editor 可保留 graph-only 本地视觉 hint，但 `selectionStore` 的共享选中 projection 只由 committed `documentSnapshotChanged.selection` 更新
5. 结构命令在 host 内部可先产出 reducer `nextSelection`，但对外只通过 committed `documentSnapshotChanged.selection` 更新 editor / sidebar projection

### 外部文件变化

1. extension-host 监听到主文件变化
2. 若该变化是自身刚写出的内容，则抑制回流
3. 若当前文档不 dirty，发送 `documentSnapshotChanged(syncKind: "reload")`
4. 若当前文档 dirty，仍发送 `documentSnapshotChanged`，但只提升 session 冲突状态，不提交外部内容

### Subtree 文件变化

1. extension-host 只跟踪当前主树可达的 subtree 集合
2. 被跟踪 subtree 改动后，session 直接刷新 vars，并发送 `subtreeFileChanged`
3. webview 重新拉取 subtree 内容并 rebuild graph

## 架构约束

1. 图层不是文档真源。
2. Inspector Sidebar 不是第二个独立编辑器实现。
3. 宿主消息兼容、路径归一化和 IO 细节只停留在 host/session/adapter 层。
4. 任何 persisted tree 写入都必须能定位到一个明确的 command。
5. save、undo、redo 必须先进入 extension-host session，再广播回 webview。
6. canvas / sidebar 的主文档 mutation intent 必须先进入 extension-host session。
7. 与项目根目录、build、nodeDefs、check scripts 相关的能力只在 extension-host 侧实现。

## 当前目录落点

- `src/`
  - provider、session、coordinator、build、settings、project index
- `webview/app/`
  - runtime 创建、host bridge、应用壳层
- `webview/commands/`
  - controller runtime 与命令实现
- `webview/stores/`
  - document / workspace / selection / graph-ui store
- `webview/domain/`
  - resolve graph、graph selectors、tree validation
- `webview/adapters/`
  - G6 graph adapter、VS Code host adapter
- `webview/features/`
  - graph、search、inspector UI
- `webview/shared/`
  - contracts、protocol、tree、subtree cache、shared helpers

## 架构验收标准

- 主编辑器、侧栏、宿主三者职责清晰，不通过隐式共享状态耦合
- 任一外部变化都能指出“在哪一层被吸收、在哪一层变成业务事件”
- 任一图交互都能指出“图层只负责表达什么，controller 负责决定什么”
