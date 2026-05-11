# Tree Editor Session Fanout

Status: Done
Date: 2026-05-11
Scope: Extract Inspector/session snapshot fanout from `resolveTreeEditorSession`

## 1. Context

`resolveTreeEditorSession` now has an explicit `TreeEditorSessionContext`, but it still owns Inspector/session snapshot fanout helpers directly. These helpers are cohesive: they build var messages, build document snapshots, refresh project variable metadata, notify the Inspector sidebar coordinator, and broadcast host snapshots back to the editor.

This fanout logic is used by multiple handlers, but it does not decide when a mutation, save, undo, reload, or selection operation should happen.

## 2. Goals

- Move Inspector/session snapshot fanout into a focused session-local capability module.
- Keep `tree-editor-webview-session.ts` responsible for deciding when to call fanout.
- Preserve host/editor protocol payloads and Inspector sidebar synchronization behavior.
- Reduce `resolveTreeEditorSession` size before touching mutation/save/history handlers.

## 3. Non-Goals

- No user-facing behavior changes.
- No protocol, persisted model, reducer, command, save/reload/history, selection, or build/check semantic changes.
- No migration of mutation/save/history/reload handlers in this step.
- No change to project indexing semantics beyond moving the existing variable refresh helper.

## 4. Current Behavior

`tree-editor-webview-session.ts` currently owns:

- var declaration message construction for Inspector/sidebar updates
- document snapshot message construction
- Inspector sidebar coordinator updates
- latest var/all-files refresh from `ProjectIndex`
- editor/sidebar snapshot fanout after committed host state changes

## 5. Proposed Behavior

Runtime behavior remains unchanged. Internally, `src/editor-session/session-inspector-sync.ts` exposes `createSessionInspectorSync(context)`, which returns:

- `buildInspectorVarsMessage`
- `buildDocumentSnapshotMessage`
- `notifyInspectorSessionUpdate`
- `refreshLatestVarDeclsFromContent`
- `fanoutDocumentSnapshot`

`tree-editor-webview-session.ts` continues to call those methods from ready, settings, subtree refresh, selection, mutation, save/history/reload, and watcher flows.

## 6. Design

The fanout module accepts `TreeEditorSessionContext` and mutates only the existing session state fields it already updated in-place: `latestAllFiles` and `latestVarDecls`. It may post host messages through the context `postMessage`, but it does not register watchers, dispatch editor messages, or enqueue document operations.

This keeps fanout centralized without moving operation ordering or persistence decisions.

## 7. Implementation Plan

1. Add `session-inspector-sync.ts` with the fanout capability.
2. Remove the equivalent local helper closures from `tree-editor-webview-session.ts`.
3. Replace call sites with methods from `createSessionInspectorSync(context)`.
4. Update the architecture directory map.
5. Run `npm run check` and `npm run test:shared`.

## 8. Testing Plan

Automated checks:

- `npm run check`
- `npm run test:shared`

Manual smoke checks before release:

- Open an editor and confirm init, Inspector/sidebar update, selection fanout, save/undo/reload snapshot updates, settings refresh, and subtree refresh still behave as before.

## 9. Acceptance Criteria

- `tree-editor-webview-session.ts` no longer owns Inspector/session fanout helper implementations.
- The fanout module owns no watcher registration, dispatcher logic, or main-document operation queue ownership.
- `npm run check` succeeds.
- `npm run test:shared` succeeds.
- No behavior changes to host/editor snapshot payloads, Inspector sidebar synchronization, var metadata refresh, save/reload/history, selection, or subtree refresh.

## 10. Risks and Rollback

The main risk is changing message timing or payload shape while moving fanout logic. Mitigation is to keep call sites in the same order and preserve existing DTO builders.

Rollback is mechanical: inline the fanout capability back into `tree-editor-webview-session.ts` and remove `session-inspector-sync.ts`.
