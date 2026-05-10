# Node Validation Consolidation

Status: Done
Date: 2026-05-10
Scope: shared node and argument validation helpers

## 1. Context

Build validation, graph error projection, and Node Inspector field validation all perform overlapping checks for node args, slots, variables, expressions, oneof constraints, and children counts. Some low-level variable and expression helpers already live in `webview/shared/validation.ts`, while node-level orchestration is split between build, domain, and Inspector modules.

## 2. Goals

- Move reusable pure node and arg validation helpers into `webview/shared/validation.ts`.
- Let build, graph projection, and Inspector consume shared validation helpers where their behavior overlaps.
- Keep UI formatting, build log formatting, raw form parsing, build normalization, and checker runtime loading outside the shared validation core.

## 3. Non-Goals

- Do not rename `validation.ts` in this step.
- Do not change host/webview protocol messages.
- Do not move `@behavior3.check` runtime loading out of the extension host/build runtime.
- Do not mix build normalization side effects into shared validation.

## 4. Current Behavior

- `validation.ts` owns variable and expression helper functions.
- `webview/domain/tree-validation.ts` owns resolved-node diagnostics and required arg/slot helpers.
- `webview/shared/b3build-context.ts` owns build-only node arg type/options/oneof/children checks.
- Inspector field validation owns its own arg type checks after parsing raw form values.

## 5. Proposed Behavior

- `validation.ts` becomes the source for pure node validation helpers, including required arg/slot checks, argument value checks, full node diagnostics, and resolved-node diagnostics.
- Build keeps its mutation/normalization flow but delegates reusable checks to shared validation helpers.
- Inspector keeps form parsing and localized error formatting but delegates reusable argument checks to shared validation helpers.

## 6. Design

- Shared validation returns structured diagnostics with stable `code` values.
- Build and Inspector keep their own diagnostic-to-string formatting.
- Shared validation accepts structural node input rather than importing domain models, so `webview/shared/**` remains independent from `webview/domain/**` and `webview/features/**`.

## 7. Implementation Plan

1. Add shared node/arg validation helpers to `webview/shared/validation.ts`.
2. Replace domain resolved-node validation with shared exports.
3. Update build context and Inspector arg validation to use the shared helpers.
4. Update tests and specs for the new ownership boundary.

## 8. Testing Plan

- Added focused tests for shared arg scalar and options validation.
- Ran `npm run check`.
- Ran `npm run test:shared`.

## 9. Acceptance Criteria

- `webview/shared/validation.ts` owns pure node and arg validation helpers.
- Build validation still reports invalid nodes and args.
- Graph error projection still marks invalid nodes as errors.
- Inspector field validation still rejects invalid typed arg values.
- Automated tests pass.

## 10. Risks and Rollback

Risk: moving checks may accidentally change error timing or message text. Mitigation: keep raw form parsing and output formatting at their existing call sites and preserve shared diagnostic semantics. Rollback by restoring the previous local helper implementations and keeping only the existing variable/expression helpers in `validation.ts`.
