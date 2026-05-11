# Tree Editor Session Watchers

Status: Done
Date: 2026-05-11
Scope: Extract watcher registration, webview message subscription, and dispose cleanup from `resolveTreeEditorSession`

## 1. Context

`resolveTreeEditorSession` now mostly assembles session capabilities, but it still owns VS Code watcher registration, webview message subscription, project index invalidation, theme change fanout, and dispose cleanup. These responsibilities are lifecycle wiring rather than business behavior, and they can be isolated after the dispatcher and behavior handlers have been extracted.

## 2. Goals

- Move session watcher registration and dispose cleanup into a focused session-local module.
- Preserve setting/workspace/config/theme watcher behavior.
- Preserve main document and subtree file watcher behavior, including project index invalidation and subtree refresh scheduling.
- Preserve webview message subscription, dispatch error logging, and webview dispose cleanup ordering.
- Keep capability creation and active webview entry construction in `tree-editor-webview-session.ts`.

## 3. Non-Goals

- No user-facing behavior changes.
- No changes to watcher patterns, watched paths, project index invalidation rules, or debounce behavior.
- No changes to message dispatch semantics, document mutation/lifecycle behavior, settings sync, or subtree tracking internals.
- No changes to active webview entry shape.

## 4. Current Behavior

`tree-editor-webview-session.ts` currently:

- creates a main document watcher for the current file
- creates a subtree watcher for `**/*.json` under the project root
- registers setting, workspace, Behavior3 configuration, text document, save document, and theme listeners
- subscribes to webview messages and routes them through `dispatchEditorMessage`
- invalidates `projectIndex` on relevant document and file events
- schedules or flushes tracked subtree refreshes
- on webview dispose, clears subtree timers, clears the project index, removes the active webview, notifies Inspector sidebar disposal, and disposes session disposables

## 5. Proposed Behavior

Runtime behavior remains unchanged. Internally, `src/editor-session/session-watchers.ts` exposes `registerSessionWatchers(...)`.

`tree-editor-webview-session.ts` creates the active webview entry, registers it, creates session capabilities, and calls `registerSessionWatchers` with:

- session context
- active webview entry
- dispatcher
- settings refresh handler
- main document file-change handler
- subtree tracking capability

## 6. Design

The watcher module accepts explicit dependencies and owns only lifecycle wiring:

- `TreeEditorSessionContext` for document, panel, workspace/project URIs, project index, postMessage, and dispose callbacks
- `ActiveTreeEditorWebview` for dispose-time removal
- dispatcher for webview message routing
- settings sync for watcher-triggered refresh
- document lifecycle handler for main file changes
- subtree tracking for schedule/flush/clear operations

It may create and dispose VS Code disposables. It must not create behavior capabilities, mutate document content directly, or implement protocol handlers.

## 7. Implementation Plan

1. Add `session-watchers.ts`.
2. Move `disposeAll` and watcher registration into the module.
3. Move webview message subscription and dispose cleanup into the module.
4. Replace local watcher block in `tree-editor-webview-session.ts` with `registerSessionWatchers(...)`.
5. Update architecture directory map and spec index.
6. Run `npm run check`, `npm run test:shared`, and `git diff --check`.

## 8. Testing Plan

Automated checks:

- `npm run check`
- `npm run test:shared`
- `git diff --check`

Manual smoke checks before release:

- Open and close a tree editor.
- Trigger settings refresh, theme change, main file change, subtree file change, and webview messages.

## 9. Acceptance Criteria

- `tree-editor-webview-session.ts` no longer owns watcher registration or dispose cleanup implementation.
- Watcher paths and event handling remain unchanged.
- Webview message dispatch and error logging remain unchanged.
- Dispose cleanup still clears subtree timers, project index, active webview entry, Inspector sidebar session, and session disposables.
- `npm run check` succeeds.
- `npm run test:shared` succeeds.
- `git diff --check` succeeds.

## 10. Risks and Rollback

The main risk is changing watcher lifetime or dispose ordering. Mitigation is to move the code mechanically and keep the same disposable list structure and cleanup order.

Rollback is mechanical: inline the watcher/dispose code back into `tree-editor-webview-session.ts` and remove `session-watchers.ts`.
