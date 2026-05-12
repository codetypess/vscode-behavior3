# Graph Contract

## 目标

当前图层的唯一职责是把 `ResolvedGraphModel` 渲染成可交互画布，并把用户图交互表达为稳定业务事件。

图层不负责：

- 维护 persisted tree
- 判定 subtree、history、save 等业务语义
- 直接修改宿主文档

## Core Rule

当前 graph boundary 只有两类输入：

1. 完整的 `ResolvedGraphModel`
2. 独立的视觉状态：
    - selection
    - highlight
    - search
    - viewport

所有输出都以 `GraphEventHandlers` 回调表达，而不是直接改 store。

graph adapter 允许保留实现自有的 graph-local 视觉缓存，例如节点折叠可见性；这类状态不属于外部输入，也不能写回 persisted tree、host snapshot 或 Inspector authority。

## GraphAdapter Interface

当前 `GraphAdapter` 稳定接口为：

- `mount(container, handlers)`
- `unmount()`
- `render(model, opts?)`
- `pickNearestNodeAnchor(sourceNodeKey, candidateNodeKeys)`
- `applySelection(selection)`
- `applyHighlights(highlights)`
- `applySearch(search)`
- `focusNode(nodeKey)`
- `restoreViewport(viewport)`
- `getViewport()`

## Inbound Contract

### ResolvedGraphModel

- `rootKey`
- `nodes`
- `edges`

### GraphNodeVM

图节点视图模型当前至少包括：

- `ref`
- `parentKey`
- `childKeys`
- `depth`
- `renderedIdLabel`
- `title`
- `subtitle`
- `typeLabel`
- `icon`
- `nodeStyleKind`
- `nodeStyleKind` 的 `Error` 包括 resolution error、共享 validation diagnostic（含固定 children 数量不匹配）和 custom checker diagnostic
- `accentColor`
- `debug`
- `disabled`
- `hasOverride`
- `subtreeNode`
- `subtreePath`
- `statusBits`
- `inputs`
- `outputs`
- `argsText`

### GraphEdgeVM

- `key`
- `sourceKey`
- `targetKey`

## G6 Implementation Boundary

当前实现细节：

- 图引擎：`@antv/g6`
- 布局：`compact-box`
- 方向：`LR`
- 边：`cubic-horizontal`
- 节点：自定义 vector tree node
- 交互：`drag-canvas` + 本地 wheel zoom

这些属于当前实现基线，但不改变外层 contract：

- controller 不依赖 G6 事件对象
- 业务层只依赖 `GraphEventHandlers`
- G6 类型缺口、内部 rendered/destroyed/context 读取、事件 target/canvas shape 与配置对象 cast 必须集中在 `g6-compat.ts`
- 主 adapter 只负责 viewport、render、layout 输入和业务事件转换，不直接散落 broad cast

## Geometry Contract

### 画布布局所有权

- 节点宽高由图节点 view model 测量得出
- G6 负责树布局
- controller 不参与坐标计算

### 视口所有权

- 视口状态由 graph adapter 自己维护
- rebuild render 时尽量保持既有视口与中心锚点稳定
- 当 controller 为结构变更后的 render 提供一次性 `anchorNodeKey` 时，adapter 应优先以该节点为锚点补偿视口；若该节点不可用，再回退到中心锚点
- 删除节点前，controller 可请求 graph adapter 在“待删除节点”和候选锚点之间按当前 viewport 坐标选择最近的可见候选；候选通常是兄弟节点与父节点
- container resize 时也应保持既有 viewport，并在需要时补偿视觉锚点，避免缩放后的内容整体漂移
- `focusNode` 会聚焦到目标节点并刷新当前视口缓存

### Graph-Local Collapse State

- 节点折叠当前属于 graph adapter 自己维护的本地视觉状态
- rebuild 后若同一 `NodeInstanceRef` identity 仍存在，adapter 应尽量保留其折叠状态
- 折叠只影响图上可见 descendants 与布局输入，不改变 `ResolvedGraphModel`、persisted tree 或 host selection

## Outbound Contract

图层只向上抛出这些业务事件：

- `onCanvasSelected()`
- `onNodeSelected(node, opts?)`
- `onNodeDoubleClicked(node)`
- `onVariableHotspotClicked(node, payload)`
- `onDropCommitted(intent)`

### 事件语义

- canvas click
    - 选择 tree
- node click
    - 选择节点；若点击输入/输出热点，同时触发变量聚焦
- node context menu
    - 先选择节点，再由外层决定菜单行为
- node double click
    - 按 double click 命中的 `node.ref` 打开 subtree
    - 不依赖当前 host selection store 已经先收敛到这个节点
    - subtree 打开后的目标节点会再通过一次性 `relayFocusNode` relay 带入视图
- drag/drop
    - 只表达 `before` / `after` / `child` 意图，不判合法性

## Selection Contract

- `selectedNodeKey` 为当前唯一选中节点
- 选中态只是一层视觉状态，不隐含文档写入
- rebuild 后由 controller 负责恢复选中，再调用 `applySelection`

## Highlight Contract

变量高亮输入为：

- `activeVariableNames`
- `variableHits`

图层规则：

- 命中 `input` / `output` / `args` 的节点进入对应高亮态
- 当前存在变量 focus 时，未命中节点进入灰化态

## Search Contract

输入为：

- `query`
- `mode`
- `caseSensitive`
- `focusOnly`
- `resultKeys`
- `activeResultIndex`

规则：

- `focusOnly = true` 且 query 非空时，非结果节点灰化
- `focusNode` 只负责图上聚焦，不改 selection store
- 若目标节点当前被 graph-local collapsed ancestor 隐藏，`focusNode` 应先展开祖先链再聚焦
- graph 允许保留 editor-local 视觉选中 hint，但该 hint 不能被当作 Inspector 或共享 selection authority

## Drag-and-Drop Contract

图层当前根据鼠标相对目标节点的位置推断 drop intent：

- 右半区域：`child`
- 左半区域上方：`before`
- 左半区域下方：`after`

图层不负责：

- 判断根节点限制
- 判断 subtree 结构限制
- 判断祖先/后代非法关系

这些都由 controller 的 `performDrop` 决定。

## Visual Precedence

当前视觉优先级遵循：

1. `selected`
2. `focused`
3. variable hit
4. search gray / highlight gray
5. drag source / drag target state

## 验收标准

- 图层能只靠 `ResolvedGraphModel` 与视觉状态完成渲染
- 任一业务交互都能还原成稳定 handler 回调，而不是暴露 G6 原生对象
- 图层不直接读写 persisted tree 或宿主协议
