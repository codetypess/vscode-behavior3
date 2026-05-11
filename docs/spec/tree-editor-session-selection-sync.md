# Tree Editor Session Selection Sync

Status: Done
Date: 2026-05-11
Scope: Extract shared selection state handling from `resolveTreeEditorSession`

## 1. Context

`resolveTreeEditorSession` still owns shared selection state updates and the `selectTree` / `selectNode` message handlers directly. The same local `updateSharedSelection` closure is also used by document mutation handling to publish the reducer's next selection.

This makes selection a good intermediate extraction before larger document mutation work: the selection rules are small, host-owned, and already independent from file IO and reducer internals.

## 2. Goals

- Move shared selection state mutation into a focused session-local module.
- Move `selectTree` and `selectNode` message handling into the same module.
- Preserve selection normalization, revision increments, reassert behavior, and fanout behavior.
- Keep dispatcher routing and document mutation orchestration in `tree-editor-webview-session.ts`.

## 3. Non-Goals

- No user-facing behavior changes.
- No changes to selection protocol payloads, normalized node refs, document snapshots, or Inspector/sidebar snapshots.
- No changes to graph-local selection hints, variable focus, save/reload/history, subtree tracking, or document mutation semantics.

## 4. Current Behavior

`tree-editor-webview-session.ts` updates `state.sharedSelection` by applying `applySharedSelectionState`, increments `state.selectionRevision` for changed or reasserted selections, and returns `noop`, `changed`, or `reasserted`.

`selectTree` and `selectNode` are serialized through the main document operation queue. A changed selection fans out a document snapshot without refreshing vars. A reasserted equal selection only refreshes Inspector/sidebar session metadata. A noop does nothing.

Document mutations call the same local update closure when the reducer returns a next selection.

## 5. Proposed Behavior

Runtime behavior remains unchanged. Internally, `src/editor-session/session-selection-sync.ts` exposes `createSessionSelectionSync(context, inspectorSync)` with:

- `updateSharedSelection(selection, opts?)`
- `handleSelectTreeMessage()`
- `handleSelectNodeMessage(msg)`

`tree-editor-webview-session.ts` continues to route messages and document mutations to these methods.

## 6. Design

The selection sync module accepts `TreeEditorSessionContext` and `SessionInspectorSync`. It may update `state.sharedSelection` and `state.selectionRevision`, enqueue selection intents, fan out document snapshots with `refreshVars: false`, and notify Inspector/sidebar sessions for reasserted selections.

It must not parse or mutate document content, run reducers, register watchers, or own graph-local selection hints.

## 7. Implementation Plan

1. Add `session-selection-sync.ts`.
2. Move `updateSharedSelection`, `handleSelectTreeMessage`, and `handleSelectNodeMessage` into the module.
3. Replace local closures in `tree-editor-webview-session.ts` with module methods.
4. Update the architecture directory map and spec index.
5. Run `npm run check`, `npm run test:shared`, and `git diff --check`.

## 8. Testing Plan

Automated checks:

- `npm run check`
- `npm run test:shared`
- `git diff --check`

Manual smoke checks before release:

- Select the tree root and a graph node; confirm editor and Inspector/sidebar selection projections still converge.
- Re-select the same node and confirm Inspector/sidebar session metadata refresh behavior remains intact.

## 9. Acceptance Criteria

- `tree-editor-webview-session.ts` no longer owns shared selection update mechanics or `selectTree` / `selectNode` handler implementations.
- Mutation handling still updates host shared selection through the extracted capability.
- Selection revision, reassert, snapshot fanout, and no-var-refresh behavior remain unchanged.
- `npm run check` succeeds.
- `npm run test:shared` succeeds.
- `git diff --check` succeeds.

## 10. Risks and Rollback

The main risk is changing subtle reassert behavior for equal selections. Mitigation is to move the logic mechanically and preserve the same queue and fanout paths.

Rollback is mechanical: inline the selection handlers and update closure back into `tree-editor-webview-session.ts` and remove `session-selection-sync.ts`.
