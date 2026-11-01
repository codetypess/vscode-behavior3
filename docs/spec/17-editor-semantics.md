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

### Rule 5. Graph-local 结构快捷键不得抢占当前可编辑控件的文本输入

- graph pane 中的 copy/paste/replace/insert/delete/undo/redo 快捷键只在非编辑态下生效
- 当事件目标位于原生文本输入、组合输入控件、搜索输入或其 popup/container 内时，快捷键 owner 属于当前控件
- `Ctrl/Cmd+V`、`Ctrl/Cmd+C`、`Ctrl/Cmd+X`、`Ctrl/Cmd+Z`、`Ctrl/Cmd+Y` 等文本编辑组合键在上述场景下不得转义成节点结构编辑命令

## 共享内部流程

### `syncReachableSubtreeSources()`

- 递归读取当前主树可达 subtree
- 构建 `workspaceStore.subtreeSources`
- subtree 解析到缺失稳定 id 时按文件路径与节点位置确定性补齐内存模型；磁盘规范化回写延后到主文档保存

### `rebuildGraph(opts?)`

- 基于 `persistedTree + subtreeSources + nodeDefs + subtreeEditable` 重新 resolve graph
- 请求节点字段检查结果；该结果同时承载 `checker` 失败与 `visible` 解析/执行失败这类必须挂到字段上的 diagnostics
- 重建 `ResolvedGraphModel`
- 交给 graph adapter render；若当前存在一次性结构变更锚点，则随 render 一起传入
- 视情况恢复 selection
- 最后重放 selection/highlight/search，并刷新当前选中节点的 field visibility

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
- 若当前共享选中本来就是 tree，重复的显式 tree 选中手势仍应作为一次 host-side reassert，用于重新激活 Inspector Sidebar；这不会改变共享 selection payload

### `selectNode(nodeKey, opts?)`

- 选中 resolved graph 中的实例节点
- 不直接改写 `selectionStore` 中的共享 tree/node authority 字段
- 向宿主发送 `selectNode(target)` intent
- 若节点已选中且未强制刷新，可只重发宿主 intent
- 若来自变量热点点击，可选择保留 variable focus
- 如有需要，可立即更新 graph-only 本地视觉 hint
- 后续以宿主 `documentSnapshotChanged.selection` 作为共享选中权威结果
- 若当前共享选中本来就是同一逻辑节点，重复的显式节点选中手势仍应作为一次 host-side reassert，用于重新激活 Inspector Sidebar；这不会改变共享 selection payload

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
- 若宿主在 committed 往返期间仍保持同一逻辑节点选中，但实时 `selectedNodeSnapshot` 暂时缺席，Inspector 入口可先复用该文件最近一次成功渲染的 node snapshot，直到新 snapshot 恢复；这不改变 host 作为共享 selection authority 的规则

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
- 每次修改成功后，补上 `settings.customFields` 里当前生效且缺失的必填字段：树的 `custom` 用 `tree` 组，每个条件项（包括 overrides 里的）的 `custom` 用 `condition` 组。已有的值即使不符合声明也不改写
- 提交自定义数据（树级提交、条件 Inspector、条件文件写回）时，被删掉的必填字段恢复为原值或默认值，只读字段保留原值
- `when: hasConditions` 的字段在去掉最后一个条件后保留，不自动删除
- 宿主处理文档修改时，reducer 返回 `changed` 后，主树内联条件里缺少的 `script` 字段由 `@behavior3.customField` 钩子补上（`reason: "create"`）；钩子没注册时用字段的 `default`
- webview 只发送 intent，宿主仅在值确实变化时提交 mutation

### `updateNode(payload)`

webview 在发送 intent 前只补齐 host reducer 需要的上下文：

- payload 会先补齐 `currentNodeSnapshot`
- 若本次是把 subtree link 改回本地节点，还会补齐 `detachedSubtreeRoot`
- Inspector 可按单字段或局部提交单元构造本次 payload；无关字段错误不应阻断本次 intent
- Inspector 的 `updateNode` intent 不得因预览而补齐新的 `input`、`output`、`args` 默认值；但若目标 `nodeDef` 已不再声明旧字段，则该次 intent 及其 host reducer 结果必须裁剪这些陈旧 committed 数据
- 节点切换导致的 Inspector 表单重建属于本地展示状态刷新；在写入新节点 form values 前应先清空旧节点的局部表单状态
- `name` 驱动的 nodeDef 预览切换同样属于本地展示状态刷新；依赖字段不得通过 `setFieldsValue` merge 继承旧节点或旧类型留下的嵌套值
- 对当前无值的 arg，webview 预览态应通过“缺少该 key”而不是“key 存在但值为 `undefined`”来表达 unset
- 当节点类型切换引入新的 required args 时，未显式设置的 arg 在首次提交中保持 unset，不应被静默写成占位空值
- 当 host-side field visibility 将某个 arg / input / output 隐藏时，webview 必须先清空该字段的本地表单值，再通过现有 host-first `updateNode` intent 清除 committed 数据
- 当 host-side 无法解析某个 arg / input / output 的 `visible`，或其表达式 capability 被禁用、编译失败、运行时报错时，webview 不得隐藏该字段；对应失败必须通过现有字段 diagnostics 通道显示在该字段上
- 对 optional `Select` arg，webview 预览态的“未设置”必须表现为空选中态；局部校验与提交序列化都应把它视为 `undefined`，而不是内部哨兵字符串
- 对主树普通节点，Inspector 可展示 resolved/effective arg 默认值，但 `updateNode.payload.currentNodeSnapshot.data.args` 仍必须保持 committed JSON 语义，不能因为展示默认值而把默认参数带入提交基线
- 对 subtree 内部节点，`updateNode.payload.currentNodeSnapshot.data.args` 必须保留当前 resolved/current args，作为与 `subtreeOriginal` 比较的编辑基线
- 若主树普通节点的 arg 字段尚未被用户实际改动，Inspector 不得因为 blur/校验而把仅展示中的默认值提交回主文档
- 若用户点击带默认值 arg 的 reset action，webview 应直接移除该 arg 的显式 committed key，而不是走“清空后再校验必填”的常规 blur 提交流程
- 是否 noop、是否错误、是否提交由宿主 reducer 决定

host reducer 当前分三条路径：

#### A. 主树普通节点

- 直接在主文档结构上修改该节点
- 若新填入 `path` 且与原值不同，清空本地 `children`

#### B. subtree 内部节点

- 不改 subtree 源文件
- 以 payload 自带的 `subtreeOriginal` 对比出 diff
    - `subtreeOriginal` 与当前 resolved node 已共享同一套 arg 默认值归一化
    - `currentNodeSnapshot.data.args` 来自当前 resolved/current args，而不是主文档 committed JSON
    - `debug` / `disabled` 的提交结果必须保留显式 `false`，以支持把 subtree 源节点中的 `true` 关闭成主文档 override
    - 仅因 nodeDef 默认值补齐而出现的值，不得单独生成 main-document `overrides`
- 写入或清理主文档 `overrides`
- 子树节点的 `conditions` 可以写入 override，但不能靠省略字段把源节点上已有的条件清掉

### `attachCondition(entryName)`

- 任意节点都可用，已有条件时追加一项（项与项之间是 AND，按数组顺序）。添加后选中新的这一项
- 选定的节点成为新项的 `root`，不进入宿主的 `children`。`abort` 为 `none`；`custom` 是 `settings.customFields.condition` 里所有带默认值的字段（`"$nodeId"` 默认值取目标节点的 id），没有时不写
- 根节点定义的 `status` 含字面量 `running` 时拒绝
- 条件树内部不能再带 `conditions`；条件树不能返回 `running`：按 behavior3 2.0 的静态推导，`running` 节点自己会返回 running，`|running` 节点在任一启用的子节点会返回 running 时会返回 running。没有声明 `status` 的节点这里不拦（后续校验给 warning）
- 子树内部节点的结果写入主文档 `overrides`

### `removeCondition()` / `moveCondition(direction)`

- 作用于选中的那一项条件（选中条件卡片时才可用）。删除后选中同位置的下一项，没有就选上一项，都没有就回到选中节点；数组为空时去掉字段
- 移动和相邻项交换，到头时不变；选中跟着这一项移动
- 子树节点上的条件通过 override 写整个数组；删完或移动后和源文件一致时删除对应 override 条目
- 子树源文件里已经有条件时，不能删到一项不剩（override 不能清掉源文件里的条件）。界面禁用，reducer 也会拒绝

### 条件文件

- 条件面板的「打开编辑视图」按钮，或双击节点上方的条件附属，在新标签页打开那一项的条件文件：第 1 项是 `…/<宿主文件>/<uuid>/condition.json`，第 n 项是 `condition-<n>.json`。它是普通的 Behavior3 Editor 文档，画布、Inspector、复制粘贴、撤销都照常工作，侧栏 Inspector 也把它当普通文件
- 条件文件里节点的 id 和它们在宿主树里的 id 一致：宿主读条件文件时先按保存时的规则算出宿主当前的 id（包括未保存的修改和展开的 subtree），写进条件树；条件树在宿主的编号里是连续的一段，所以条件文件的画布从根节点的 id 开始编号（`settings.conditionFile` 时用 `getDisplayIdStart`），而不是从 1 开始。宿主重新编号后条件文件刷新，id 跟着变
- 条件文件的树级「自定义数据」就是这项条件的 `custom`，可以查看、增删改。保存条件文件：根节点、`custom` 和 `overrides` 通过 `setConditionRoot` 写回宿主文件对应序号的那一项，`abort` 和其他项不变；条件文件打开期间宿主里删除或移动了条件时，标签页按序号重新读取；宿主文件已打开时它变成未保存、可以撤销，没打开时直接写盘。违反条件树约束时拒绝保存。条件文件里其他树级字段（说明、变量等）的修改不写回
- 宿主文件变化（编辑、撤销、保存、还原、外部修改）后，条件文件没有未保存修改时直接刷新，有时按外部修改冲突处理
- 双击节点本体仍打开 subtree

#### C. 从 subtree link 脱链

- 若原节点有 `path`，且这次清空 `path`
- 先把当前 resolved 子树重新持久化为主树节点结构
- 再应用当前表单值

### `performDrop(intent)`

- canvas 先发送 `mutateDocument(performDrop)` intent 给宿主
- canvas 可先运行 command-local pure drop preflight 来显示即时错误，但该 preflight 不修改文档、不推进 history，也不是最终 authority
- webview 在发送合法 drop intent 前，将 drop target 记录为下一次 graph render 的一次性视图锚点
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
- webview 在发送 insert intent 前，将当前选中目标记录为下一次 graph render 的一次性视图锚点
- 宿主直接提交后把新节点选中折叠进 committed snapshot `selection`
- 在当前节点下追加一个最小节点：
    - `uuid`
    - `id: ""`
    - `name: "unknown"`

### `saveDocument()`

- 主编辑器或侧栏发起保存后，最终都进入 VS Code custom editor 保存生命周期
- 宿主写盘前会重新解析当前主文档，并用 resolved graph 的主树 display id 回写 persisted `id`
- id 回写之后，`settings.customFields.condition` 里声明了 `script` 的字段由对应的 `@behavior3.customField` 钩子重新计算（`reason: "save"`，带回写前后的节点 id），只处理主树内联节点上的条件。钩子缺失、报错或返回值不符合声明时记录到输出面板，字段保持原值，保存照常进行
- 这次回写包括条件树里的节点
- 该回写只作用于主树结构节点，不把 subtree 内部实例 id 反写到主文档
- 同一次保存动作会显式写回当前可达 legacy subtree 的规范化内容
- 保存成功后，宿主当前 history 游标快照同步替换为写盘后的规范化内容

### `replaceNode()`

- canvas 先发送 `mutateDocument(replaceNode)`，并携带剪贴板节点快照
- 用剪贴板节点替换当前主树节点
- 保留当前节点根部的 `uuid`
- 子节点重新分配稳定 id

### `deleteNode()`

- canvas 先发送 `mutateDocument(deleteNode)`
- webview 在发送 delete intent 前，以当前待删除节点为 source，把其兄弟节点与父节点作为候选，向 graph adapter 查询当前 viewport 中距离 source 最近的候选，并把该候选记录为下一次 graph render 的一次性视图锚点
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
- 写盘前按当前可达 subtree graph 清理已不可达的 stale override 条目；若 reachable subtree source 不完整，则保留现有 overrides
- 成功后清理 dirty 与 reload conflict

### `revertDocument()`

- 通过 host `revertDocument` 请求回滚
- 真正 reload 由宿主后续 `documentSnapshotChanged(syncKind: "reload")` 驱动

### `buildDocument(opts?)`

- 只是把 build 请求交给宿主
- 结果通过 `buildResult` 回推
- 宿主执行 build 时，进程当前工作目录必须切换到解析出的行为树项目目录，也就是命中的 `*.b3-workspace` 所在目录；如果该目录经过符号链接进入，宿主必须先把已有文件路径规范化到同一个 canonical filesystem path，再让 build script 观察 `process.cwd()` 与 build context `workdir` 保持一致，而不是一个是 lexical path、另一个是 real path
- 构建在重新编号、加前缀之后，用 `@behavior3.customField` 钩子重新计算条件里的 `script` 字段（`reason: "build"`，每个展开实例各算一次，只写进产物）；钩子缺失或出错时构建失败
- 构建产物带上节点 `conditions`：条件树里的 subtree 被展开、override 被应用，id 按节点、条件树、子节点的顺序重新编号后加前缀，条件 `custom` 原样导出。build 校验和 batch `onProcessNode` 也会走到条件树里的节点；batch hook 对条件根返回空时去掉该条件项
- `Ctrl+B` / `Cmd+B` 与 `Ctrl+Shift+B` / `Cmd+Shift+B` 由 VS Code contributed keybindings 直接触发 extension-host build command；webview 不应重复绑定同一组 build 快捷键
- Inspector view title 中的 build action 同样触发 `behavior3.build` extension-host command，不新增 webview 内部 build 入口

### File editor mode action

- `behavior3.toggleEditorMode` 是 extension-host command，不经过 editor `EditorCommand` catalog
- 主编辑器标题栏在激活 Behavior3 editor 或 JSON 文本文件时提供此按钮，与 `F4` 使用相同上下文；它在同一文件的 Behavior3 可视编辑器和文本编辑器之间切换
- Inspector toolbar 不承载文件级切换；`behavior3.toggleInspectorNodeJson` 保留在 sidebar 与 embedded Inspector 中，只切换当前选中节点的结构化字段与只读原始 JSON 视图

### Inspector view title project actions

- `behavior3.createProject` 是 extension-host command，不经过 editor `EditorCommand` catalog
- Inspector view title 可以暴露此 command 作为快捷入口，但不得绕过 command 内部的 workspace 与文件路径校验

### Picker-backed batch project flow

- 这是 extension-host 侧的项目批处理入口语义，不经过 editor `EditorCommand` catalog
- 在需要先选脚本的场景下，会先进入批处理脚本选择，再对当前 project 的 persisted tree 源文件做批量处理
- batch script 的公共装饰器入口是 `@behavior3.batch`；build script 与 checker 分别使用 `@behavior3.build` 和 `@behavior3.check(...)`
- 批处理只执行所选 batch script 的转换流程；不运行内置节点合法性校验，也不加载或执行 workspace `settings.checkScripts`
- 默认只在所选脚本改变规范化树语义时写回；所选脚本 `shouldUpgradeTree()` 返回 true 时，也会把解析/序列化产生的输入树升级作为 staged write
- 若 batch script 自身通过 `errors` 参数报告错误或 hook 抛错，则整次批处理失败并放弃所有 staged writes；否则即使转换结果不满足普通构建校验，也按统一写回语义写入

### `behavior3.runBatchProcessScript`

- 这是 extension-host 项目命令，不经过 editor `EditorCommand` catalog
- 若当前选择的是 `.ts` / `.mts` / `.js` / `.mjs` 文件，则直接把该文件当成批处理脚本执行
- 若从文件夹菜单或无显式脚本上下文触发，则先进入上述 picker-backed 项目流程，再执行所选脚本
- 与上述 picker-backed 项目流程共享同一套项目解析、batch-script-only 处理和统一写回语义

## Subtree 相关命令

### `openSubtreePath(path)`

- 规范化 path
- 通过 host `readFile(..., { openIfSubtree: true })` 打开对应 subtree
- 若调用方提供目标 subtree 节点 identity，则一并把 `openSelection` relay 给 host
- 若目标 subtree 打开后需要把节点带入视图，host 再投递一次 transient `relayFocusNode`

### `openSelectedSubtree()`

- 若命令由 graph double click 触发，优先使用事件命中的 `node.ref`，而不是依赖当前 selection store
- 优先读取当前节点 `path`
- 若当前选中的是 subtree 内部节点，则退回 `subtreeStack` 的最后一个路径
- 对目标 subtree 文档的选中锚点使用当前节点的 `sourceStableId`
- 打开完成后，目标 subtree 节点除了被 host 选中，还会收到一次 reveal/focus relay

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
