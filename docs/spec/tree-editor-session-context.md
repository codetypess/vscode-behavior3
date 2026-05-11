# Tree Editor Session Context

Status: Done
Date: 2026-05-11
Scope: Introduce explicit context for `resolveTreeEditorSession`

## 1. Context

`resolveTreeEditorSession` remains too large because it owns a broad closure: VS Code session parameters, derived workspace/project URIs, project index, mutable session state, webview posting, node definition mapping, document session snapshots, and the main-document operation queue are all local variables captured by many handlers.

The previous helper split moved low-coupling helper implementations out of the file, but the session entry point still lacks an explicit boundary for shared runtime dependencies.

## 2. Goals

- Introduce a typed `TreeEditorSessionContext` that owns initialization-time derived values and shared mutable session state.
- Keep `resolveTreeEditorSession` as the orchestration entry point.
- Preserve all protocol payloads, save/reload/history, selection, settings, subtree, watcher, and node-check behavior.
- Prepare later fanout/subtree/message handler extraction without forcing wide parameter lists.

## 3. Non-Goals

- No user-facing behavior changes.
- No protocol, persisted model, reducer, command, save/reload/history, selection, or build/check semantic changes.
- No migration of mutation/save/history/reload handlers out of `tree-editor-webview-session.ts` in this step.
- No class-based session rewrite.

## 4. Current Behavior

`resolveTreeEditorSession` directly constructs workspace/project URIs, project index, live settings resolver, initial session state, document session snapshot helper, webview posting helper, node definition mapper, and operation queue before declaring all handlers in the same closure.

## 5. Proposed Behavior

Runtime behavior remains unchanged. Internally:

- `src/editor-session/session-context.ts` defines session parameter, state, active webview, message sink, and context types.
- `createTreeEditorSessionContext` performs the same initialization work currently done at the top of `resolveTreeEditorSession`.
- `resolveTreeEditorSession` consumes the context and still owns handler declaration, dispatcher registration, watcher registration, and disposal.

## 6. Design

The context is a plain object, not a class. It should contain shared session runtime dependencies that many handlers need:

- original `ResolveTreeEditorSessionParams`
- `workspaceFolderUri`, `projectRootUri`, `projectIndex`
- `state`, `documentSession`
- `resolveLiveSettings`
- `postMessage`, `mapDefsForWebview`, `buildDocumentSessionMessage`
- `enqueueMainDocumentOperation`

The context creator may configure the webview because it is part of session startup. It must not register watchers, add active webviews, dispatch messages, or dispose resources.

## 7. Implementation Plan

1. Add `session-context.ts` with the context/state/params types and creator.
2. Replace top-level initialization in `resolveTreeEditorSession` with `createTreeEditorSessionContext`.
3. Keep handler logic in `tree-editor-webview-session.ts` and destructure context values locally.
4. Run `npm run check` and `npm run test:shared`.

## 8. Testing Plan

Automated checks:

- `npm run check`
- `npm run test:shared`

Manual smoke checks before release remain the same as the previous session split work item.

## 9. Acceptance Criteria

- `resolveTreeEditorSession` no longer directly owns the initial context construction block.
- `TreeEditorSessionContext` exposes the shared dependencies needed for later focused handler extraction.
- `npm run check` succeeds.
- `npm run test:shared` succeeds.
- No behavior changes to session lifecycle, host/webview messages, watchers, save/reload/history, selection, settings, subtree tracking, or node-check validation.

## 10. Risks and Rollback

The main risk is changing initialization order or accidentally omitting a shared dependency from the context. Mitigation is to keep the context creator mechanically equivalent to the previous initialization block and run type/shared tests.

Rollback is mechanical: inline the context creation block back into `tree-editor-webview-session.ts` and remove `session-context.ts`.
