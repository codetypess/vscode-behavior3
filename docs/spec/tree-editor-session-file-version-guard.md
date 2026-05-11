# Tree Editor Session File Version Guard

Status: Done
Date: 2026-05-11
Scope: Extract newer-file edit guards from `resolveTreeEditorSession`

## 1. Context

`resolveTreeEditorSession` still owns newer-file version guard helpers directly. These helpers update session state for active document version checks, show VS Code warnings/errors, and check target subtree files before writes.

The pure version parsing and message helpers live in `src/editor-session/document/file-version.ts`. That module should remain side-effect free.

## 2. Goals

- Move session-owned newer-file guard state updates and VS Code warning/error side effects into a focused document module.
- Keep `file-version.ts` as the pure parser/message helper.
- Merge the existing subtree target file guard into the same guard module.
- Preserve active-file and target-file edit blocking behavior.

## 3. Non-Goals

- No user-facing behavior changes.
- No version comparison or runtime translation changes.
- No protocol, persisted model, reducer, save/reload/history, selection, subtree tracking, or build/check semantic changes.
- No migration of mutation/save/history handlers in this step.

## 4. Current Behavior

`tree-editor-webview-session.ts` currently owns:

- `updateFileVersionState`
- `getActiveNewerFileEditMessage`
- `blockEditingForNewerFile`
- `getExistingNewerFileEditMessage`

`document/subtree-save-guards.ts` separately owns target-file newer-version checking for subtree saves.

## 5. Proposed Behavior

Runtime behavior remains unchanged. Internally, `src/editor-session/document/file-version-guard.ts` exposes `createFileVersionGuard(context)` with:

- `updateFileVersionState`
- `getActiveNewerFileEditMessage`
- `blockEditingForNewerFile`
- `getExistingNewerFileEditMessage`

The old `subtree-save-guards.ts` module is removed because its only behavior is folded into the guard.

## 6. Design

The guard accepts `TreeEditorSessionContext` and reads/writes only the existing version-related session state fields: `fileVersionIsNewer` and `newerFileVersion`. It may read files through `readWorkspaceFileContent` and show VS Code warning/error messages at the same call sites as before.

`file-version.ts` stays side-effect free and continues to export only pure parsing/message helpers.

## 7. Implementation Plan

1. Add `document/file-version-guard.ts`.
2. Move active file and target file newer-version guard logic into the module.
3. Delete `document/subtree-save-guards.ts`.
4. Replace `tree-editor-webview-session.ts` local guard closures with the new guard capability.
5. Update architecture docs.
6. Run `npm run check` and `npm run test:shared`.

## 8. Testing Plan

Automated checks:

- `npm run check`
- `npm run test:shared`

Manual smoke checks before release:

- Open a newer-version tree file and confirm warning/edit blocking still appears.
- Attempt subtree save over a newer-version target and confirm it is still blocked.

## 9. Acceptance Criteria

- `tree-editor-webview-session.ts` no longer owns newer-file guard helper implementations.
- `file-version.ts` remains pure and side-effect free.
- `subtree-save-guards.ts` is removed after its behavior is merged.
- `npm run check` succeeds.
- `npm run test:shared` succeeds.
- No behavior changes to newer-version warnings, edit blocking, save/subtree target checks, or document operation ordering.

## 10. Risks and Rollback

The main risk is changing warning/error timing or state reset behavior. Mitigation is to keep call sites and guard implementation mechanically equivalent.

Rollback is mechanical: inline the guard methods back into `tree-editor-webview-session.ts` and restore `subtree-save-guards.ts`.
