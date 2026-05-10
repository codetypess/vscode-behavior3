# Node Definition Slot Utils

Status: Done
Date: 2026-05-10
Scope: node definition lookup consistency and slot definition parsing

## 1. Context

Node definition lookup and slot parsing are used by graph selectors, Inspector fields, variable options, validation, materialization, and mutation reducers. Today, several locations build maps or parse slot suffixes independently.

## 2. Goals

- Provide one shared API for node definition map creation and lookup.
- Provide one shared API for slot label, required flag, and variadic flag parsing.
- Remove Inspector-owned `cleanSlotLabel` as the cross-feature utility.
- Make tests assert the shared parsing rules.

## 3. Non-Goals

- Do not alter node definition schema.
- Do not change `oneof` matching semantics.
- Do not change graph display labels.

## 4. Current Behavior

- `createNodeDefMap()` is in `inspector-variable-options.ts`.
- `cleanSlotLabel()` is in `inspector-validation.ts`.
- Required/variadic checks are repeated through `slot.includes("?")`, suffix replacement, and local `isVariadicSlot` helpers.

## 5. Proposed Behavior

- Callers use `parseSlotDefinition(slot, slotDefs?, index?)`.
- The returned shape includes `label`, `required`, and `variadic`.
- `createNodeDefMap()` lives in shared code and is used consistently.

## 6. Design

- `parseSlotDefinition()` must support standalone slot parsing and indexed variadic validation.
- Variadic slots are valid only when the slot ends with `...` and is the last slot definition.
- Optional slots are those whose raw definition contains `?`, matching existing behavior.

## 7. Implementation Plan

1. Add helper module and tests.
2. Replace Inspector, validation, variable options, and graph/domain call sites.
3. Keep temporary re-exports only if needed for compatibility.
4. Verify.

## 8. Testing Plan

- Unit tests for required, optional, variadic, and label cleanup cases.
- Existing oneof, variable validation, and required-slot tests remain green.

## 9. Acceptance Criteria

- There is one source for slot label cleanup.
- There is one source for required/variadic slot interpretation in modern code.
- Existing behavior is preserved.

## 10. Risks and Rollback

Risk: optional marker parsing can diverge from old `includes("?")` behavior.
Mitigation: keep existing broad optional semantics intentionally and test it.

Rollback: revert imports to local helpers.
