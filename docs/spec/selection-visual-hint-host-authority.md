# Selection Visual Hint Host Authority

Status: Done
Date: 2026-05-07
Scope: Remove editor-local optimistic `selectionStore` writes for ordinary tree/node selection while preserving graph-only interaction hints before host snapshot convergence

## 1. Context

The repository already completed two larger selection migrations:

- ordinary `selectTree` / `selectNode` gestures now enter the host first
- the public protocol exposes one committed shared selection authority through `init.selection` and `documentSnapshotChanged.selection`

However, the editor runtime still keeps one remaining dual-track behavior inside `controller-selection-commands.ts`:

- `selectTree()` writes tree projection into `selectionStore` before the host echo returns
- `selectNode()` writes node projection into `selectionStore` before the host echo returns
- the same selection later converges again from host `selection` snapshots

That means the protocol is already single-authority, but the editor-side runtime still briefly treats `selectionStore` as locally authoritative during ordinary clicks and search-driven jumps.

## 2. Goals

- Make host `selection` snapshots the only authority that writes tree/node projection into `selectionStore`.
- Preserve immediate editor feedback for clicks and search jumps as graph-only local hints.
- Keep variable focus and search ownership local to the webview.
- Add regression coverage for clicks, search jumps, variable-hotspot flows, and undo/reload selection convergence.

## 3. Non-Goals

- No host migration for `activeVariableNames` or search state.
- No protocol change to `HostSelectionState`, `init`, or `documentSnapshotChanged`.
- No rewrite of inspector form semantics.
- No attempt in this work item to change double-click/open-subtree behavior beyond the new selection convergence rule.

## 4. Current Behavior

- `applyHostSelectionState()` already projects host-owned `HostSelectionState` into local `selectionStore`.
- `selectTreeState()` and `selectResolvedNodeState()` currently write the same authority fields from editor-local command paths.
- Ordinary node clicks, tree clicks, and search result jumps therefore update:
  - local graph selection immediately
  - local inspector authority immediately
  - host-owned shared selection later
- Variable focus clearing is already local and does not need host round-trips.

Root cause:

- selection projection and graph interaction feedback are still coupled to the same `selectionStore` mutation path.

## 5. Proposed Behavior

- `selectTree()` and `selectNode()` only send host intents for shared selection changes.
- Before the host snapshot arrives, the editor may keep a transient graph-only selection hint.
- That hint must not write `selectedTree`, `selectedNodeKey`, `selectedNodeRef`, `selectedNodeSnapshot`, or `selectedNodeDef`.
- `applyHostSelectionState()` becomes the only runtime entry that writes shared tree/node selection projection into `selectionStore`.
- When a host snapshot arrives, the runtime clears any transient hint and replays the authoritative selection projection.
- Search jumps and variable-hotspot-driven selection reuse the same rule:
  - graph may hint immediately
  - inspector authority waits for host snapshot convergence

## 6. Design

### 6.1 Authority vs Hint Split

Separate two concerns that previously shared one write path:

- authority projection:
  - host snapshot `selection`
  - stored in `selectionStore`
  - used by inspector/sidebar logic
- interaction hint:
  - editor-local graph selection preview
  - not stored in `selectionStore`
  - only used to keep the graph feeling responsive before host echo

### 6.2 Runtime Rule

`ControllerRuntime` may keep ephemeral graph-selection hint state, but:

- the hint is not part of `SelectionState`
- the hint is cleared as soon as host `selection` is applied
- `applyVisualState()` uses the hint only for `graphAdapter.applySelection`
- all inspector-facing selection data still comes from `selectionStore`

### 6.3 Local Variable Focus Boundary

Variable focus remains local:

- ordinary clicks may still clear `activeVariableNames` immediately
- variable hotspot flows may preserve `activeVariableNames`
- host snapshots do not own variable-focus truth

This keeps the current UI behavior while removing local selection authority.

## 7. Implementation Plan

### Phase 1. Spec and Baseline Updates

- Add this work item.
- Update baseline specs that still imply editor-local optimistic authority for ordinary selection.

Exit criteria:

- Specs clearly distinguish host-owned selection projection from graph-only local hints.

### Phase 2. Runtime Refactor

- Remove editor command calls that write shared selection projection directly into `selectionStore`.
- Add runtime support for transient graph selection hints.
- Keep `applyHostSelectionState()` as the only shared selection projection writer.

Exit criteria:

- Ordinary selection commands do not write authority selection fields locally.

### Phase 3. Regression Coverage

- Update shared controller tests to assert:
  - click intent routing without early inspector authority mutation
  - search jumps use host convergence for authority
  - variable-hotspot-style selection preserves local variable focus
  - undo/reload snapshots clear stale hints and win as authority

Exit criteria:

- Shared tests encode the host-only authority rule.

## 8. Testing Plan

- Update `test/shared-suite.ts` selection/controller coverage.
- Run `npm run test:shared`.
- Run `npm run check`.

## 9. Acceptance Criteria

- `selectionStore.selectedTree` and `selectionStore.selectedNode*` no longer change directly inside ordinary `selectTree()` / `selectNode()` command handling.
- `applyHostSelectionState()` is the only runtime entry that projects shared tree/node selection into `selectionStore`.
- Clicking a node or tree still updates graph feedback immediately without granting local inspector authority before host echo.
- Search result navigation still gives immediate graph feedback and converges authority through host snapshots.
- Variable-hotspot selection keeps local variable-focus semantics unchanged.
- Host `documentSnapshotChanged(selection, syncKind: "update" | "reload")` wins over any stale local hint.
- Running `npm run test:shared` succeeds.
- Running `npm run check` succeeds.

## 10. Risks and Rollback

- Risk: a command path still assumes `selectionStore` updates immediately after `selectNode()`.
- Mitigation: update tests to simulate explicit host snapshot convergence instead of relying on local writes.
- Risk: graph visuals may momentarily lose responsiveness if the hint layer is incomplete.
- Mitigation: keep a dedicated graph-only hint path outside `selectionStore`.
- Rollback: temporarily restore editor-local selection projection in commands, but keep host snapshot `selection` as the intended authority target.
