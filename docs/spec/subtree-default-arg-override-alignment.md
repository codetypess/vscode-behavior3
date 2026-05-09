# Subtree Default Arg Override Alignment

Status: Done
Date: 2026-05-09
Scope: resolved subtree defaults, Inspector override indicators, and subtree override diffing

## 1. Context

Subtree internal nodes are edited through main-document `overrides` instead of mutating the subtree source file.

At the same time, resolved nodes receive node-definition arg defaults during materialization. Today that default fill happens on the current resolved node, but `subtreeOriginal` is captured before the same normalization. This makes the Inspector and reducer compare two different shapes for the same logical state.

## 2. Goals

- Keep default-filled subtree args from appearing as Inspector overrides when the subtree source did not override them.
- Keep subtree override diffing from writing sparse `overrides` entries that only restate node-definition defaults.
- Preserve existing subtree override behavior for real edits.

## 3. Non-Goals

- Do not change node definition schema or default-value semantics.
- Do not change main-tree inline node editing behavior.
- Do not redesign Inspector override UI.

## 4. Current Behavior

- `materializePersistedTree()` records `subtreeOriginal` before arg defaults are applied.
- The current resolved node then receives arg defaults.
- Inspector override bars compare current resolved args against `subtreeOriginal`.
- Host reducer also compares edited subtree payloads against `subtreeOriginal`.

This causes optional args with defaults such as `bool?` + `default: false` to look overridden even when the source subtree never stored a value.

## 5. Proposed Behavior

- When a subtree node is materialized, both the current resolved node and `subtreeOriginal` are normalized with node-definition arg defaults before any Inspector or reducer comparison uses them.
- Inspector override bars stay off for default-only values.
- Subtree reducer diffs remain empty when the only difference is "resolved default value versus missing persisted key".

## 6. Design

- Keep `subtreeOriginal` representing the subtree-authored state plus outer subtree override chain, but normalize it with the same arg-default fill used for the current resolved node.
- Continue applying main-document `overrides` only to the current resolved node, not to `subtreeOriginal`.
- Rely on the existing arg comparison logic once both sides share the same normalization.

## 7. Implementation Plan

1. Add this work-item spec and update the lasting baseline specs.
   Exit Criteria: the root cause and target behavior are documented.
2. Normalize materialized `subtreeOriginal` with node-definition defaults.
   Exit Criteria: current resolved node and `subtreeOriginal` use the same arg-default rules.
3. Add regression coverage.
   Exit Criteria: tests cover both materialization and subtree override diff behavior for default-only args.

## 8. Testing Plan

- Add a materialization test proving subtree `subtreeOriginal` includes arg defaults alongside the current resolved node.
- Add a reducer test proving a default-only subtree arg does not create a main-document override entry.
- Run `npm run test:shared`.
- Run `npm run check`.

Verification completed:

- `npm run test:shared`
- `npm run check`

## 9. Acceptance Criteria

- A subtree node with a missing persisted arg and a node-definition default does not show an Inspector override bar for that arg.
- Resetting such a field keeps the subtree override diff empty.
- Editing unrelated subtree fields does not serialize default-only arg overrides into main-document `overrides`.
- `npm run test:shared` succeeds.
- `npm run check` succeeds.

## 10. Risks and Rollback

Risk:

- Normalizing `subtreeOriginal` could affect any code that implicitly depended on the old raw-versus-resolved mismatch.

Mitigation:

- Limit the change to the same arg-default normalization already applied to resolved nodes.
- Cover the reducer and materializer paths with regression tests.

Rollback:

- Revert the `subtreeOriginal` normalization and remove the regression expectations.
