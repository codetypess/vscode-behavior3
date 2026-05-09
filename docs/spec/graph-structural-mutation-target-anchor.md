# Graph Structural Mutation Target Anchor

Status: Verifying
Date: 2026-05-08
Scope: Keep structural edit target anchors stable across graph rebuilds

## 1. Context

Dragging node A onto node B, inserting a child under the selected node, and deleting a selected node all change the persisted tree, then the host fans out a committed snapshot that causes the editor to rebuild the graph.

The graph adapter already preserves viewport stability during generic rebuilds by anchoring the visible center. That is correct for passive rebuilds, but it is not specific enough for user-initiated structural edits where the user is acting on a visible target node.

## 2. Goals

- When dropping A onto B, keep B at the same screen position across the committed graph rebuild.
- When inserting a node under the selected target, keep that selected target at the same screen position across the committed graph rebuild.
- When deleting a node, keep the nearest surviving local context node stable. The candidates are the deleted node's siblings and parent; choose whichever is closest to the deleted node in the current viewport.
- Keep host document mutation authority unchanged.
- Keep the graph adapter responsible for geometry and viewport compensation.

## 3. Non-Goals

- Do not change drop legality rules or reducer semantics.
- Do not auto-focus the moved, newly inserted, or post-delete selected node.
- Do not persist viewport anchors in the document, host snapshot, or history.
- Do not change paste or replace anchoring in this work item.

## 4. Current Behavior

- `performDrop()`, `insertNode()`, and `deleteNode()` send host mutation intents.
- On success, host snapshot fanout drives `applyDocumentTree()` and `rebuildGraph()`.
- `G6GraphAdapter.render()` captures the center-nearest visible node as the rebuild anchor.
- If B is not the center-nearest visible node, B may shift on screen after the rebuild.
- Deleting a selected node currently selects the parent after host commit, but does not use the parent or nearby sibling as a viewport anchor.

Root cause: the mutation command path does not tell graph render which node should represent the user's local operation context, so render falls back to center anchoring.

## 5. Proposed Behavior

- `performDrop(intent)` records `intent.target.instanceKey` as a one-shot graph render anchor before sending the host mutation.
- `insertNode()` records the selected target node as the same one-shot graph render anchor before sending the host mutation.
- `deleteNode()` asks the graph adapter to choose the closest surviving anchor from the selected node's siblings plus parent, measured against the selected node's current viewport position, then records that winner as the one-shot render anchor.
- The next graph rebuild passes that anchor hint into `GraphAdapter.render()`.
- The adapter captures the hinted node's current viewport position before replacing graph data, then restores the viewport and applies the existing anchor compensation after render.
- If the hinted node is unavailable, render falls back to the existing center-anchor behavior.

## 6. Design

- Extend the graph adapter render input with optional render options containing `anchorNodeKey`.
- Add a graph-local geometry query for delete anchoring: given a source node key and candidate node keys, return the visible candidate closest to the source in viewport coordinates.
- Keep the option as a webview-local visual hint. It is not a host protocol field.
- Store the pending anchor in controller runtime because the host snapshot arrives asynchronously after the mutation intent.
- Consume the pending anchor on the next `rebuildGraph()` so later unrelated rebuilds keep the existing center-anchor behavior.

## 7. Implementation Plan

1. Update specs.
   Exit: this work item plus affected baseline specs describe target-node anchoring.
2. Add optional render anchor plumbing.
   Exit: `GraphAdapter.render(model, opts?)` accepts `anchorNodeKey`.
3. Record one-shot anchors for drop, insert, and delete.
   Exit: `performDrop()` uses the drop target, `insertNode()` uses the selected target, and `deleteNode()` uses the closest sibling/parent candidate.
4. Use the hinted anchor in `G6GraphAdapter.render()`.
   Exit: hinted anchor wins over center anchor when available.
5. Add regression tests.
   Exit: shared tests verify drop, insert, and delete rebuilds pass target anchor keys.

## 8. Testing Plan

- Run `npm run check`.
- Run `npm run test:shared`.
- Manually inspect the flow by dragging A onto B, inserting under a visible node, and deleting a node with nearby siblings while panned or zoomed.

## 9. Acceptance Criteria

- Dropping A onto B keeps B in the same screen position after the graph rebuild.
- Inserting under the selected target keeps that target in the same screen position after the graph rebuild.
- Deleting a node keeps the closest surviving sibling/parent candidate in the same screen position after the graph rebuild.
- The moved/new/post-delete node selection is still applied through the existing host snapshot selection path.
- Generic rebuilds without a pending target anchor still use center anchoring.
- No host snapshot or persisted tree schema changes are introduced.

## 10. Risks and Rollback

- Risk: a stale pending anchor could affect a later unrelated rebuild if a mutation succeeds without a snapshot. This is mitigated by limiting the anchor to mutation paths that commit structural changes and consuming it on the next rebuild.
- Rollback: remove the optional render anchor plumbing and the two command-level anchor writes; existing center anchoring remains intact.
