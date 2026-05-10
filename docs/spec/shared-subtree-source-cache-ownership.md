# Shared Subtree Source Cache Ownership

Status: Done
Date: 2026-05-10
Scope: Move subtree source cache loading into the shared tree module.

## 1. Context

`webview/shared/subtree-source-cache.ts` only exports `loadSubtreeSourceCache()`. The loader depends on `tree.ts` helpers for persisted tree parsing, stable id writeback detection, and reachable subtree path collection.

`tree-model.ts` owns low-level node traversal and normalization helpers that `tree.ts` depends on. Moving the subtree cache loader into `tree-model.ts` would introduce a circular dependency unless tree parsing logic moved there too.

## 2. Goals

- Delete `subtree-source-cache.ts`.
- Move `loadSubtreeSourceCache()` into `webview/shared/tree.ts`.
- Update imports to use `tree.ts`.
- Keep subtree loading and writeback staging behavior unchanged.

## 3. Non-Goals

- Do not move tree parsing or serialization into `tree-model.ts`.
- Do not change subtree cache entry shapes.
- Do not change missing/invalid subtree handling.
- Do not change subtree writeback timing.

## 4. Current Behavior

Callers import `loadSubtreeSourceCache()` from `subtree-source-cache.ts`, while the loader itself imports all persisted tree operations from `tree.ts`.

## 5. Proposed Behavior

`tree.ts` owns persisted tree parsing, serialization, reachable subtree path collection, stable id writeback detection, and subtree source cache loading. `tree-model.ts` remains the lower-level node model helper module.

## 6. Design

This keeps dependency direction acyclic:

- `tree.ts` may depend on `tree-model.ts`.
- `tree-model.ts` should not depend on `tree.ts`.

The loader still receives `readContent` from callers, so it remains side-effect boundary agnostic.

## 7. Implementation Plan

1. Move `loadSubtreeSourceCache()` into `tree.ts`.
2. Delete `subtree-source-cache.ts`.
3. Rewrite source and test imports.
4. Update historical specs that mention the old module if needed.
5. Run `npm run check`, `npm run test:shared`, and `npm run build`.

## 8. Testing Plan

- Run `npm run check`.
- Run `npm run test:shared`.
- Run `npm run build`.
- Search for removed module imports after editing.

## 9. Acceptance Criteria

- `webview/shared/subtree-source-cache.ts` no longer exists.
- `loadSubtreeSourceCache()` is exported from `webview/shared/tree.ts`.
- No source import references `subtree-source-cache`.
- `npm run check` succeeds.
- `npm run test:shared` succeeds.
- `npm run build` succeeds.

## 10. Risks and Rollback

Risk: importing the loader from `tree.ts` can accidentally create a cycle if `tree-model.ts` is chosen as the destination.
Mitigation: keep the loader in `tree.ts`, preserving the existing `tree.ts -> tree-model.ts` direction.

Rollback: restore `subtree-source-cache.ts` and original imports.

## 11. Verification

- `npm run check`
- `npm run test:shared` (94 shared tests passed)
- `npm run build`
- Source search for removed module imports has no matches outside this spec's historical references.
