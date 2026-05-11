# Architecture

## 总体结构

第一遍阅读时，先按四层理解当前实现：

| 层                    | 代码入口                                                                                           | 主要职责                                             |
| --------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Host authority        | `src/tree-editor-provider.ts`, `src/editor-session/`, `src/inspector-sidebar-coordinator.ts`       | VS Code 生命周期、IO、保存/回滚、history、selection  |
| Webview runtime       | `webview/app/`, `webview/commands/`, `webview/stores/`                                             | store projection、command intent、graph/Inspector 编排 |
| Pure model/contracts  | `webview/shared/`, `webview/domain/`                                                               | DTO、path、reducer、tree/graph 解析、保存序列化      |
| Adapters / feature UI | `webview/adapters/`, `webview/features/`, `webview/styles/`                                        | G6/VS Code bridge、Inspector/Graph/Search UI 与样式  |

这四层是阅读模型，不是新的运行时边界。实际依赖仍遵守下面的职责规则：host 拥有权威文档会话，webview 只表达 intent 和本地投影，shared/domain 保持纯模型，adapter/feature 负责外部库与 UI 细节。

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
  -> feature-owned Inspector / Graph selectors and UI

Shared Layer
  -> contracts.ts
  -> message-protocol.ts
  -> host-request-spec.ts
  -> protocol.ts
  -> tree / subtree / validation utilities
  -> state-free node definition, node arg, slot and override helpers

Adapters / Features
  -> VS Code host adapter
  -> G6 graph adapter
  -> Inspector / Graph / Search UI
  -> SCSS partials
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
- `app/runtime.tsx` 只提供 runtime/provider、基础 store hook 和应用壳层状态；Inspector / Graph 的 selector 归各自 feature 模块所有
- 执行本地 UI / graph / Inspector projection 命令；主文档编辑命令只组装 intent 与必要 payload context
- 把 save、undo、redo 作为用户 intent 发给宿主，再消费宿主回推的权威 session/content
- editor / sidebar 的 `updateTreeMeta` / `updateNode` 都只发送 intent，不再先在本地 reducer 判定提交结果或提交主文档状态
- 管理 selection restore、search、variable focus、graph-only selection hint，以及宿主回推 document/session/selection snapshot 的本地 projection 刷新逻辑

### Shared Layer

职责：

- 定义 host/webview 协议和内部稳定 DTO
- 封装 workdir-relative path 规范
- 维护 host request/response registry、timeout fallback 与结果解析映射
- 统一 persisted tree 的解析、序列化、subtree 遍历与 stable id 生成
- 提供无 UI / 无 domain 依赖的共享校验与纯 helper
- build-only 状态只保留在显式 build context 中；feature/domain 代码应直接依赖 state-free shared helper

约束：

- `webview/shared/**` 不应依赖 `webview/domain/**`、`webview/features/**` 或 adapter 实现。
- resolved graph、图视图模型转换与主文档 save 前 display id 回写属于 `webview/domain/**`。

### Adapters / Feature UI

职责：

- 将外部运行时细节限制在边界内，例如 G6 public/compat API、VS Code `postMessage`、Ant Design 表单与样式组织
- 把用户交互转换成 `EditorCommand` 调用或 adapter event，不直接提交 persisted tree
- 消费 controller/runtime 提供的 resolved graph、selection、validation、search 与变量高亮投影
- 保持 className、graph view model 和 Inspector DTO 的兼容性

约束：

- 图层不能成为文档真源。
- feature UI 不应直接绕过 `EditorCommand` 修改主文档。
- adapter 兼容逻辑留在 adapter-local helper 中，不扩散到 domain/shared。

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
- `readFile` / `saveSubtree` / `saveSubtreeAs` 这类 host 文件请求委托给 session-local helper，session 仍保留 raw message 路由权

### EditorCommand + Controller Runtime

- 是 webview 内唯一的业务命令入口
- 统一负责应用文档树、同步 subtree 缓存、重建图与通知宿主；history/save/dirty 语义由 host session 推进

### G6GraphAdapter

- 是唯一图层运行时
- 只接收 `ResolvedGraphModel` 和视觉状态，不直接接触 persisted tree
- 对 G6 public type 缺口或内部 shape 的读取必须通过 adapter-local compat helper 隔离

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
3. save 会在写主文档前显式 flush 当前可达 legacy subtree 的规范化写回
4. 宿主以带当前 `selection` 的 `documentSnapshotChanged` 回推权威结果；若变量视图受影响，再单独补发 `varDeclLoaded`

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
3. webview 重新拉取 subtree 内容并 rebuild graph；该加载过程不直接写回 subtree 文件

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
    - provider、coordinator、build、project/settings discovery
- `src/editor-session/`
    - `tree-editor-webview-session.ts` owns host session orchestration
    - `session-context.ts` owns explicit session startup context, derived workspace/project state, and shared session runtime dependencies
    - `session-inspector-sync.ts` owns Inspector/sidebar session snapshot fanout and latest var metadata refresh
    - `session-messages.ts` owns host/editor message DTO construction helpers
    - `session-node-checks.ts` owns `validateNodeChecks` runtime creation and response formatting
    - `session-ready-handshake.ts` owns the webview `ready` bootstrap response and one-shot initial reveal relay
    - `session-selection-sync.ts` owns host shared selection state updates and `selectTree` / `selectNode` fanout
    - `session-settings-sync.ts` owns settings/nodeDefs refresh and `settingLoaded` fanout
    - `session-subtree-tracking.ts` owns reachable subtree reference cache refresh and tracked subtree file debounce scheduling
    - `document/` owns main document sync/session state, pure file version helpers, session file version guards, and subtree override pruning helpers
    - `settings/` owns editor language/theme helpers and live VS Code setting resolution
    - `files/` owns workdir-relative path helpers and editor file request handlers
    - `project/` owns project indexing and session node-check runtime helpers
    - `runtime/` owns operation queue, session runtime logging helpers, and webview log forwarding
- `webview/app/`
    - runtime 创建、host bridge、应用壳层
- `webview/commands/`
    - controller runtime 与命令实现
- `webview/stores/`
    - document / workspace / selection / graph-ui store
- `webview/domain/`
    - resolve graph、graph selectors、main-document save serialization
- `webview/adapters/`
    - G6 graph adapter、VS Code host adapter
- `webview/features/`
    - graph、search、inspector UI
- `webview/shared/`
    - contracts、protocol、tree、subtree cache、node/arg validation、`b3type` model types、shared helpers

## 架构验收标准

- 主编辑器、侧栏、宿主三者职责清晰，不通过隐式共享状态耦合
- 任一外部变化都能指出“在哪一层被吸收、在哪一层变成业务事件”
- 任一图交互都能指出“图层只负责表达什么，controller 负责决定什么”
