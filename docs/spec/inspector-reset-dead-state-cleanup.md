# Inspector Reset Dead State Cleanup

Status: Done
Date: 2026-05-08
Scope: Inspector arg reset field path and unused webview state fields

## 1. Context

Two small maintainability issues remain after the recent Inspector and runtime cleanup:

- `NodeInspectorForm.resetArgField()` queues validation for `["args", arg.name]`, which Ant Design treats as two separate top-level fields instead of the nested `args.<argName>` field.
- `SelectionState.selectedNodeDef`, `WorkspaceState.subtreeSourceRevision`, and `WorkspaceState.hostSubtreeRefreshSeq` are still defined or written, but no runtime consumer reads them.

## 2. Goals

- Resetting a subtree override arg should validate only the target nested arg field.
- Remove dead state fields from contracts, stores, and controller code.
- Keep host/webview protocol, persisted tree data, and command/adapter contracts unchanged.
- Keep baseline specs synchronized with the narrower runtime state shape.

## 3. Non-Goals

- Do not redesign Inspector forms.
- Do not change selection authority, subtree refresh behavior, or graph rebuild semantics.
- Do not add a new React/AntD test harness for the Inspector form.

## 4. Current Behavior

- `resetArgField()` passes `["args", arg.name]` to the field-level commit helper, so validation can include the whole `args` object and an unrelated top-level field name.
- `selectedNodeDef` is written into `selectionStore` but never read.
- `subtreeSourceRevision` and `hostSubtreeRefreshSeq` are initialized or incremented but never consumed.

## 5. Proposed Behavior

- `resetArgField()` passes `[["args", arg.name]]` so only the nested arg path is validated.
- `SelectionState` contains only `selectedTree`, `selectedNodeKey`, `selectedNodeRef`, and `selectedNodeSnapshot`.
- `WorkspaceState` no longer contains subtree refresh revision counters with no consumers.

## 6. Design

- Treat the arg reset bug as a field-path correction only; payload construction and host mutation semantics remain the same.
- Remove unused state at the contract boundary instead of preserving fields with comments, because there is no consumer to document or support.
- Update historical selection work-item wording where it enumerates the old field list.

## 7. Implementation Plan

1. Add this work-item spec.
2. Fix `resetArgField()` to use a nested field target.
3. Remove dead state fields from `contracts.ts`, store initializers, and controller runtime writes.
4. Update affected specs.
5. Run `npm run check` and `npm run test:shared`.

## 8. Testing Plan

- Run `npm run check`.
- Run `npm run test:shared`.
- Manual regression target: with multiple node args, keep one unrelated arg invalid, then reset another subtree override arg and confirm reset is not blocked by the unrelated field.

## 9. Acceptance Criteria

- Type checking succeeds with no remaining references to removed fields.
- Shared tests still pass.
- `resetArgField()` validates the nested target arg path.
- No host/webview protocol or persisted tree type changes are introduced.

## 10. Risks and Rollback

- Risk: a hidden future consumer expected the removed fields.
- Mitigation: `rg` confirmed no runtime readers before removal, and type checking catches local contract use.
- Rollback: restore the removed contract fields and their previous writes; revert the reset field target if AntD behavior changes unexpectedly.
