# Architecture Maintainability Refactor

Status: Done
Date: 2026-05-07
Scope: Behavior-preserving architecture, runtime, inspector, and stylesheet maintainability cleanup.

## 1. Context

The current implementation already follows the host-first authority model: webviews send intents, the extension host commits document/session state, and snapshots fan out to editor and sidebar projections.

Several implementation details still make the code harder to maintain:

- Some baseline spec language still implies webview `EditorCommand` is the final write authority.
- Editor and sidebar runtime mode decisions are scattered through module-level globals and feature components.
- Equality helpers, request payload builders, and inspector commit timing logic are duplicated.
- `TreeEditorSession`, Inspector forms, graph adapter, and `style.scss` have grown into large files with mixed responsibilities.

## 2. Goals

- Align the long-lived specs with the current host-first implementation.
- Keep all user-facing behavior and protocol messages stable.
- Move reusable helpers into small modules with explicit responsibilities.
- Make webview kind a runtime context concern instead of a leaf-component global check.
- Centralize common equality, inspector payload, and inspector commit queue helpers.
- Split the monolithic stylesheet into focused partials without changing class names.
- Reduce host-session helper clutter by extracting pure path, settings, selection, operation queue, and file-version helpers.

## 3. Non-Goals

- Do not redesign the host protocol or add new raw message types.
- Do not change save, reload, undo, redo, mutation, selection, variable-focus, or subtree semantics.
- Do not replace G6, Ant Design, Zustand, or the current build/test tools.
- Do not change persisted tree serialization or migration behavior.
- Do not rewrite the graph adapter or Inspector UI from scratch.

## 4. Current Behavior

- Main document mutations are committed in the extension host via `mutateDocument`.
- Webview command modules assemble intents, maintain local visual state, and consume host snapshots.
- The sidebar creates its own runtime in module scope and checks `window.__B3_WEBVIEW_KIND__` from feature code.
- Multiple files compare JSON-shaped values via local `JSON.stringify` helpers.
- Inspector submit/flush behavior is a module-level helper inside `inspector-shared.tsx`.
- `webview/style.scss` contains theme tokens, shell layout, graph styling, and inspector styling in one file.

## 5. Proposed Behavior

Behavior remains the same from the user's point of view:

- Editing from canvas or sidebar still goes through host-first mutation.
- Tree/node selection still converges only through host snapshots.
- Variable focus remains a transient editor-local visual effect.
- Save/undo/redo from the sidebar still flush pending Inspector edits first.
- Styling and class names remain compatible with the existing UI.

Implementation behavior changes only by responsibility placement:

- Webview kind is provided by app/runtime context.
- Shared equality and inspector payload helpers are reused instead of duplicated.
- Inspector pending edit tracking lives in a dedicated commit queue module.
- Host-session pure helpers move out of the session body.
- Styles are imported from focused SCSS partials.

## 6. Design

### Spec Alignment

Update baseline specs so they describe the current authority model:

- `EditorCommand` is the webview intent/projection catalog.
- Extension-host session is the final authority for committed main-document mutations, dirty/history, and snapshot fanout.

### Webview Runtime Context

Create a webview-env context owned by the app shell. Feature code asks the runtime context for the kind instead of reading `window.__B3_WEBVIEW_KIND__`.

The main entrypoint creates exactly one runtime for the active webview kind and passes it into the selected app frame.

### Shared Helpers

Add small shared modules for:

- JSON-shaped equality.
- Webview kind context.
- Inspector commit queue.
- Inspector payload construction.

These helpers must not introduce new persistence or protocol semantics.

### Host Session Helpers

Extract pure helper functions from `TreeEditorSession` into focused files while keeping the session orchestration in place:

- path/workdir resolution and safe workspace reads
- selection normalization helpers
- operation queue factory
- file-version message helpers
- small runtime logging helpers where useful

### Styles

Keep `webview/style.scss` as the entrypoint and split its content into partials under `webview/styles/`.

## 7. Implementation Plan

1. Add this work-item spec and update affected baseline specs.
2. Add shared equality, webview-env, inspector commit queue, and inspector payload helper modules.
3. Update editor/sidebar app setup and feature call sites to use runtime context.
4. Extract host-session helpers and wire imports without changing message flow.
5. Split `style.scss` into partials.
6. Run `npm run check` and `npm run test:shared`.

## 8. Testing Plan

- Run `npm run check`.
- Run `npm run test:shared`.
- Use existing shared tests covering host-first mutation, selection convergence, variable focus relay, snapshot application, host request cleanup, inspector arg handling, and CLI build flows.

## 9. Acceptance Criteria

- `npm run check` succeeds.
- `npm run test:shared` succeeds.
- No new raw host/webview protocol message type is introduced.
- Main document mutations still route through `HostAdapter.mutateDocument`.
- Sidebar variable focus still sends `requestFocusVariable`; editor-local graph focus still uses `controller.focusVariable`.
- `webview/style.scss` remains the single imported stylesheet entrypoint while focused partials own the actual style sections.
- The existing user-modified `sample/.vscode/settings.json` is not reverted.

## 10. Risks and Rollback

Risk: moving runtime setup can accidentally create duplicate adapters or lose sidebar context.
Mitigation: create runtime only in `main.tsx` and pass it through existing providers.

Risk: moving inspector queue logic can break save/undo/redo flush timing.
Mitigation: keep the same timeout-based flush semantics and shared tests for pending request cleanup and inspector behavior.

Risk: SCSS splitting can change cascade order.
Mitigation: preserve original order through entrypoint imports.

Rollback: revert the extracted helper imports and restore the previous in-file helper definitions; no persisted data migration is involved.

## 11. Verification

- `npm run check`
- `npm run test:shared`
