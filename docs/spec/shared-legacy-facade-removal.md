# Shared Legacy Facade Removal

Status: Done
Date: 2026-05-10
Scope: Remove the remaining `webview/shared/b3util.ts` compatibility facade and route callers to explicit modules.

## 1. Context

The current codebase is a rewritten implementation and does not need to preserve the old `b3util.ts` facade or its broad public surface. After the shared helper consolidation, the only real callers of `b3util.ts` are:

- build CLI setup for `createBuildProjectContext`
- Inspector node argument helpers
- document mutation override diffing
- variable usage traversal through re-exported `dfs`

## 2. Goals

- Remove `webview/shared/b3util.ts` entirely.
- Move build-only context creation to a build-named module.
- Move node argument helpers to a state-free node argument module.
- Keep reducer-only override diffing inside the reducer.
- Avoid retaining unused module-level shared state for compatibility.

## 3. Non-Goals

- Do not change persisted JSON shape.
- Do not change host/webview protocol messages.
- Do not change build output or Inspector validation behavior.
- Do not rewrite `b3build.ts` beyond import ownership needed for this cleanup.

## 4. Current Behavior

`b3util.ts` mixes build context creation, node argument helpers, tree helper re-exports, reducer helper logic, and unused legacy stateful APIs. Most exports have no current callers.

## 5. Proposed Behavior

- `webview/shared/b3build-context.ts` owns `createBuildProjectContext`.
- `webview/shared/node-utils.ts` owns argument type/options/oneof helpers.
- `document.ts` owns subtree override diffing.
- Callers import concrete modules directly.

## 6. Design

This change favors explicit ownership over compatibility facades:

- Build-only state remains isolated in a build context object.
- UI argument helpers stay pure and do not depend on build state.
- Reducer internals remain reducer-local.
- `webview/shared` should not contain broad legacy catch-all modules.

## 7. Implementation Plan

1. Rename `b3util.ts` to `b3build-context.ts` and strip unused legacy exports/state.
2. Add `node-utils.ts` and update Inspector/validation callers.
3. Move `computeNodeOverride` into `document.ts`.
4. Update source comments and specs that still describe `b3util` as current structure.
5. Run `npm run check` and `npm run test:shared`.

## 8. Testing Plan

- Run `npm run check`.
- Run `npm run test:shared`.
- Search source for remaining `b3util` imports.

## 9. Acceptance Criteria

- `webview/shared/b3util.ts` no longer exists.
- No source file imports `shared/b3util`.
- Build CLI still creates isolated build contexts.
- Inspector node argument behavior remains covered by shared tests.
- `npm run check` succeeds.
- `npm run test:shared` succeeds.

## 10. Risks and Rollback

Risk: the build context can accidentally drop validation state used by `b3build.ts`.
Mitigation: keep `createBuildProjectContext` return shape stable for `b3build.ts` and run shared build tests.

Risk: Inspector arg helper imports can miss a file.
Mitigation: TypeScript check catches missing imports.

Rollback: restore the facade file and point callers back to it.

## 11. Verification

- `npm run check`
- `npm run test:shared` (94 shared tests passed)
- `rg -n "from ['\\\"][^'\\\"]*shared/b3util|from ['\\\"]\\.\\/b3util|from ['\\\"]\\.\\.\\/shared/b3util|from ['\\\"]\\.\\.\\/\\.\\.\\/shared/b3util" src webview test -g '*.ts' -g '*.tsx'` returns no matches.
