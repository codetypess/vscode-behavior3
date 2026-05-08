# Graph Collapse Render Stability

Status: Verifying
Date: 2026-05-08
Scope: graph adapter, collapse/expand rendering, graph-local visual state

## 1. Context

当前编辑器图层在节点右侧提供 `+ / -` 折叠控件，但部分树在点击后会出现渲染异常：目标节点已经进入折叠样式，后代节点却没有真正收起，布局压缩后反而与仍可见的旧后代重叠。

这个问题发生在 graph adapter / G6 runtime 边界，不涉及 persisted tree 或 host mutation。

## 2. Goals

- 点击节点折叠控件后，目标节点的后代必须稳定隐藏。
- 折叠后的布局不得保留旧后代的残影或重叠渲染。
- 折叠状态保持为 graph-local visual state，不写入文档或宿主。
- 在 graph rebuild 后，若同一节点 identity 仍存在，应尽量保留其折叠状态。
- 当 search / focus 命中被折叠祖先遮住的节点时，应自动展开其祖先链以暴露结果。

## 3. Non-Goals

- 不把折叠状态持久化到 persisted tree。
- 不把折叠状态同步到 host、sidebar 或 selection authority。
- 不修改节点数据模型或 Inspector 字段。

## 4. Current Behavior

- 折叠控件当前直接调用 G6 `collapseElement/expandElement`。
- 目标节点会切换到折叠样式，但某些情况下后代节点没有从画布退场。
- 结果是布局按“已折叠”压缩，但画面仍残留旧后代元素，出现重叠。

## 5. Root Cause

当前 graph adapter 把 `ResolvedGraphModel` 当作画布的唯一权威输入，并会在 rebuild 时重新构造整棵树数据。

但折叠控件此前直接调用的是 G6 内部 `collapseElement/expandElement`：

- `collapsed` 样式与 descendants 退场仅存在于 G6 runtime 内部状态
- adapter 自己构造的 graph data 仍始终带完整 `childKeys`
- 这导致“折叠视觉”和“参与布局的数据集”分属两套所有权

在当前自定义节点 + `graph.clear() -> setData() -> render()` 的接入链路下，这个边界不稳定，表现为节点已进入折叠样式，但后代没有稳定收起，最终和压缩后的布局发生重叠。

此外，折叠按钮本身使用的是 `Badge` 复合图形。切换到 adapter-owned collapse state 后，如果点击命中的是 `Badge` 内层的 `text` / `background`，事件不会直接暴露外层 `"collapse"` className，导致按钮点击可能被错误当成普通节点点击而没有触发折叠。

## 6. Proposed Behavior

- Graph adapter 自己维护一份 graph-local collapsed node identity 集合。
- 构建 graph data 时，如果节点处于 collapsed 状态，则：
  - 节点自身仍渲染
  - 节点样式携带 `collapsed: true`
  - 向 G6 提交的数据中不再包含其后代 children
- 点击折叠控件时，不再直接调用 G6 `collapseElement/expandElement`，而是切换本地 collapsed state 并重建图数据。
- rebuild 后若节点 identity 仍可匹配，则继续保留 collapsed state；已不存在的 identity 自动丢弃。
- `focusNode()` 若命中当前不可见节点，应先展开其已折叠祖先，再执行 focus。

## 7. Design

- `G6GraphAdapter` 新增 graph-local collapsed ref 集合。
- `buildTreeDatum()` 依据 collapsed state 决定是否递归 children。
- 折叠控件点击时，通过 adapter 切换 collapsed state 并触发 `renderGraphData()`。
- 折叠控件命中判断需要沿 G6 原始图形父链向上匹配外层 `"collapse"` className，而不能只看最内层命中的子图形。
- `focusNode()` 需要在 graph-local collapsed state 中移除目标节点祖先链上的折叠项，保证 search result 能自动显露。
- 这是纯图层视觉状态，因此规则同步到 `15-graph-contract.md` 与 `17-editor-semantics.md`。

## 8. Implementation Plan

1. 创建 work-item spec，并记录根因与目标行为。
   Exit: spec 明确说明为何不继续依赖当前 G6 collapse runtime。
2. 实现 adapter-owned collapse state。
   Exit: 点击折叠控件后，后代稳定隐藏且不出现残留重叠。
3. 更新基线 spec。
   Exit: graph-local collapse state 的所有权与不持久化规则被记录。
4. 验证。
   Exit: 类型检查通过，并完成针对问题场景的代码级自查。

## 9. Testing Plan

- 运行 `npm run check`。
- 运行 `npm run test:shared`，覆盖 collapsed identity / visible children 回归。
- 覆盖复合 `Badge` 点击沿父链命中 `"collapse"` 的回归。
- 覆盖 search target 展开 collapsed ancestors 的回归。
- 手动审查 graph data 构造路径，确认 collapsed node 不再递归 children。

## 10. Acceptance Criteria

- 点击节点 `+ / -` 折叠控件后，后代节点会从画面中隐藏。
- 折叠动作后不会再出现旧后代与新布局重叠的渲染异常。
- 折叠状态不进入 persisted tree、host snapshot 或 Inspector。
- graph rebuild 后，仍存在的同 identity 节点继续保持折叠状态。
- 搜索或其他 `focusNode()` 路径命中隐藏节点时，会自动展开其已折叠祖先链。

## 11. Risks and Rollback

- 风险：graph rebuild 时如果 identity 匹配不稳，折叠状态可能丢失。
  - 缓解：按 `NodeInstanceRef` identity 比较，而不是只按瞬时 node key。
- 风险：折叠节点若当前有选中或搜索聚焦的后代，视觉上会暂时看不到该后代。
  - 缓解：本次先保持 graph-local 规则最小化，不额外改 selection authority。
- 回滚方式：移除 adapter-owned collapse state，恢复折叠控件直接调用 G6 collapse API。
