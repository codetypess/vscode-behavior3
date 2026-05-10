# Tree Helper Ownership

Status: Done
Date: 2026-05-10
Scope: Move tree parsing and serialization helpers out of `webview/shared/util.ts`.

## 1. Context

`webview/shared/util.ts` currently mixes unrelated helper categories:

- tree parsing and serialization (`readTree`, `writeTree`, `treeDataForPersistence`, file tree IO)
- generic JSON and workspace IO (`readJson`, `readWorkspace`)
- UI class name merging (`mergeClassNames`)
- path helpers that duplicate `b3path` and have no current source callers

The tree-specific helpers are already consumed by `tree.ts`, extension document sync, extension create-tree commands, and build code. Keeping them in a generic `util.ts` hides ownership and leaves another catch-all module in `webview/shared`.

## 2. Goals

- Move tree parsing, persistence shaping, and tree file IO helpers into `webview/shared/tree.ts`.
- Move workspace/settings JSON IO needed by build code to a build-adjacent module.
- Remove the generic `util.ts` file.
- Keep persisted tree serialization behavior unchanged.

## 3. Non-Goals

- Do not change persisted JSON field ordering or omission rules.
- Do not change schema parsing or stable id generation.
- Do not change build output behavior.
- Do not introduce new path helper abstractions.

## 4. Current Behavior

Callers import tree helpers from `util.ts`, while `tree.ts` wraps those helpers to produce persisted tree models. This splits one responsibility across two files.

## 5. Proposed Behavior

- `tree.ts` owns `readTree`, `writeTree`, `treeDataForPersistence`, `readTreeFromFile`, and `writeTreeToFile`.
- `build-project-context.ts` owns the small `readJson` helper it needs to load settings.
- `b3build.ts` reads workspace content directly through `getFs()` and `parseWorkspaceModelContent`.
- Search owns its local class-name join helper.
- `util.ts` is deleted.

## 6. Design

The new boundary is:

- Tree content parsing/serialization belongs to `tree.ts`.
- Build/config file reads stay in build-oriented modules.
- UI-only helpers stay with feature UI.

## 7. Implementation Plan

1. Move tree serialization/parsing helpers into `tree.ts`.
2. Rewrite extension, build, and shared imports from `util.ts` to `tree.ts` or local helpers.
3. Delete unused generic helpers and `util.ts`.
4. Run `npm run check` and `npm run test:shared`.

## 8. Testing Plan

- Run `npm run check`.
- Run `npm run test:shared`.
- Search source for remaining `shared/util` imports.

## 9. Acceptance Criteria

- `webview/shared/util.ts` no longer exists.
- No source import references `shared/util`.
- Existing serialization and build shared tests pass.
- `npm run check` succeeds.
- `npm run test:shared` succeeds.

## 10. Risks and Rollback

Risk: moving serialization helpers can change output if implementation is edited.
Mitigation: move behavior mechanically and rely on serialization/build shared tests.

Rollback: restore `util.ts` and original imports.

## 11. Verification

- `npm run check`
- `npm run test:shared` (94 shared tests passed)
- Source search for `shared/util` imports returns no matches.
