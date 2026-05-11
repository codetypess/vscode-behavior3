# Tree Editor Session Ready Handshake

Status: Done
Date: 2026-05-11
Scope: Extract `ready` message handshake handling from `resolveTreeEditorSession`

## 1. Context

`resolveTreeEditorSession` still owns the webview `ready` handshake directly. The handler initializes file-version state, refreshes variable and subtree metadata, sends the host init message, sends variable metadata, optionally relays the initial focus node, and then refreshes Inspector/sidebar session metadata.

This handler is a small startup-specific capability and does not need to stay interleaved with document mutation, save/reload, or watcher logic.

## 2. Goals

- Move `ready` message handling into a focused session-local module.
- Preserve bootstrap message ordering and one-shot initial reveal behavior.
- Keep dispatcher routing in `tree-editor-webview-session.ts`.
- Continue shrinking `resolveTreeEditorSession` without touching save/mutation/history semantics.

## 3. Non-Goals

- No user-facing behavior changes.
- No changes to host/webview protocol payloads.
- No changes to init message contents, variable metadata, subtree tracking, file-version warning behavior, or Inspector/sidebar snapshots.
- No changes to watcher registration, save/reload/history, selection, or mutation handling.

## 4. Current Behavior

When the webview sends `ready`, the session:

- reads the current document content
- updates file-version state with `showWarning: true`
- refreshes latest variable declarations and tracked subtree refs in parallel
- replies with the init message
- replies with `varDeclLoaded`
- relays `initialRevealTarget` once, if present
- clears the pending initial reveal target
- notifies Inspector/sidebar session update

## 5. Proposed Behavior

Runtime behavior remains unchanged. Internally, `src/editor-session/session-ready-handshake.ts` exposes `createSessionReadyHandshake(context, inspectorSync, subtreeTracking, fileVersionGuard)` with:

- `handleReadyMessage(reply?)`

The module owns the one-shot pending initial reveal target seeded from the session context.

## 6. Design

The ready-handshake module accepts the existing session capabilities it needs instead of recomputing metadata itself:

- `TreeEditorSessionContext` for document content, initial reveal target, and default postMessage sink
- `SessionInspectorSync` for init/vars messages and Inspector/sidebar fanout
- `SessionSubtreeTracking` for reachable subtree reference refresh
- file-version guard for startup file-version warning state

It must not dispatch arbitrary editor messages, register watchers, mutate document content, or enqueue document operations.

## 7. Implementation Plan

1. Add `session-ready-handshake.ts`.
2. Move `handleReadyMessage` and the pending initial reveal target closure into the module.
3. Replace the local closure in `tree-editor-webview-session.ts` with the module method.
4. Update the architecture directory map and spec index.
5. Run `npm run check`, `npm run test:shared`, and `git diff --check`.

## 8. Testing Plan

Automated checks:

- `npm run check`
- `npm run test:shared`
- `git diff --check`

Manual smoke checks before release:

- Open a tree editor and confirm init, var metadata, subtree refs, and initial node reveal still occur in the same startup flow.

## 9. Acceptance Criteria

- `tree-editor-webview-session.ts` no longer owns `ready` handshake implementation or pending initial reveal state.
- Bootstrap message order remains init, vars, optional focus relay, Inspector/sidebar update.
- Initial reveal target is still emitted at most once.
- `npm run check` succeeds.
- `npm run test:shared` succeeds.
- `git diff --check` succeeds.

## 10. Risks and Rollback

The main risk is changing startup message ordering or sending the initial reveal target more than once. Mitigation is to move the code mechanically and keep the pending target private to the new module.

Rollback is mechanical: inline the ready handler and pending reveal variable back into `tree-editor-webview-session.ts` and remove `session-ready-handshake.ts`.
