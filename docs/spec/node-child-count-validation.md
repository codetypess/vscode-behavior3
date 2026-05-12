# Node Child Count Validation

Status: Done
Date: 2026-05-12
Scope: Graph/Inspector shared node validation for fixed child arity

## 1. Context

Node definitions can declare a fixed `children` count. The build path already rejects nodes whose active (non-disabled) child count differs from that fixed arity, and the Inspector child-count field displays an error for the selected node.

The left graph node style is driven by shared resolved-node diagnostics, but that shared diagnostic collector currently omits fixed child arity checks. As a result, an `if`-style node that requires 3 active children can have fewer or more children without the graph node entering Error style.

## 2. Goals

- Mark graph nodes as Error when their fixed child arity is violated.
- Use the same active-child counting rule as build validation and Inspector: disabled children are visible but ignored.
- Cover both too few and too many active children.

## 3. Non-Goals

- Do not change drag/drop legality, persistence, or save behavior.
- Do not hide disabled children or change status bit aggregation.
- Do not add a new node definition schema concept.

## 4. Current Behavior

Build validation reports `expect N children, but got M` for fixed-arity nodes. Inspector validates the selected node's child count. The graph Error style is only driven by resolution errors, custom checker diagnostics, and the subset of shared diagnostics currently emitted by `collectResolvedNodeDiagnostics`.

## 5. Proposed Behavior

For any resolved node with a node definition where `children` is defined and not `-1`, shared diagnostics emit `invalid-children` when active child count differs from the expected count. The graph model then marks that node as Error through its existing diagnostic path.

## 6. Design

Add fixed child arity validation to `collectResolvedNodeDiagnostics` in `webview/shared/validation.ts`. This keeps the rule in the shared validation layer already consumed by the graph, rather than duplicating it in the graph selector.

## 7. Implementation Plan

1. Add active-child count validation to shared diagnostics.
2. Add regression tests for the diagnostic and graph Error style.
3. Update the baseline graph/resolved-graph specs because the behavior becomes a lasting UI contract.

## 8. Testing Plan

- Run the shared test suite.
- Run TypeScript checking if the targeted tests pass.

## 9. Acceptance Criteria

- A fixed-arity node with too few active children emits `invalid-children`.
- A fixed-arity node with too many active children emits `invalid-children`.
- Disabled children do not count toward the fixed arity.
- `buildResolvedGraphModel` marks fixed-arity violations as Error.
- `npm run test:shared` succeeds.

## 10. Risks and Rollback

Risk is low because the build path already enforces the same rule. Rollback is reverting the shared diagnostic addition and its tests/spec updates.
