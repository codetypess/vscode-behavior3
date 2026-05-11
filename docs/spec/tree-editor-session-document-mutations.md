# Tree Editor Session Document Mutations

Status: Done
Date: 2026-05-11
Scope: Extract host-first document mutation handling from `resolveTreeEditorSession`

## 1. Context

`resolveTreeEditorSession` still owns the largest remaining behavior block: `mutateDocument`, the special host-side `saveSelectedAsSubtree` mutation, content normalization before commit, subtree override pruning, reducer error formatting, and post-mutation selection/snapshot fanout.

This logic is central to host authority and should be isolated as an explicit session capability before the main session file is reduced to orchestration, routing, and watcher lifecycle.

## 2. Goals

- Move document mutation implementation into a focused session-local module.
- Preserve host-first mutation ordering through the existing main document operation queue.
- Preserve content normalization, document session history updates, subtree tracking refresh, file-version refresh, selection updates, and document snapshot fanout.
- Preserve `saveSelectedAsSubtree` file-save behavior and error payloads.
- Keep dispatcher routing, watcher registration, and ordinary file request message handlers in `tree-editor-webview-session.ts`.

## 3. Non-Goals

- No user-facing behavior changes.
- No changes to reducer semantics, persisted tree shape, subtree override semantics, protocol payloads, or runtime translations.
- No changes to save/revert/undo/redo, ready handshake, selection message handling, settings sync, node checks, or watcher registration.
- No changes to file request handlers beyond passing their existing `saveSubtreeContentAs` capability into the mutation module.

## 4. Current Behavior

`tree-editor-webview-session.ts` handles `mutateDocument` by:

- serializing all persisted mutations through the main document operation queue
- blocking edits for newer file versions
- handling `saveSelectedAsSubtree` host-side because it crosses the file-system boundary
- rejecting unsupported mutations with a translated error
- parsing current content, running the shared reducer, and formatting reducer errors
- pruning reachable subtree overrides when a mutation may change reachability
- normalizing serialized content before committing it to `TreeEditorDocument`
- updating document session history, subtree refs, file-version state, and VS Code dirty notification
- applying reducer-provided next selection through host shared selection
- fanning out an authoritative `documentSnapshotChanged`

## 5. Proposed Behavior

Runtime behavior remains unchanged. Internally, `src/editor-session/session-document-mutations.ts` exposes `createSessionDocumentMutations(context, inspectorSync, subtreeTracking, fileVersionGuard, selectionSync, fileRequests)` with:

- `handleMutateDocumentMessage(msg, reply?, source?)`

The module owns mutation-specific helpers:

- content normalization/commit from webview content
- reachable subtree override pruning
- `saveSelectedAsSubtree` special handling

## 6. Design

The mutation module accepts existing session capabilities:

- `TreeEditorSessionContext` for document, state, document session, operation queue, document change callback, and default reply sink
- `SessionInspectorSync` for authoritative document snapshot fanout
- `SessionSubtreeTracking` for subtree ref invalidation/refresh
- `FileVersionGuard` for edit blocking and version refresh
- `SessionSelectionSync` for host shared selection updates
- a narrow file request capability exposing `saveSubtreeContentAs`

The module may mutate main document content and document session history through the existing document/session APIs. It must not own dispatcher routing, watcher registration, ordinary `readFile` / `saveSubtree` messages, ready handshake, settings sync, node-check runtime, or save/revert/history lifecycle handlers.

## 7. Implementation Plan

1. Add `session-document-mutations.ts`.
2. Move `applyContentFromWebview`, reachable subtree override pruning, `saveSelectedAsSubtree`, and `handleMutateDocumentMessage` into the module.
3. Replace local closures in `tree-editor-webview-session.ts` with the module method.
4. Update architecture directory map and spec index.
5. Run `npm run check`, `npm run test:shared`, and `git diff --check`.

## 8. Testing Plan

Automated checks:

- `npm run check`
- `npm run test:shared`
- `git diff --check`

Manual smoke checks before release:

- Edit tree metadata and node args from editor/Inspector.
- Run canvas structural mutations.
- Save a selected node as subtree and confirm the main tree updates to the saved subtree path.

## 9. Acceptance Criteria

- `tree-editor-webview-session.ts` no longer owns document mutation implementation details.
- `mutateDocument` routing remains in `tree-editor-webview-session.ts`.
- Mutation queueing, newer-file edit blocking, reducer errors, subtree override pruning, selection fanout, and document snapshot fanout remain unchanged.
- `saveSelectedAsSubtree` payloads and file-save behavior remain unchanged.
- `npm run check` succeeds.
- `npm run test:shared` succeeds.
- `git diff --check` succeeds.

## 10. Risks and Rollback

The main risk is changing commit ordering around document content, history, subtree refs, selection, or fanout. Mitigation is to move code mechanically and keep the same capability call order.

Rollback is mechanical: inline the mutation handlers and helpers back into `tree-editor-webview-session.ts` and remove `session-document-mutations.ts`.
