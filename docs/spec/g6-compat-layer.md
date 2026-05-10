# G6 Compat Layer

Status: Approved
Date: 2026-05-10
Scope: G6 adapter unsafe type access and compatibility helpers

## 1. Context

`g6-graph-adapter.ts` must call a few G6 APIs or internals that are not fully represented by public TypeScript types. Today those `as any` / `as unknown` casts live inside the adapter.

## 2. Goals

- Isolate G6 compatibility casts in one helper module.
- Keep the main adapter focused on graph model, viewport, render, and event conversion.
- Preserve behavior across current G6 version.

## 3. Non-Goals

- Do not upgrade G6.
- Do not rewrite the graph adapter.
- Do not change layout or interaction semantics.

## 4. Current Behavior

- Adapter casts node state style and graph internals directly.
- Rendered/destroyed/context checks are local to the adapter.

## 5. Proposed Behavior

- `g6-compat.ts` owns type guards and cast wrappers.
- Adapter imports helpers such as `isRenderedG6Graph`, `readG6Viewport`, and `toG6ElementState`.

## 6. Design

- Compatibility helpers should be narrow and named after the unsafe operation.
- The helper module must not know Behavior3 graph business semantics.

## 7. Implementation Plan

1. Add `g6-compat.ts`.
2. Move unsafe graph rendered/viewport checks and node state casts.
3. Update adapter imports.
4. Verify type check and graph tests.

## 8. Testing Plan

- Existing graph adapter helper tests remain green.
- `npm run check`.
- `npm run test:shared`.

## 9. Acceptance Criteria

- Main adapter has fewer direct `as any` / broad `as unknown` casts.
- G6 internal shape checks live in the compat module.
- Graph behavior remains unchanged.

## 10. Risks and Rollback

Risk: wrapping internals can obscure a needed null check.
Mitigation: keep helpers defensive and return `null`/`false` on missing APIs.

Rollback: inline helpers back into the adapter.
