# Tree Editor Session Subtree Tracking

Status: Done
Date: 2026-05-11
Scope: Extract subtree tracking and refresh scheduling from `resolveTreeEditorSession`

## 1. Context

`resolveTreeEditorSession` still owns subtree tracking helpers directly after the context and fanout splits. These helpers manage the current main document's transitive subtree reference cache and debounce refreshes when tracked subtree files change.

The watcher registration itself belongs in the session entry point, but the logic for deciding whether a URI belongs to the tracked subtree set and how to flush refreshes is cohesive and can be isolated.

## 2. Goals

- Move subtree reference cache invalidation, refresh, and debounce scheduling into a focused session-local module.
- Keep watcher registration and the decision to call tracking methods in `tree-editor-webview-session.ts`.
- Preserve subtree file refresh timing and host/webview messages.
- Continue reducing `resolveTreeEditorSession` size without touching save/mutation/history handlers.

## 3. Non-Goals

- No user-facing behavior changes.
- No protocol, persisted model, reducer, command, save/reload/history, selection, or build/check semantic changes.
- No migration of watcher registration out of `tree-editor-webview-session.ts` in this step.
- No change to project index behavior or subtree dependency semantics.

## 4. Current Behavior

`tree-editor-webview-session.ts` currently owns:

- `cachedSubtreeRefs` invalidation
- transitive subtree reference refresh through `ProjectIndex`
- tracked subtree URI checks
- parent subtree refresh debounce timer management
- subtree refresh fanout through var metadata, Inspector sync, and `subtreeFileChanged`

## 5. Proposed Behavior

Runtime behavior remains unchanged. Internally, `src/editor-session/session-subtree-tracking.ts` exposes `createSessionSubtreeTracking(context, inspectorSync)`, which returns:

- `invalidateSubtreeRefs`
- `refreshTrackedSubtreeRefs`
- `scheduleTrackedSubtreeRefresh`
- `flushTrackedSubtreeRefresh`
- `clearSubtreeRefreshTimer`

`tree-editor-webview-session.ts` continues to call those methods from content application, history/reload flows, watcher events, and disposal.

## 6. Design

The tracking module accepts `TreeEditorSessionContext` and `SessionInspectorSync`. It may update `state.cachedSubtreeRefs` and `state.subtreeRefreshTimer`, read `document.content`, query `projectIndex`, and post the existing subtree refresh messages through `inspectorSync` and `postMessage`.

It must not register file system watchers, dispatch editor messages, own the main document operation queue, or mutate persisted document content.

## 7. Implementation Plan

1. Add `session-subtree-tracking.ts` with the tracking capability.
2. Remove local subtree tracking helper closures from `tree-editor-webview-session.ts`.
3. Replace call sites with methods from `createSessionSubtreeTracking`.
4. Update the architecture directory map.
5. Run `npm run check` and `npm run test:shared`.

## 8. Testing Plan

Automated checks:

- `npm run check`
- `npm run test:shared`

Manual smoke checks before release:

- Open an editor with reachable subtree files, edit/save a tracked subtree, and confirm vars and graph refresh as before.

## 9. Acceptance Criteria

- `tree-editor-webview-session.ts` no longer owns subtree tracking helper implementations.
- Watcher registration remains in `tree-editor-webview-session.ts`.
- `npm run check` succeeds.
- `npm run test:shared` succeeds.
- No behavior changes to subtree dependency tracking, debounce timing, `subtreeFileChanged`, var refresh, Inspector sync, save/reload/history, or selection.

## 10. Risks and Rollback

The main risk is changing refresh timing or failing to clear the debounce timer on dispose. Mitigation is to keep call sites and debounce delay unchanged and run type/shared tests.

Rollback is mechanical: inline the tracking helpers back into `tree-editor-webview-session.ts` and remove `session-subtree-tracking.ts`.
