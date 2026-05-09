# Subtree Open Target Selection

Status: Done
Date: 2026-05-09
Scope: subtree open commands, host readFile open relay, and cross-document node targeting

## 1. Context

Users can double-click a materialized subtree node to enter the subtree file. Today the subtree file opens, but the newly opened editor does not target the node that was just clicked.

Two separate gaps cause that behavior:

- graph double click currently calls `openSelectedSubtree()` without passing the double-clicked `node.ref`, so the command path can observe stale selection state
- host subtree open currently only opens the target file and does not seed selection for the target document

## 2. Goals

- Opening a subtree from a graph node should target the corresponding node inside the opened subtree editor.
- Double click should use the node that was actually clicked, not rely on an eventually consistent selection store.
- If the target subtree document is already open, the selection should still move to the corresponding node.
- The target node should also be revealed in the graph viewport rather than only becoming selected off-screen.

## 3. Non-Goals

- Do not change tree selection authority away from host snapshots.
- Do not introduce a new persistent cross-document navigation history model.
- Do not change subtree save, override, or build semantics.

## 4. Current Behavior

- Node double click opens a subtree file.
- `openSelectedSubtree()` derives the path from current selection state.
- Host `readFile(..., { openIfSubtree: true })` can reveal the subtree editor.
- The target editor boots with its default tree selection unless it already had its own prior selection.

This means users land in the subtree file, but not on the node they just chose from the parent view.

## 5. Proposed Behavior

- Graph double click passes the clicked `NodeInstanceRef` into subtree-open logic.
- Subtree-open commands derive a target selection for the opened document from the clicked node's `sourceStableId`.
- Host `readFile` accepts optional subtree-open selection metadata.
- Before opening the target document, the host stages that selection for the target session; if the target document is already active, the host immediately relays a selection intent into it.
- Host also sends a one-shot node-focus relay so the target editor centers or reveals that node after selection converges.

## 6. Design

- Use `sourceStableId` as the cross-document anchor because it identifies the subtree-authored node, while `structuralStableId` may still point at the parent document's subtree link.
- Normalize the target document selection ref to the opened file's local identity shape:
  - `structuralStableId = sourceStableId`
  - `sourceStableId = sourceStableId`
  - `sourceTreePath = null`
  - `subtreeStack = []`
- Reuse existing host `selectNode` handling for already-open target documents instead of adding a new host-to-editor selection message type.
- Add a separate one-shot host-to-editor focus relay for viewport movement.
  - shared selection authority still lives in host snapshots
  - viewport reveal remains editor-local runtime behavior, similar to variable-focus relay semantics

## 7. Implementation Plan

1. Add this work-item spec and update the affected baseline specs.
   Exit Criteria: the intended subtree-open targeting semantics are documented.
2. Thread optional subtree-open selection through webview command and host `readFile` protocol.
   Exit Criteria: subtree open requests can carry a target node identity.
3. Stage or relay selection in the extension host before revealing the subtree document.
   Exit Criteria: newly opened and already-open subtree editors both receive the target node selection.
4. Add a one-shot node-focus relay for subtree-open targeting.
   Exit Criteria: target subtree editors reveal the opened node in the viewport.
5. Add regression coverage and run checks.
   Exit Criteria: tests cover the controller request shape and protocol serialization.

## 8. Testing Plan

- Add a shared controller test proving double-click-style subtree open uses the explicit node ref and sends a target selection derived from `sourceStableId`.
- Add a host-adapter serialization test proving `readFile` can carry `openSelection`.
- Add a controller/runtime test proving a queued host node-focus relay reveals the matching node after graph state exists.
- Run `npm run test:shared`.
- Run `npm run check`.

Verification completed:

- `npm run test:shared`
- `npm run check`

## 9. Acceptance Criteria

- Double-clicking a materialized subtree node opens the subtree file and targets the corresponding subtree node.
- Opening a subtree from a node no longer depends on host selection having already converged in the current editor.
- Re-opening a subtree that is already open still retargets that editor to the corresponding node.
- After subtree open targeting, the matching node is brought into view instead of only receiving selected styling.
- `npm run test:shared` succeeds.
- `npm run check` succeeds.

## 10. Risks and Rollback

Risk:

- Cross-document selection staging could accidentally override a target editor's own selection when subtree open is triggered.

Mitigation:

- Only stage or relay selection when the open request explicitly includes subtree-open targeting metadata.
- Keep the target identity anchored to `sourceStableId`, which is already the subtree-authored node identity.

Rollback:

- Remove the optional subtree-open selection payload from `readFile` and restore plain subtree-open behavior.
