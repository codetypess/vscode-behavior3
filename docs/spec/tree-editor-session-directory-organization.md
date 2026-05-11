# Tree Editor Session Directory Organization

Status: Done
Date: 2026-05-11
Scope: Move session capability modules into `src/editor-session/session/` and flatten document mutation helpers

## 1. Context

`tree-editor-webview-session.ts` has been reduced to a small assembly entry point, but its filename repeats the parent directory context and `src/editor-session/` now contains many `session-*.ts` files at the root. The behavior boundaries are clearer than before, but the directory surface is noisy.

The next cleanup should stay inside host-session organization: move session capability modules under a `session/` subdirectory, remove the repeated `session-` filename prefix, and lift nested document mutation helpers to module-private functions.

## 2. Goals

- Move session capability modules into `src/editor-session/session/`.
- Rename moved files to remove the repeated `session-` prefix.
- Rename `tree-editor-webview-session.ts` to `webview-session.ts` and keep it at `src/editor-session/` as the external assembly entry point.
- Lift `document-mutations.ts` nested mutation helpers to module-private functions so the factory only wires dependencies.
- Keep existing `document/`, `files/`, `project/`, `runtime/`, and `settings/` directories in place.
- Preserve runtime behavior and public protocol behavior.

## 3. Non-Goals

- No user-facing behavior changes.
- No changes to session capability responsibilities or exported APIs beyond import paths.
- No behavior split into new files beyond the session directory move.
- No movement of document helpers, file helpers, project helpers, runtime helpers, or settings helpers.
- No broad deletion of completed work-item specs in this change.

## 4. Current Behavior

Session capability modules live directly under `src/editor-session/` with names such as `session-context.ts`, `session-dispatcher.ts`, `session-document-mutations.ts`, and `session-watchers.ts`.

`tree-editor-webview-session.ts` imports each capability from the root directory and assembles them.

## 5. Proposed Behavior

Session capability modules move to:

```text
src/editor-session/session/
  context.ts
  dispatcher.ts
  document-lifecycle.ts
  document-mutations.ts
  file-version-guard.ts
  inspector-sync.ts
  messages.ts
  node-checks.ts
  ready-handshake.ts
  selection-state.ts
  selection-sync.ts
  settings-sync.ts
  subtree-tracking.ts
  watchers.ts
```

`webview-session.ts` continues to assemble capabilities from the new directory.

## 6. Design

This is a mechanical module path refactor. The moved files retain their exported type and function names so call sites do not need semantic changes.

Relative imports inside moved modules must be updated for the extra directory level:

- shared webview imports move from `../../webview/...` to `../../../webview/...`
- editor-session sibling directories move from `./document/...` to `../document/...`
- repository-level helpers move from `../setting-resolver` to `../../setting-resolver`

`session/document-mutations.ts` should keep file-system crossing mutation logic host-side, but its factory should only assemble dependencies and return the public handler. Internal operations such as content application, subtree override pruning, and `saveSelectedAsSubtree` handling can be module-private functions that receive an explicit dependency object.

## 7. Implementation Plan

1. Create `src/editor-session/session/`.
2. Move and rename session capability files with `git mv`.
3. Rename `tree-editor-webview-session.ts` to `webview-session.ts`.
4. Update imports in `webview-session.ts` and moved modules.
5. Lift nested document mutation helpers to module-private functions without changing exported APIs.
6. Update architecture directory map and spec index.
7. Run `npm run check`, `npm run test:shared`, and `git diff --check`.

## 8. Testing Plan

Automated checks:

- `npm run check`
- `npm run test:shared`
- `git diff --check`

Manual smoke checks before release:

- Open a tree editor and trigger ready, selection, mutation, save, settings refresh, and close/dispose flows.

## 9. Acceptance Criteria

- `src/editor-session/session/` contains the session capability modules.
- `src/editor-session/` root no longer contains `session-*.ts` capability files.
- `webview-session.ts` remains the assembly entry point.
- `session/document-mutations.ts` keeps document mutation helper logic module-private instead of nested inside the factory.
- `npm run check` succeeds.
- `npm run test:shared` succeeds.
- `git diff --check` succeeds.

## 10. Risks and Rollback

The main risk is a missed relative import path. Mitigation is to use `git mv`, keep exported names unchanged, and run TypeScript checks.

Rollback is mechanical: move files back to their previous paths and restore imports.
