# Inspector Edit Subtree Button

Status: Done
Date: 2026-05-09
Scope: Node Inspector subtree navigation entrypoint

## 1. Context

当前编辑器已经支持通过 graph double click 或 graph context menu 调用 `openSelectedSubtree()` 打开子树，并把目标编辑器定位到对应 subtree 源节点。

Node Inspector 目前只展示节点字段，没有提供等价的“编辑子树”入口。对于 materialized subtree 内部节点，Inspector 里虽然能看到字段，但无法直接跳回对应 subtree 编辑器，必须回到画布里触发同一动作。

## 2. Goals

- 在 Node Inspector 中为可打开 subtree 的节点提供明显的“编辑子树”按钮。
- 复用现有 subtree 打开命令与节点定位语义，不新增 host 协议。
- 同时覆盖 subtree link 节点和 materialized subtree 内部节点。

## 3. Non-Goals

- 不调整 subtree 打开后的 focus / reveal 语义。
- 不新增新的文档 mutation、selection 协议或 Inspector 模式。
- 不改动 Tree Inspector 中现有 subtree 声明列表的打开入口。

## 4. Current Behavior

- graph context menu 会在当前选中节点存在 `data.path` 或 `ref.subtreeStack` 时显示“编辑子树”。
- `openSelectedSubtree()` 会优先读取当前节点 `path`，若节点位于 materialized subtree 内部则回退到 `subtreeStack` 的最后一个路径，并把当前节点 `sourceStableId` 作为目标 subtree 的选中锚点。
- Node Inspector 没有对应按钮，因此 Inspector 不能独立完成这条导航。
- 当前按钮已接入上述命令，但当目标 subtree 编辑器已经打开时，sidebar 的活动文档跟踪可能仍停留在来源文档，导致画布已跳转/reveal，Inspector 仍显示旧节点上下文，看起来像“没有选中”。
- 进一步排查发现，sidebar 的全量 `init` / 内容变更快照如果先拿旧文档 graph 去投影新的 host selection，会把 subtree 节点误解到旧 graph 的同号 `instanceKey` 或更宽松回退目标上，随后在新图里把错误选中固化下来。
- 在 tab 间切换时，如果目标文档本身已经有 node selection，host 会先把 node ref 暂存到 sidebar，再等待新图重建补出 `selectedNodeSnapshot`；当前 Inspector 只根据 `selectedNodeSnapshot` 决定渲染 Tree 或 Node，导致这段空窗会短暂闪回 Tree Inspector。

## 5. Proposed Behavior

- 当 Node Inspector 当前选中节点满足以下任一条件时，在表单末尾显示全宽主按钮“编辑子树”：
  - 节点自身存在 `data.path`
  - 节点 `ref.subtreeStack` 非空
- 点击按钮后调用现有 `openSelectedSubtree(selectedNode.ref)`。
- 打开后的 subtree 编辑器仍按既有规则跳转到当前节点对应的 subtree 源节点。
- 若目标 subtree 文档已经打开，切换到该 tab 后 Inspector 也必须切换到该子树文档，并展示目标节点选中态，而不是保留来源文档的旧选中。
- 当 sidebar 已经收到 node 级 selection，但对应 `selectedNodeSnapshot` 仍在等待图重建时，Inspector 应保持在 node 视图通道，并显示 loading/pending 态，而不是先切回 Tree Inspector。
- 若目标文档此前已经在 sidebar 中成功展示过同一个 node，切回该 tab 时应优先复用该文档缓存的 node snapshot，避免不必要的 loading 动画。

## 6. Design

- 在 Node Inspector 内部新增一个纯显示条件，使用 `selectedNode.data.path` 与 `selectedNode.ref.subtreeStack` 判断是否可打开 subtree。
- 该按钮位于 Node Inspector 结构化字段区域之后，作为节点级操作入口，不嵌入单个字段行。
- Inspector 不自行计算目标路径，只把当前 `selectedNode.ref` 显式传给 controller 的 `openSelectedSubtree()`，保持 graph 与 Inspector 入口一致，并避免依赖瞬时 selection 收敛时机。
- extension 侧对 sidebar 活动文档的跟踪不能只依赖 `tabGroups.onDidChangeTabs`；还需要覆盖“激活已存在 tab”以及“关闭当前 subtree tab 后底下父树重新成为 active custom editor”这类场景。
- 除了全局 tab 监听，custom editor 自身也需要在 `webviewPanel.onDidChangeViewState` 进入 active 时主动声明当前文档，降低对 VS Code tab 事件时序的依赖。
- 当父树编辑器重新可见时，若编辑器本地仍保留一个当前可视选中节点，应再次向 host 发送该选中 intent，让 Inspector 与画布重新收敛到同一节点。
- sidebar 处理 host `init` 或内容已变的 `documentSnapshotChanged` 时，必须先保留 host 原始 selection ref，等当前文档 graph 重建完成后再恢复，不能先用旧 graph 做投影。
- selection 恢复不能只凭裸 `instanceKey` 命中；至少要同时校验 stable id 与 subtree 上下文，避免不同文档或不同 subtree 挂载位置上的同号节点互相串选。
- Inspector 的“树表单 / 节点表单”切换不能只依赖 `selectedNodeSnapshot`；还要识别“已知当前是 node selection，但 snapshot 尚未完成重建”的 pending 节点态。
- sidebar 需要按文档缓存最近一次成功渲染的 `selectedNodeSnapshot`；当同文档同逻辑节点再次成为 active selection 时，可先复用缓存，再由真实 graph restore 覆盖。

## 7. Implementation Plan

1. 新增 work-item spec 并登记到 `docs/spec/README.md`。
   Exit Criteria: 本次行为、范围与验收条件在 spec 中可追踪。
2. 在 Node Inspector 添加按钮与样式。
   Exit Criteria: 可打开 subtree 的节点显示按钮，其他节点不显示。
3. 修复活动子树编辑器切换时的 Inspector 上下文同步。
   Exit Criteria: 目标 subtree 已打开时，点击按钮后 sidebar 跟随当前 active custom editor 切换。
4. 补充回归测试并更新受影响基线 spec。
   Exit Criteria: 至少覆盖 Inspector 入口依赖的 controller 打开语义，并同步长期规则文档。

## 8. Testing Plan

- 为 `openSelectedSubtree(targetRef)` 补充一条回归测试，验证 materialized subtree 内部节点能通过 `subtreeStack` 打开父 subtree，并把 `sourceStableId` 转成目标 subtree 选中锚点。
- 为 host init selection / reveal 补充断言，确保目标 subtree 打开后不仅会 focus，还会进入对应节点选中态。
- 为“旧文档 graph 仍在内存中时切回父树”的 full init 路径补一条回归测试，确保 nested subtree selection 会在新 graph 上恢复，而不是误投影到旧 graph 的同号节点。
- 为 Inspector 显示模式补一条回归测试，验证当 `selectedNodeRef` 已存在但 `selectedNodeSnapshot` 尚未恢复时，sidebar 仍保持 node 模式而不会回退成 tree 模式。
- 为 inspector node snapshot cache 补一条回归测试，验证只有同文档同逻辑节点 identity 才会复用缓存。
- 运行 `npm run check`。
- 运行 `npm run test:shared`。

## 9. Acceptance Criteria

- Node Inspector 选中 subtree link 节点时显示“编辑子树”按钮。
- Node Inspector 选中 materialized subtree 内部节点时也显示“编辑子树”按钮。
- 点击该按钮后，打开对应 subtree 文件并定位到当前节点对应的 subtree 源节点。
- 若目标 subtree 标签页原本已经打开，跳转后 Inspector 仍会切换到该 subtree 文档，并显示目标节点。
- 在两个都已有 node selection 的 Behavior3 tab 之间切换时，Inspector 不会先闪回 Tree Inspector 再切回 Node Inspector。
- 在两个都已缓存同一节点 snapshot 的 Behavior3 tab 之间切换时，Inspector 不会额外出现一侧才有的 node loading 动画。
- 不满足 subtree 打开条件的普通节点不显示该按钮。

## 10. Risks and Rollback

- 风险：Inspector 的显示条件如果和 graph menu 不一致，两个入口会出现行为漂移。
- 缓解：按钮显示条件与 graph menu 保持同一判断口径，并复用同一 controller 命令。
- 回滚：移除 Inspector 按钮与样式即可，不影响既有 graph 入口与 host 协议。
