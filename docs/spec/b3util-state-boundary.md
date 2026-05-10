# B3Util State Boundary

Status: Done
Date: 2026-05-10
Scope: shared misc helper globals, pure utility extraction, build/editor compatibility

## 1. Context

`webview/shared/misc/b3util.ts` still contains module-level mutable state such as `nodeDefs`, `usingGroups`, `usingVars`, `files`, `checkExpr`, and `workdir`. Some of this exists for legacy runtime/build APIs, but the modern webview runtime already uses explicit stores and context.

## 2. Goals

- Separate pure helpers from legacy mutable runtime state.
- Move reusable node definition and slot parsing helpers into state-free shared modules.
- Avoid widening this work into a complete rewrite of the legacy build compatibility layer.
- Make feature/domain code prefer explicit helper inputs over `b3util` globals.

## 3. Non-Goals

- Do not remove public legacy exports that build scripts or older code paths still use.
- Do not rewrite the build runtime.
- Do not change validation behavior or persisted serialization semantics.

## 4. Current Behavior

- Feature/domain code imports a mixture of pure helpers and stateful helpers from `b3util.ts`.
- `createBuildProjectContext()` already provides a partial state-local path for offline builds.
- Node definition map creation is currently defined inside Inspector feature code.

## 5. Proposed Behavior

- Pure node definition and slot helpers live under `webview/shared/`.
- `b3util.ts` reuses those helpers where possible and remains only as a compatibility façade for legacy/stateful APIs.
- New feature/domain code imports state-free helpers directly.

## 6. Design

- Add `node-definition-utils.ts` for nodeDef map/group/lookup helpers.
- Add `slot-definition-utils.ts` for `?`, `...`, and clean label parsing.
- Keep `b3util` exports for compatibility by delegating to the new helpers where safe.

## 7. Implementation Plan

1. Add pure shared helper modules.
   Exit: helpers have no module-level mutable state.
2. Update feature/domain imports.
   Exit: Inspector/domain code no longer defines nodeDef map or slot parsing locally.
3. Delegate from `b3util` where compatible.
   Exit: legacy callers keep compiling.
4. Verify.
   Exit: `npm run check` and `npm run test:shared` pass.

## 8. Testing Plan

- Add tests for node definition map and slot parsing helpers.
- Existing validation, inspector, graph, build, and subtree tests must continue passing.

## 9. Acceptance Criteria

- Feature/domain modules use shared pure helper modules for nodeDef maps and slot parsing.
- `b3util.ts` keeps existing public API but no longer owns duplicated slot parsing logic.
- No behavior change in shared tests.

## 10. Risks and Rollback

Risk: moving helpers can accidentally change optional/variadic slot semantics.
Mitigation: add explicit helper tests before broad call-site changes.

Rollback: restore local helper definitions and imports.
