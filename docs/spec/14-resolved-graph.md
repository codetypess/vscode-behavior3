# Resolved Graph

## 目的

当前实现不会直接把 persisted tree 交给图层。图层消费的是一份已经物化并扁平化的 resolved graph。

本文件定义：

- 主树与 subtree 如何物化
- override 如何叠加
- 运行时 identity 如何生成
- 缺失、非法、循环 subtree 如何降级

## 输入与输出

### 输入

- `persistedTree`
- `subtreeSources`
- `nodeDefs`
- `subtreeEditable`

### 输出

- `ResolvedDocumentGraph`
- `ResolveGraphResult.mainTreeDisplayIdsByStableId`

其中：

- `ResolvedDocumentGraph`
  - 供搜索、选中、Inspector snapshot 和图模型构建使用
- `mainTreeDisplayIdsByStableId`
  - 当前保留为辅助映射，不驱动 persisted `id` 回写

## 术语

### Structured Node

主文档结构中的节点，即当前主树里通过 `children` / `path` 组织出来的节点锚点。

### Source Node

当前实例真正展示出来的节点数据来源。它可能来自：

- 主树自身节点
- 某个 subtree 文件的根节点
- subtree 文件内部节点

### Materialized Subtree Root

主树里带 `path` 的节点，在 subtree 文件可成功加载时，当前实现会用 subtree 的 `root` 替换其展示内容，但保留主树结构锚点。

### Subtree Internal Node

位于外部 subtree 内部的物化节点，不属于主文档结构真源。

### Override Chain

物化外部 subtree 节点时，当前实现会叠加：

1. 外层 subtree 自己的 `overrides`
2. 更外层 subtree 的 `overrides`
3. 主文档的 `overrides`

## Identity Model

当前运行时同时维护四种 identity：

### `structuralStableId`

- 当前实例在主文档结构中的锚点
- 对应 structured node 的 `uuid`

### `sourceStableId`

- 当前展示数据来源节点的稳定 `uuid`
- 对 subtree 内部节点，来自外部 subtree 源文件

### `displayId`

- pre-order 顺序分配的逻辑节点编号
- 从 `1` 递增
- 最终渲染标签是 `prefix + displayId`

### `instanceKey`

- 当前实现中与 `displayId` 相同
- 用于 graph、selection、search 的运行时唯一 key

补充：

- `sourceTreePath`
  - `null` 表示主树节点
  - 非 `null` 表示来源于某个 subtree 文件
- `subtreeStack`
  - 记录从主树走到当前实例时经过的 subtree 路径链

## 物化规则

### 1. 路径解析

若节点带 `path`：

- 先做 `WorkdirRelativeJsonPath` 规范化
- 非法路径直接记为 `invalid-subtree`

### 2. 循环检测

若规范化后的 subtree path 已存在于当前 `subtreeStack`，记为 `cyclic-subtree`

### 3. 读取 subtree source

路径合法且不循环时：

- `subtreeSources[path] === null`
  - 记为 `missing-subtree`
- `subtreeSources[path] === { error: "invalid-subtree" }`
  - 记为 `invalid-subtree`
- `subtreeSources[path]` 为 `PersistedTreeModel`
  - 进入成功物化

### 4. 成功物化 subtree root

成功物化时：

1. 克隆 subtree `root`
2. 保留当前主树 link 的 `path`
3. 将其视为当前 source node
4. 记录 `sourceTreePath = subtree path`
5. 叠加 override chain
6. 记录 `subtreeOriginal`

### 5. 外部 subtree 内部节点

若当前递归已经在外部 subtree 内部：

- 继续沿用 `sourceTreePath`
- 继续应用 override chain
- `subtreeNode = true`
- `subtreeEditable = settings.subtreeEditable`

### 6. 子节点来源

- 若当前节点成功物化为 subtree root，子节点来自 `subtreeTree.root.children`
- 若存在 resolution error，子节点为空
- 否则子节点来自 source node 自身 `children`

### 7. 默认参数补齐

在节点定义存在时，若某个 arg 在 node data 中缺失且 nodeDef 提供默认值，则当前物化结果会补齐默认值。

## 状态位计算

当前实现会在物化阶段计算 `$status`：

1. 先读取 nodeDef 自身声明的状态输出
2. 再聚合未 disabled 的子节点状态
3. 按当前 `behavior3` 规则合成 `success` / `failure` / `running` 位

这意味着图层看到的 `$status` 已经是运行时派生结果，而不是原始存档字段。

## 扁平化规则

物化树随后被扁平化为：

- `rootKey`
- `nodesByInstanceKey`
- `nodeOrder`

扁平化采用 pre-order 遍历：

- `displayId` / `instanceKey` 也按这个顺序生成
- `mainTreeDisplayIdsByStableId` 仅记录 `sourceTreePath === null` 的主树节点

## 降级显示规则

当 subtree 无法正常物化时：

- 节点仍保留在 resolved graph 中
- `resolutionError` 标记为：
  - `missing-subtree`
  - `invalid-subtree`
  - `cyclic-subtree`
- 图层与 Inspector 以错误样式和错误文案显示
- 不再继续展开其子树

## 不变量

1. resolved graph 可以随时丢弃并重建。
2. `structuralStableId` 始终锚定主文档结构。
3. `sourceStableId` 反映当前实例真正的数据来源。
4. subtree 内部编辑不修改 subtree 源文件，只通过主文档 `overrides` 表达。

## 验收清单

- 任一 resolved node 都能说明它来自主树还是 subtree
- 任一实例都能给出 `NodeInstanceRef`
- 任一 subtree 错误都能落到明确的 `resolutionError`
