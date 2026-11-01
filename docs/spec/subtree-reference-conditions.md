# Subtree Reference Conditions

Status: Verifying
Date: 2026-11-01
Scope: materializer / document mutations / build check / condition files / inspector / graph

## 1. Context

`lower` / `both` 依赖父节点是否 preemptive。子树根的父节点只有在引用处才确定，同一个子树在不同引用处可能需要不同的条件。

现在的问题：

- 给主树里的子树引用节点加条件，reducer 把条件写到主树文件的引用节点上，但物化时子树根只取子树文件根节点上的条件，引用节点上的被忽略：画布看不到，构建也丢掉。
- 所以实际上只能把条件写进子树文件的根节点，而单独打开子树文件时根节点没有父节点，`lower` / `both` 被判错。

## 2. Rules

1. 子树内部节点的条件写在子树文件里，每个引用处都带上；某个引用处要单独改，用主树 override（不变）。
2. 树文件的根节点不允许挂条件。编辑器分不出一个文件是"子树"还是"主树"，所以对所有树文件的根节点都适用。
3. 子树引用节点可以挂条件，存在引用它的那个文件里，作用于展开后的子树根；`lower` / `both` 按引用处的父节点判断。

## 3. Design

### 3.1 物化

- 引用节点（有 `path` 且子树能解析）展开时，子树根的 `conditions` 取引用节点自己的（引用节点在外部子树里时，叠加主树对它的 override），不再取子树文件根节点上的。
- 这些条件树属于引用节点所在的文件，用引用节点的上下文解析（不是子树的上下文）：在主树里就是主树内联节点，参与主树 id 编号和保存回写。
- `data.conditions` 也是引用节点的条件，Inspector、复制、条件面板看到的一致。

### 3.2 根节点

- `attachCondition` 目标是树的根节点时拒绝（`condition-on-root`）；右键菜单"添加条件"在根节点上置灰。
- 已经存在的根节点条件：画布卡片和条件面板显示为错误（「根节点不能挂条件；子树需要条件时，挂在主树里引用它的节点上」），构建报错 `conditions are not allowed on the root node`。
- 原来"根节点不能用 `lower` / `both`"的检查并入这条。

### 3.3 嵌套引用

- 子树里面的子树引用节点（在主树里看是外部子树里的引用），它的条件在那个子树文件里。从主树给它加、删、移、改条件都拒绝（`condition-nested-reference`），提示打开那个子树文件编辑。识别方式：实例的 `sourceTreePath` 非空、`structuralStableId !== sourceStableId`（引用节点的 uuid 和子树根 uuid 不同），且 `subtreeStack` 长度大于 1。

### 3.4 条件文件

- 引用实例的条件文件宿主是引用节点所在的文件：主树内联引用就是当前文件，uuid 用 `structuralStableId`。嵌套引用不支持单独打开（提示）。

## 4. Testing

- 物化：主树引用节点的条件出现在展开后的子树根上；子树文件根节点的条件在引用时不生效；条件树节点按主树编号。
- 给主树引用节点添加、删除、移动条件，画布可见；构建导出带上引用处的条件，id 正确。
- 根节点添加条件被拒；根节点已有条件时构建报错。
- 嵌套引用的条件修改被拒。

## 5. Acceptance Criteria

- 在主树里给子树引用节点加条件，画布上出现卡片，可以选 `lower`（父节点 preemptive 时），构建产物里子树根带上这项条件。
- 单独打开子树文件，根节点不能添加条件；已有的显示为错误。
- `npm run check`、`npm run test:shared`、`npm run build` 通过。
