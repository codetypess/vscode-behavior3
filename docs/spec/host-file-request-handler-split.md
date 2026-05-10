# Host File Request Handler Split

Status: Done
Date: 2026-05-10
Scope: Behavior-preserving extraction of host-side webview file request handlers.

## 1. Context

`src/editor-session/tree-editor-webview-session.ts` remains the largest host-side file. It correctly owns the per-webview session lifecycle, but it also embeds the `readFile`, `saveSubtree`, `saveSubtreeAs`, and subtree "save as" helper bodies. Those handlers are cohesive host file request logic and can be moved behind an explicit helper factory.

## 2. Goals

- Reduce the size and local helper density of `tree-editor-webview-session.ts`.
- Keep `resolveTreeEditorSession()` as the session orchestrator.
- Move host file request handling into a focused `src/editor-session/` module.
- Keep all raw messages, reply payloads, path rules, newer-version guards, and VS Code interactions unchanged.

## 3. Non-Goals

- Do not change host/webview protocol names or DTO shapes.
- Do not change subtree save, save-as, open-subtree, or newer-file blocking behavior.
- Do not move mutation reduction or document save/history handling in this work item.
- Do not introduce a class hierarchy.

## 4. Current Behavior

- `tree-editor-webview-session.ts` directly defines handlers for:
  - `readFile`
  - `saveSubtree`
  - `saveSubtreeAs`
  - reusable `saveSubtreeContentAs`
- `saveSelectedAsSubtree` mutation calls the same local `saveSubtreeContentAs` helper.
- The handlers rely on session-local dependencies such as project root, view type, selection staging, write callback, and newer-version guards.

## 5. Proposed Behavior

Runtime behavior remains the same.

Implementation changes:

- Add `session-file-request-handlers.ts`.
- Export a helper factory that receives explicit session dependencies.
- Return the three raw-message handlers and `saveSubtreeContentAs`.
- Keep the session dispatch switch as the only raw message router.

## 6. Design

Use a plain factory function rather than a class. The dependency surface is explicit:

- `projectRootUri`
- `viewType`
- `stageDocumentSelection`
- `writeDocumentContentToDisk`
- `getActiveNewerFileEditMessage`
- `getExistingNewerFileEditMessage`

The helper module owns only file request behavior. It does not know about document history, dirty state, mutation reducers, project index, or inspector session updates.

## 7. Implementation Plan

1. Add this work-item spec.
2. Add `session-file-request-handlers.ts`.
3. Wire the factory into `resolveTreeEditorSession()`.
4. Replace local file request handler bodies with calls through the factory.
5. Update spec index status.
6. Run `npm run check`.

## 8. Testing Plan

- Run `npm run check`.
- Review diff to confirm no raw message or reply payload shape changed.

## 9. Acceptance Criteria

- `tree-editor-webview-session.ts` no longer contains the full `readFile`, `saveSubtree`, `saveSubtreeAs`, or `saveSubtreeContentAs` implementations.
- `saveSelectedAsSubtree` still reuses the same save-as helper path.
- Raw message dispatch still routes the same message types.
- `npm run check` succeeds.

## 10. Risks and Rollback

Risk: extraction can accidentally change how newer-file guards or VS Code open/save dialogs are called.
Mitigation: move code mechanically and pass the same dependencies explicitly.

Rollback: inline the helper factory back into `tree-editor-webview-session.ts`. No persisted data migration is involved.

## 11. Verification

- `npm run check`
- `npm run test:shared`
