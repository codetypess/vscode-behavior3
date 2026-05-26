# Oneof Node Error State Regression

Status: Done
Date: 2026-05-26
Scope: shared validation / graph error-state projection / inspector oneof reuse

## 1. Context

Nodes can declare a `oneof` relationship between an arg and an input slot. The Inspector already
rejects invalid edits for that pairing, and the build flow also reports the conflict. However, the
graph node error style is driven by shared validation diagnostics, and the shared diagnostics do not
currently include `oneof` violations. That allows a node to fail `oneof` validation without the
canvas reflecting the error state.

## 2. Goals

- Make `oneof` violations appear in shared node diagnostics.
- Ensure graph nodes render with `Error` style when a `oneof` constraint is violated.
- Reuse the same shared `oneof` validation shape across Inspector, graph projection, and build
  validation where practical.

## 3. Non-Goals

- Redesign the `oneof` schema format.
- Expand this change into a full rewrite of all node validation flows.
- Change unrelated node rendering or inspector submission semantics.

## 4. Current Behavior

- Inspector arg/input editors run local `oneof` checks and can block invalid commits.
- Build validation checks `oneof` separately from shared resolved-node diagnostics.
- Graph node rendering only looks at shared resolved-node diagnostics and custom checker
  diagnostics.
- Because shared resolved-node diagnostics omit `oneof`, a node can be invalid while still
  rendering as a non-error node.

## 5. Proposed Behavior

- Shared validation exposes explicit diagnostics for:
  - missing `oneof` input definitions referenced by args
  - conflicting `oneof` values where both sides are set or both sides are unset
- `buildResolvedGraphModel()` treats those shared diagnostics the same as other validation errors,
  so the node renders with `Error` style.
- Inspector field validation reuses the shared `oneof` diagnostic instead of owning a separate
  parallel message decision.
- Build validation can format the same diagnostic codes when reporting failures.

## 6. Design

- Add `oneof`-specific diagnostic codes to `TreeValidationDiagnostic`.
- Add a shared helper that resolves the related input slot by parsed slot label and validates the
  arg/input pair against `checkOneof`.
- Call that helper from `collectResolvedNodeDiagnostics()`.
- Use the same helper from Inspector validators and build formatting so the constraint definition
  lives in one place.

## 7. Implementation Plan

1. Extend shared validation types and helpers for `oneof`.
   Exit criteria: shared helper returns stable diagnostics for missing related input slots and
   invalid pairings.
2. Wire graph/build/Inspector callers to the shared helper.
   Exit criteria: graph error state and build/Inspector messaging follow the shared diagnostic.
3. Add regression tests.
   Exit criteria: tests cover shared diagnostics and graph error-style projection for `oneof`.

## 8. Testing Plan

- Add shared tests for `collectResolvedNodeDiagnostics()` on `oneof` conflicts.
- Add a graph-model test confirming a `oneof` violation marks the node as `Error`.
- Run the shared test suite or repository check command that covers these modules.

## 9. Acceptance Criteria

- A node whose arg/input `oneof` pair violates the constraint produces a shared validation
  diagnostic.
- A graph node with that diagnostic renders with `nodeStyleKind === "Error"`.
- Inspector `oneof` validation messages are derived from the shared diagnostic shape.
- Build formatting recognizes the same `oneof` diagnostic codes.

## 10. Risks and Rollback

- Risk: shared `oneof` normalization may not exactly match current Inspector/build edge cases.
  Mitigation: keep `checkOneof` as the normalization primitive and add regression tests.
- Rollback: revert the shared `oneof` diagnostic wiring and fall back to the previous local checks.
