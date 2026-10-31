# Node Conditions (behavior3 2.0)

Status: Implemented
Date: 2026-10-31
Scope: persisted node model / materialization / build export / condition editor page

本 work item 取代原来的 `node-attached-decorator.md`。原「节点附属装饰器」是试验性实现，没有树文件在用，所以直接改成 behavior3 2.0 运行时的 `conditions` 格式，不做旧格式兼容。界面（节点上方附属、条件面板、临时编辑页、右键添加/删除）沿用原实现。

## 1. Context

behavior3-ts 2.0 参考 UE Observer Aborts 加了条件打断：节点上可以挂 `conditions` 数组，每项 `{ abort, root }`。`root` 是一棵普通格式的条件树，只返回 success / failure；`abort` 取 `none`（默认）/ `self` / `lower` / `both`；只有声明了 `preemptive: true` 的组合节点支持 `lower` / `both`。运行时规格见 behavior3-ts 的 `docs/design.md` 第 3、6 节。

编辑器解析节点时只保留已知字段，原来打开再保存会丢掉 `conditions`。发布 2.0 运行时前，编辑器必须完成数据层（design.md 第 6 节第 1 步）。

## 2. Goals

- 树文件节点读写 `conditions?: { abort?: AbortMode; custom?: Record<string, ...>; root: NodeData }[]`。`root` 按普通节点递归解析；`abort` 缺省为 `none`，非法取值报错。
- `NodeDef` 保留 `preemptive?: boolean`（只保留 `true`）。
- id / uuid 分配、subtree 展开、override、保存时的 id 回写和导出都包括条件树里的节点；条件树里可以通过 `path` 引用 subtree。
- 复制、粘贴、另存为 subtree、脱链、撤销等编辑操作不丢 `conditions`。
- 原装饰器的 `enterPriority` / `maintainPriority` 放到条件项的 `custom` 里，`$decorator_type` 改名为 `$condition_type`，功能保持。
- 条件项 `custom` 的编辑复用 Tree Inspector 的自定义数据编辑器。
- `DOCUMENT_VERSION` 升到 `2.8.0`。

## 3. Non-Goals

- 校验（第 3 步）：`conditions` 只允许 1 项、父节点不是 preemptive 时禁用 `lower` / `both`、根节点不能用 `lower` / `both`、没有 `status` 的节点给 warning、Action / 有 `output` 的节点给 warning。
- 提示（第 4 步）：选中条件时高亮它能影响的范围。
- 编辑器 UI 同时编辑多项条件。数据层完整支持多项，界面只编辑第一项，其余项原样保留。

## 4. Design

### 4.1 数据形状

```ts
type AbortMode = "none" | "self" | "lower" | "both";

interface ConditionData<TNode> {
    abort: AbortMode; // 读入时缺省补成 "none"，写出时总是写
    custom?: Record<string, string | number | boolean | object>; // 编辑器字段，运行时忽略
    root: TNode;
}

interface NodeData {
    // ...
    conditions?: ConditionData<NodeData>[];
}

interface NodeDef {
    // ...behavior3 1.x 字段
    preemptive?: boolean;
}
```

- `custom.enterPriority` 等于宿主节点 id 的整数值；`custom.maintainPriority` 在 0 到 `enterPriority` 之间。读入、保存回写 id、导出时都会按节点 id 重算（`syncConditionPriorities`）。override 里的条件没有宿主 id，保留存的 `enterPriority`。
- `overrides` 的字段集合包括 `conditions`，只能写上或替换整个数组，不能清掉 subtree 源文件里已有的条件。
- 树用到条件时 `custom.$condition_type` 为 `local` 或 `global`，缺省 `local`。
- 任何节点都可以带条件，没有 `supportDecorator` 一类的开关。

### 4.2 遍历顺序

和运行时 `Context._createTree` 一致：节点、它的条件树、它的子节点。`walkPersistedNodes`、`dfs`、resolve graph 的 display id、构建时的 `assignSequentialNodeIds` 都按这个顺序。

### 4.3 物化和 resolved graph

- `MaterializedTreeNode.conditions` 存解析后的条件树：和子节点用同一个上下文（subtree 源、override 链、环检测），所以条件树里的 `path` 会展开，subtree 内部节点的 override 会应用。
- `data.conditions` 保留持久化形状（未展开的 `path`），供条件面板、临时页面和复制使用。
- 条件树里的节点占用 display id，写进 `mainTreeDisplayIdsByStableId`，但不是 graph 节点，不在主图布局里。
- `ResolvedNodeModel` 带 `conditions`（持久化形状）和 `attachedConditionName`（第一项的根节点名）。

### 4.4 导出

`createBuildDataWithContext` 从物化结果生成 `conditions`，重新编号后按最终数字 id 重算优先级，再加 `prefix`。`createFileDataWithContext`、`clearInternalKeys`、build 校验（`checkNodeData`）、batch `onProcessNode` 都会走到条件树。

### 4.5 条件树约束（保存时拦截）

- 条件树内部不能再带 `conditions`。
- 条件树不能返回 running：`status` 含 `running` 的节点会返回；含 `|running` 的节点在任一启用的子节点会返回时会返回。没声明 `status` 的节点不拦。

## 5. Implementation Notes

- `webview/shared/condition-branch.ts`：常量、优先级、`$condition_type`、条件树约束。
- `webview/shared/schema.ts`：`normalizeConditions`、`preemptive`。
- `webview/shared/tree.ts` / `tree-model.ts`：遍历、保存、克隆。
- `webview/shared/tree-materializer.ts`、`webview/domain/resolve-graph.ts`：物化和编号。
- `webview/shared/b3build.ts` / `b3build-context.ts`：导出、校验、batch。
- `webview/commands/controller-runtime.ts`：`buildPersistedNodeFromResolved` 和剪贴板带上 `conditions`。
- `webview/features/inspector/custom-data-section.tsx`：树和条件共用的自定义数据编辑器。

## 6. Testing

- 读写往返保留 `conditions`（多项、`abort` 缺省、`custom`）和 `preemptive`；非法 `abort`、缺 `root` 报错。
- 条件树里引用 subtree：物化展开、override 生效、display id 顺序、保存回写 id 和优先级、override 不被清理。
- 构建导出带条件，subtree 展开，id 顺序和前缀正确，优先级按最终 id 重算。
- 复制、另存为 subtree 保留条件（包括子孙节点上的条件）。
- 条件树约束：嵌套条件、递归 running 推导。

## 7. Acceptance Criteria

- 一棵带 `conditions` 的树在编辑器里打开、编辑其他节点、保存、导出后，条件完整保留。
- 节点定义的 `preemptive: true` 读入后保留。
- `npm run check`、`npm run test:shared`、`npm run build` 通过。

## 8. Known Limitations

- 主文档 `overrides` 里新写的条件如果在条件树里引用了 subtree，这个 subtree 不会被预加载（`loadSubtreeSourceCache` 只从主树和 subtree 源收集路径），物化时显示为 missing。
- 条件面板的 `abort` 下拉框还没有按父节点是否 preemptive 禁用选项（第 3 步）。
