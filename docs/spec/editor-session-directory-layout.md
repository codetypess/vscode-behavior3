# Editor Session Directory Layout

Status: Done
Date: 2026-05-11
Scope: Behavior-preserving `src/editor-session` directory organization

## 1. Context

`src/editor-session` currently keeps session orchestration, document state, settings, path/file helpers, project indexing, node-check runtime helpers, logging, and selection utilities in one flat directory. Many unrelated files use the `session-*` prefix, so the directory does not show which code is the session core and which code is support infrastructure.

The existing architecture already treats `src/editor-session/` as extension-host session ownership. This work keeps that ownership intact and only improves the local directory shape.

## 2. Goals

- Group editor-session support modules by responsibility.
- Keep `tree-editor-webview-session.ts` as the session orchestration entry point.
- Preserve runtime behavior, host/webview protocol, persistence, save/reload/history, selection, settings, and build/check semantics.
- Remove stale empty directory clutter if present.

## 3. Non-Goals

- No user-facing behavior changes.
- No protocol, persisted model, command, selection, save, reload, or build semantics changes.
- No functional split of `tree-editor-webview-session.ts` internals in this pass.
- No migration of session-owned node-check validation into `src/build/`.

## 4. Current Behavior

- `tree-editor-webview-session.ts` imports flat helper modules from `src/editor-session`.
- `session-settings.ts` contains basic VS Code language/theme helpers.
- `session-live-settings.ts` contains the live editor settings resolver.
- File request handling, workdir path helpers, document version guards, project indexing, runtime logging, and operation queue helpers all live in the same flat directory.

## 5. Proposed Behavior

Runtime behavior remains the same. Internally, helper files move into responsibility folders:

- `document/`: main document sync/session state and file version/write guards.
- `settings/`: basic editor setting helpers and live settings resolver.
- `files/`: workdir path helpers and file request handlers.
- `project/`: project index and session node-check runtime helpers.
- `runtime/`: operation queue and runtime/build logging helpers.
- `selection.ts`: session selection helper stays as a small root-level helper because it is directly tied to session snapshots.

## 6. Design

The directory layout is mechanical. Imports should point to the new grouped modules directly; this pass does not add compatibility facade files for old internal paths. External package exports are unaffected because these files are not public npm exports.

`session-node-check-runtime.ts` moves under `project/` because the helper is editor-session-owned validation infrastructure that reads the Behavior3 workspace context and custom check scripts for an active document. `src/build/` remains reserved for user-triggered build and batch command entry points.

## 7. Implementation Plan

1. Move the flat helper modules into their responsibility folders.
2. Update TypeScript imports in source, tests, and docs that mention concrete paths.
3. Remove stale empty directory clutter.
4. Run `npm run check` and `npm run test:shared`.

## 8. Testing Plan

Automated checks:

- `npm run check`
- `npm run test:shared`

No new behavior tests are required because this is an import/path-only refactor.

## 9. Acceptance Criteria

- `src/editor-session` has a readable responsibility-based folder layout.
- Existing session behavior compiles without compatibility shims for old internal paths.
- `npm run check` succeeds.
- `npm run test:shared` succeeds.
- No protocol, persistence, save/reload/history, selection, settings, or build/check behavior changes.

## 10. Risks and Rollback

The main risk is a missed import path or an accidental cycle. Mitigation is to keep moves mechanical and run type/shared tests.

Rollback is mechanical: move files back to their previous flat paths and restore the original import specifiers.
