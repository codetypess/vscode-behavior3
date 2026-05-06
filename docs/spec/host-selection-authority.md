# Host Selection Authority

Status: Done
Date: 2026-05-07
Scope: Migrate shared tree/node selection authority from editor-local runtime projection plus inspector echo to extension-host selection intents and snapshot fanout

## 1. Context

The previous host-authority work item completed the main-document snapshot migration:

- save, undo/redo, revert, reload, and document mutations now commit in host
- committed document fanout now uses `documentSnapshotChanged`
- structural mutation follow-up selection can already piggyback on host snapshot fanout

However, ordinary selection still follows an older split path:

- editor canvas clicks call local `selectTree` / `selectNode`
- editor updates its own `selectionStore` first
- editor mirrors the resulting inspector DTO back to host with `reportInspectorSelection`
- host rebroadcasts that DTO to the inspector sidebar as `inspectorSelectionChanged`

That means shared selection is not yet host truth even though the main document is.

## 2. Goals

- Make tree/node selection an explicit host intent and host-owned shared snapshot.
- Let editor and sidebar consume the same host selection payload instead of editor-generated inspector DTO echoes.
- Keep mutation-follow selection aligned with the same shared selection state.
- Preserve current search, variable-focus, graph-selection, and inspector rendering behavior while ownership moves.

## 3. Non-Goals

- No migration of `activeVariableNames` to host in this work item.
- No rewrite of inspector form semantics or pending-edit flushing rules.
- No attempt to make host synthesize full `EditNode` DTOs.
- No change to resolved-graph identity rules beyond reusing them for host selection matching.

## 4. Current Behavior

- `selectionStore` is still locally authoritative in the editor.
- `reportInspectorSelection` sends an editor-built `EditNode | null` back to host.
- The host stores that DTO and fans it out as `inspectorSelectionChanged`.
- The sidebar applies the DTO directly instead of rebuilding the selection projection from its own runtime graph.
- `documentSnapshotChanged` already carries mutation-follow `nextSelection`, but ordinary `selectTree` / `selectNode` do not enter the host first.

## 5. Proposed Behavior

- Editor selection gestures send `selectTree` or `selectNode` intents to the host.
- The host updates one shared selection snapshot for the active document session.
- The host folds that shared selection snapshot into `init` and `documentSnapshotChanged`.
- Editor and sidebar both project the host selection snapshot locally against their own runtime graph.
- Mutation commits keep using reducer `nextSelection`, but the host immediately translates that result into the same shared selection snapshot before fanout.
- `reportInspectorSelection` and `inspectorSelectionChanged` are removed.

## 6. Design

### 6.1 Host Selection Snapshot Shape

Use one lightweight shared selection DTO:

- `{ kind: "tree" }`
- `{ kind: "node", ref: NodeInstanceRef }`

For ordinary editor selection, the host stores the full `NodeInstanceRef` received from the initiating webview.

For mutation-follow selection, the host may synthesize a placeholder `NodeInstanceRef` from `nextSelection` using:

- `instanceKey = structuralStableId`
- `displayId = ""`
- `sourceStableId = structuralStableId`
- `sourceTreePath = null`
- `subtreeStack = []`

This keeps the host-side selection shape uniform while still allowing webviews to rebind by structural identity after rebuilds.

### 6.2 Fanout Rule

Do not introduce a second selection-only host message.

Instead:

- `init` includes the current host selection snapshot
- `documentSnapshotChanged` includes the current host selection snapshot on every fanout

This keeps host-owned document/session/selection convergence on one snapshot surface.

### 6.3 Webview Projection Rule

Webviews continue to own projection, not authority.

When a host selection snapshot arrives:

- if it is tree selection, clear node selection locally
- if it is node selection, try direct `instanceKey` rebinding first
- then fall back to the existing stable-id matching order already used by selection restore
- if no node can be matched, keep the host-provided ref as a pending selection projection

The sidebar no longer consumes host-built `EditNode` DTOs; it rebuilds `selectedNodeSnapshot` locally from its own resolved graph.

User gestures in the main editor may still optimistically refresh the local selection projection before the host echo returns, but that optimistic state is not shared truth; the committed shared selection still comes from host snapshots.

### 6.4 Variable Focus Boundary

`activeVariableNames` stays local in this work item.

Implications:

- user gestures may still clear variable focus locally before the host selection echo returns
- host fanout does not become the source of truth for variable-focus state
- sidebar may clear local variable focus when host selection changes, as today

### 6.5 Mutation Integration

When host-side mutation reducers return `nextSelection`:

- the response may still carry `nextSelection`
- the host must also update the shared host selection snapshot in the same commit
- the following `documentSnapshotChanged` must carry the updated host selection snapshot

This makes mutation-follow selection and ordinary clicks share one authority model.

## 7. Implementation Plan

### Phase 1. Spec and Protocol

- Add this work item.
- Extend host selection DTOs and init/snapshot payloads.
- Replace `reportInspectorSelection` / `inspectorSelectionChanged` with `selectTree` / `selectNode` intents plus host selection in snapshots.

Exit criteria:

- The protocol documents host-owned selection intent and snapshot fanout.

### Phase 2. Host Session Ownership

- Store the current shared selection in the host editor session.
- Update selection on ordinary selection intents.
- Update the same shared selection on mutation `nextSelection`.

Exit criteria:

- The host session can answer “what is the current shared selection?” without depending on editor-local DTO echo.

### Phase 3. Webview Projection

- Make editor selection commands send host intents and treat any local pre-echo projection as optimistic only.
- Make editor and sidebar rebuild selection from host snapshots locally.
- Remove the old inspector selection echo path.

Exit criteria:

- Sidebar selection stays in sync without `inspectorSelectionChanged`.
- Editor and sidebar selection both converge from the same host selection snapshot.

## 8. Testing Plan

- Add shared tests that:
  - `selectTree` / `selectNode` route through host intent methods
  - host document snapshots with shared selection update local selection projection
  - mutation-follow selection updates host snapshot selection
- Manual regression for:
  - clicking nodes in the editor updates sidebar selection
  - clicking the canvas root/tree context updates sidebar tree inspector
  - search result navigation still selects the matching node
  - mutation commands still end on the expected selected node

## 9. Acceptance Criteria

- Running `npm run check` succeeds.
- Running `npm run test:shared` succeeds.
- Ordinary editor selection no longer depends on `reportInspectorSelection`.
- Sidebar selection no longer depends on `inspectorSelectionChanged`.
- `init` and `documentSnapshotChanged` expose the current host selection snapshot.
- Mutation-follow selection and ordinary clicks converge through the same host selection authority.

## 10. Risks and Rollback

- Risk: optimistic local projection and host echo may diverge briefly around reload/undo boundaries.
- Mitigation: keep the host intent lightweight and always reconcile back to `documentSnapshotChanged.selection`.
- Risk: invalidated node refs after reload/undo may temporarily point at stale identities.
- Mitigation: reuse the existing stable-id restore order and keep tree fallback available when rebinding fails.
- Rollback: revert the selection-intent protocol slice while preserving the already-landed host document snapshot flow.
