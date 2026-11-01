# Condition Abort Scope Hint

Status: Verifying
Date: 2026-11-01
Scope: graph adapter / condition helpers

## 1. Context

`node-conditions.md` 的第 4 步"提示"：选中一项条件时，在画布上标出它能打断的范围，帮用户理解 `self` / `lower` / `both` 的区别。

## 2. Rules

选中节点上的一张条件卡片（`selectedConditionIndex` 非空）时，按这一项的 `abort` 算出打断范围：

- `self`：节点自己的子树（节点和全部后代）。
- `lower`：同一父节点下、它右侧的兄弟节点的子树。被禁用的兄弟节点不会运行，不算在内。
- `both`：上面两者的并集。
- `none`、或者这一项无效（`invalid`：在根节点上，或 `lower` / `both` 的父节点不是 preemptive）：没有打断范围，不做提示。

画布上，范围以外的节点进入灰化态（复用变量高亮和搜索用的 `highlightgray`），选中的节点本身不灰化。只选中节点、没选中条件卡片时不做提示。

## 3. Design

- `webview/shared/condition-branch.ts`：纯函数 `getConditionAbortScope(nodesByKey, nodeKey, abort)`，返回范围内节点的 key 集合，没有范围时返回 `null`。
- `webview/adapters/graph/g6-graph-adapter.ts`：`getNodeStates` 根据当前选中的条件卡片算出范围，范围以外、不是选中节点的节点加 `highlightgray`。范围在选中或模型变化时重算，不在每个节点上重复计算。
- 被折叠的后代不在图上，跳过。

## 4. Testing

- `getConditionAbortScope`：`self` 是子树；`lower` 是右侧未禁用兄弟的子树，不含左侧兄弟和自己；`both` 是并集；`none` 返回 `null`。

## 5. Acceptance Criteria

- 在 hero.json 里选中"攻击"上的 `lower` 条件，"移动""逃跑""Idle"保持原样，其余节点（根、"攻击"的子节点）灰化，"攻击"本身不灰化。
- 选中 `none` 条件或只选中节点，画布不灰化。
- `npm run check`、`npm run test:shared`、`npm run build` 通过。
