# B3Util State Boundary

Status: Superseded
Date: 2026-05-10
Scope: shared helper globals, pure utility extraction, build/editor compatibility

Superseded By: [`shared-legacy-facade-removal.md`](shared-legacy-facade-removal.md)

## 1. Context

`webview/shared/b3util.ts` used to contain module-level mutable state such as `nodeDefs`, `usingGroups`, `usingVars`, `files`, `checkExpr`, and `workdir`. This work item was an intermediate cleanup before the follow-up removal of the facade.

## 2. Goals

- Separate pure helpers from legacy mutable runtime state.
- Move reusable node definition and slot parsing helpers into state-free shared helpers.
- Avoid widening this work into a complete rewrite of the legacy build compatibility layer.
- Make feature/domain code prefer explicit helper inputs over shared globals.

## 3. Non-Goals

- Do not remove public legacy exports that build scripts or older code paths still use.
- Do not rewrite the build runtime.
- Do not change validation behavior or persisted serialization semantics.

## 4. Current Behavior

- Feature/domain code imported a mixture of pure helpers and stateful helpers from `b3util.ts`.
- `createBuildProjectContext()` already provides a partial state-local path for offline builds.
- Node definition map creation is currently defined inside Inspector feature code.

## 5. Proposed Behavior

- Pure node definition and slot helpers live in `webview/shared/node-utils.ts`.
- Follow-up behavior removes the `b3util.ts` facade entirely and routes callers to explicit modules.
- New feature/domain code imports state-free helpers directly.

## 6. Design

- Add `node-utils.ts` for nodeDef map/group/lookup helpers plus `?`, `...`, and clean label parsing.
- This intermediate step kept `b3util` exports for compatibility; the follow-up removes that compatibility surface.

## 7. Implementation Plan

1. Add pure shared helper modules.
   Exit: helpers have no module-level mutable state.
2. Update feature/domain imports.
   Exit: Inspector/domain code no longer defines nodeDef map or slot parsing locally.
3. Delegate from `b3util` where compatible.
   Exit: legacy callers keep compiling during this intermediate step.
4. Verify.
   Exit: `npm run check` and `npm run test:shared` pass.

## 8. Testing Plan

- Add tests for node definition map and slot parsing helpers.
- Existing validation, inspector, graph, build, and subtree tests must continue passing.

## 9. Acceptance Criteria

- Feature/domain modules use shared pure helpers for nodeDef maps and slot parsing.
- Superseded follow-up removes `b3util.ts`; this original criterion only applied to the intermediate cleanup.
- No behavior change in shared tests.

## 10. Risks and Rollback

Risk: moving helpers can accidentally change optional/variadic slot semantics.
Mitigation: add explicit helper tests before broad call-site changes.

Rollback: restore local helper definitions and imports.
