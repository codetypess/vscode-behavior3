# Tree Editor Session Document Lifecycle

Status: Done
Date: 2026-05-11
Scope: Extract save/revert/history/external-file-change handling from `resolveTreeEditorSession`

## 1. Context

`resolveTreeEditorSession` still owns document lifecycle handlers directly: save, revert, undo, redo, and main document file watcher changes. These handlers share the main document operation queue, file-version guard, subtree reference invalidation, document session history state, and document snapshot fanout.

This is the next useful extraction because the lifecycle handlers form a coherent host-side capability while remaining separate from document mutation reducers and `saveSelectedAsSubtree`.

## 2. Goals

- Move save, revert, history navigation, and main document external-file-change handling into a focused session-local module.
- Preserve serialized operation ordering through the existing main document operation queue.
- Preserve dirty/history/reload-conflict behavior, file-version warning behavior, subtree reference invalidation, and document snapshot fanout.
- Keep dispatcher routing and watcher registration in `tree-editor-webview-session.ts`.

## 3. Non-Goals

- No user-facing behavior changes.
- No changes to save/revert/undo/redo protocol payloads.
- No changes to document mutation reducers, `saveSelectedAsSubtree`, subtree file saving, selection handling, ready handshake, or settings sync.
- No changes to watcher registration or VS Code custom editor provider lifecycle.

## 4. Current Behavior

`tree-editor-webview-session.ts` handles:

- `saveDocument`: blocks editing for newer file versions, runs `vscode.workspace.save`, replies with success/error, and marks Inspector sync kind as reload after successful save.
- `undo` / `redo`: blocks editing for newer file versions, advances the document session history, applies the selected snapshot to document content state, refreshes subtree/file-version state, and fans out an update snapshot.
- `revertDocument`: calls the provider revert implementation under a cancellation token, marks Inspector sync kind as reload on success, and replies with success/error.
- main document file changes: serializes watcher handling, reads disk content, suppresses own writes, reloads clean documents, or records reload conflicts for dirty documents.

## 5. Proposed Behavior

Runtime behavior remains unchanged. Internally, `src/editor-session/session-document-lifecycle.ts` exposes `createSessionDocumentLifecycle(context, inspectorSync, subtreeTracking, fileVersionGuard)` with:

- `handleSaveDocumentMessage(msg, reply?)`
- `handleHistoryNavigationMessage(direction)`
- `handleRevertDocumentMessage(msg, reply?)`
- `handleMainDocumentFileChange()`

`tree-editor-webview-session.ts` continues to route messages and file watcher events to these methods.

## 6. Design

The lifecycle module accepts the existing session capabilities it needs:

- `TreeEditorSessionContext` for document, document session, provider revert function, operation queue, and default postMessage sink
- `SessionInspectorSync` for document snapshot fanout
- `SessionSubtreeTracking` for subtree ref invalidation and refresh
- `FileVersionGuard` for newer-file edit blocking and version state refresh

The module may update `state.inspectorContentSyncKind`, document content state, and document session history/conflict state. It must not own message dispatch, watcher registration, document mutation reducers, subtree file writes, node-check runtime, or settings refresh.

## 7. Implementation Plan

1. Add `session-document-lifecycle.ts`.
2. Move `applySessionHistorySnapshot` into the module as an internal helper.
3. Move save, history, revert, and main document file-change handlers into the module.
4. Replace local closures in `tree-editor-webview-session.ts` with module methods.
5. Update the architecture directory map and spec index.
6. Run `npm run check`, `npm run test:shared`, and `git diff --check`.

## 8. Testing Plan

Automated checks:

- `npm run check`
- `npm run test:shared`
- `git diff --check`

Manual smoke checks before release:

- Save a dirty tree, undo/redo a change, revert a document, and edit the main file externally while clean and dirty.

## 9. Acceptance Criteria

- `tree-editor-webview-session.ts` no longer owns save/revert/history/external-main-file-change implementations.
- Dispatcher routing and watcher registration remain in `tree-editor-webview-session.ts`.
- Save, revert, undo, redo, clean external reload, and dirty reload conflict behavior remain unchanged.
- `npm run check` succeeds.
- `npm run test:shared` succeeds.
- `git diff --check` succeeds.

## 10. Risks and Rollback

The main risk is changing operation ordering around save, history, or external file watcher events. Mitigation is to preserve the same `enqueueMainDocumentOperation` boundaries and move code mechanically.

Rollback is mechanical: inline the lifecycle handlers back into `tree-editor-webview-session.ts` and remove `session-document-lifecycle.ts`.
