# Tree Editor Session Dispatcher

Status: Done
Date: 2026-05-11
Scope: Extract editor message dispatch routing from `resolveTreeEditorSession`

## 1. Context

After extracting session capabilities, `resolveTreeEditorSession` still owns the `dispatchEditorMessage` switch. The switch routes host/editor protocol messages to ready, history, selection, mutation, save/revert, settings, build, node-check, logging, and file request handlers.

The remaining switch is routing logic, not document behavior. Extracting it makes the main session file closer to pure capability assembly plus watcher/dispose lifecycle.

## 2. Goals

- Move the editor message dispatch switch into a focused session-local module.
- Preserve every routed handler call, default reply sink, and editor/external source behavior.
- Keep watcher registration, webview message subscription, active webview registration, and dispose lifecycle in `tree-editor-webview-session.ts`.
- Preserve build command execution and webview log forwarding behavior.

## 3. Non-Goals

- No user-facing behavior changes.
- No protocol payload changes.
- No changes to save/revert/history, mutation, selection, ready, settings, node-check, file request, watcher, or dispose semantics.
- No changes to capability modules beyond passing them to the dispatcher.

## 4. Current Behavior

`tree-editor-webview-session.ts` dispatches `EditorToHostMessage` by message type:

- `ready`, `undo`, `redo`, `selectTree`, `selectNode`
- `requestFocusVariable` relay only for non-editor sources
- `mutateDocument`, `saveDocument`, `revertDocument`
- `requestSetting`
- `build`
- `validateNodeChecks`
- `webviewLog`
- `readFile`, `saveSubtree`, `saveSubtreeAs`

The webview message listener catches and logs dispatch errors. Active webview external dispatch uses the same dispatcher with source `external`.

## 5. Proposed Behavior

Runtime behavior remains unchanged. Internally, `src/editor-session/session-dispatcher.ts` exposes `createSessionDispatcher(...)` with:

- `dispatchEditorMessage(msg, reply?, source?)`

`tree-editor-webview-session.ts` creates capabilities, passes them to the dispatcher, and uses the returned dispatch method for active webview external dispatch and webview message subscription.

## 6. Design

The dispatcher receives only the methods and sinks it routes:

- default `postMessage`
- ready, lifecycle, selection, mutation, settings, node-check, and file request handlers

It may execute the build command and forward webview logs. It must not register watchers, mutate document state directly, create capabilities, or own disposal.

## 7. Implementation Plan

1. Add `session-dispatcher.ts`.
2. Move the `dispatchEditorMessage` switch into the module.
3. Replace local dispatcher closure in `tree-editor-webview-session.ts` with the module method.
4. Update architecture directory map and spec index.
5. Run `npm run check`, `npm run test:shared`, and `git diff --check`.

## 8. Testing Plan

Automated checks:

- `npm run check`
- `npm run test:shared`
- `git diff --check`

Manual smoke checks before release:

- Open the editor, perform a mutation, save, run build, and request a file/subtree action.

## 9. Acceptance Criteria

- `tree-editor-webview-session.ts` no longer owns the message dispatch switch.
- Active webview external dispatch and webview message listener still call the same dispatcher.
- Build command and webview log forwarding behavior remain unchanged.
- `npm run check` succeeds.
- `npm run test:shared` succeeds.
- `git diff --check` succeeds.

## 10. Risks and Rollback

The main risk is wiring a handler to the wrong message type or changing the `editor` vs `external` source branch. Mitigation is a mechanical move of the switch and TypeScript exhaustiveness through message narrowing.

Rollback is mechanical: inline the dispatcher switch back into `tree-editor-webview-session.ts` and remove `session-dispatcher.ts`.
