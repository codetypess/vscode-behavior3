# Selection Store Authority Boundary

Status: Done
Date: 2026-05-07
Scope: Keep `selectionStore` limited to host-projected selection authority and move local graph UI state into a dedicated local store

## 1. Context

The repository already completed the earlier protocol-side selection cleanup:

- shared tree/node selection enters the host first
- committed host snapshots expose one public shared selection authority
- editor-local optimistic selection authority was reduced to graph-only hint behavior

However, the current webview model still keeps three ownership classes mixed inside `selectionStore`:

- host-projected `selectedTree`
- host-projected `selectedNode*`
- webview-local `activeVariableNames` and `search`

At the same time, `controller-runtime.ts` already keeps `selectionVisualHint` outside the store as runtime-private state. That is a clear signal that two different boundaries already exist in practice:

- shared selection authority
- local graph UI visual state

This work item formalizes that split at the store/model level.

## 2. Goals

- Restrict `selectionStore` to host-projected tree/node selection authority and inspector-facing selection projection.
- Introduce a dedicated local `graphUiStore` for `activeVariableNames`, `search`, and `selectionVisualHint`.
- Keep graph search, variable highlight, and selection hint behavior unchanged from the user point of view.
- Clear local graph visual state on real reload/reset paths without changing host-owned selection authority rules.
- Preserve sidebar `requestFocusVariable` relay behavior through the new local store boundary.

## 3. Non-Goals

- No change to `HostSelectionState`, `init.selection`, or `documentSnapshotChanged.selection`.
- No cleanup in this work item for the public raw `focusVariable` relay message shape.
- No new shared authority for variable focus or search.
- No inspector form redesign or subtree editing behavior change.

## 4. Current Behavior

- `selectionStore` currently holds both host-owned selection projection and local graph UI state.
- `controller-selection-commands.ts` writes `activeVariableNames` and search patches into `selectionStore`.
- `controller-runtime.ts` reads those local fields back out of `selectionStore` when computing graph highlights and search results.
- `controller-runtime.ts` also keeps `selectionVisualHint` as runtime-private state rather than modeled store state.
- sidebar reset paths clear `selectionStore`, but local graph UI state does not yet have an explicit standalone reset boundary.

Root cause:

- the runtime still treats “selection-adjacent” data as one bucket even though authority and lifecycle already differ.

## 5. Proposed Behavior

- `selectionStore` keeps only host-projected selection authority fields:
  - `selectedTree`
  - `selectedNodeKey`
  - `selectedNodeRef`
  - `selectedNodeSnapshot`
- New local `graphUiStore` keeps:
  - `activeVariableNames`
  - `search`
  - `selectionVisualHint`
- `applyHostSelectionState()` remains the only writer for host-projected selection authority.
- `focusVariable`, search commands, and graph-only selection hints only mutate `graphUiStore`.
- `applyVisualState()` computes:
  - graph selection from `graphUiStore.selectionVisualHint` with `selectionStore.selectedNodeKey` fallback
  - graph highlights from `graphUiStore.activeVariableNames`
  - graph search from `graphUiStore.search`
- Real reload/reset paths clear local graph UI state:
  - sidebar context reset
  - host snapshot reloads that replace document content
- save/rebuild/update flows that preserve the current document content must not unnecessarily clear local graph UI state.

## 6. Design

### 6.1 Authority Store

`selectionStore` becomes the single webview store for host-projected shared selection projection plus inspector-facing derived node snapshots.

Rules:

- no local variable highlight state
- no local search state
- no graph-only hint state

### 6.2 Local Graph UI Store

`graphUiStore` is webview-local and disposable.

It may be reset and rebuilt without affecting:

- host selection authority
- document truth
- workspace truth

Its fields are purely visual/interaction state:

- variable highlight focus
- search overlay state and result index
- transient graph selection hint before host convergence

### 6.3 Reload and Reset Cleanup Rule

When the host snapshot actually replaces document content, local graph UI state resets to its initial state before visual replay. This prevents stale:

- search overlays
- search result indexes
- variable highlights
- graph-only selection hints

Committed host selection projection remains intact and is reapplied through `selectionStore`.

### 6.4 Deferred Protocol Follow-Up

`focusVariable` remains a transient relay in behavior, but this work item does not yet tighten its wording in `13-host-protocol.md`. That protocol cleanup is intentionally deferred to a follow-up work item after the store boundary split lands.

## 7. Implementation Plan

### Phase 1. Spec and Baseline Updates

- Add this work item.
- Update baseline specs to distinguish host-projected selection authority from local graph UI state.

Exit criteria:

- Specs no longer describe `selectionStore` as owning local search or variable focus.

### Phase 2. Store and Runtime Refactor

- Add `graphUiStore` and initial/reset helpers.
- Remove local visual state fields from `SelectionState`.
- Update controller runtime and selection commands to read/write the correct store.
- Move `selectionVisualHint` from runtime-private mutable state into `graphUiStore`.

Exit criteria:

- Local graph visual state no longer depends on `selectionStore`.

### Phase 3. UI and Reset Path Cleanup

- Update runtime hooks, `search-bar.tsx`, and sidebar reset/blur paths.
- Ensure reload/reset cleanup only targets local graph UI state and does not erase host-projected selection authority.

Exit criteria:

- UI flows read the correct store and reset paths are explicit.

### Phase 4. Regression Coverage

- Update shared tests for search, variable highlight, sidebar relay, and reload/reset cleanup.

Exit criteria:

- Shared tests encode the new ownership split.

## 8. Testing Plan

- Update `test/shared-suite.ts` coverage for:
  - search result navigation and overlay state
  - variable highlight focus
  - sidebar `requestFocusVariable` relay into editor-local graph UI state
  - reload/reset cleanup of local visual state
- Run `npm run test:shared`.
- Run `npm run check`.

## 9. Acceptance Criteria

- `SelectionState` no longer contains `activeVariableNames` or `search`.
- A dedicated local `graphUiStore` holds `activeVariableNames`, `search`, and `selectionVisualHint`.
- `applyHostSelectionState()` remains the only writer for host-projected tree/node selection fields.
- Search overlay UI reads and writes the local graph UI store instead of `selectionStore`.
- Variable highlight flows, including sidebar `requestFocusVariable` relay, still update graph highlights correctly.
- Reload/reset paths clear local graph UI state without erasing committed host selection authority.
- Running `npm run test:shared` succeeds.
- Running `npm run check` succeeds.

## 10. Risks and Rollback

- Risk: a command path still reads search or variable focus from `selectionStore`.
- Mitigation: remove those fields from the type and update tests that assert the new store boundary.
- Risk: reload cleanup becomes too broad and clears local visual state on harmless snapshot echoes such as save acknowledgements.
- Mitigation: only reset local graph UI state when the host snapshot actually replaces document content or when the whole sidebar context resets.
- Rollback: temporarily restore local visual fields into `selectionStore`, but keep the intended authority split documented so follow-up work can resume cleanly.
