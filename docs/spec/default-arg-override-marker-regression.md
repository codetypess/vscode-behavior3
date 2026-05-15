# Default Arg Override Marker Regression

Status: Done
Date: 2026-05-15
Scope: subtree default arg override comparison and selection snapshot regression coverage

## 1. Context

Subtree internal nodes are edited through main-document `overrides`. The resolved graph already fills nodeDef arg defaults into both the current resolved node and `subtreeOriginal`, so default-only values should not appear as user-authored overrides.

The visible bug is an override marker in the graph or Inspector for a subtree node whose main document has no effective override entry. This can happen when an override comparison path receives a raw or cached `subtreeOriginal` that is missing a default-filled arg, even though the current resolved node displays the default value.

A second path can light the same Inspector marker even when `subtreeOriginal` is already normalized: selected-node snapshots intentionally used committed main-tree JSON args to avoid writing resolved defaults back into ordinary nodes. Subtree internal nodes have no committed main-tree node, so that projection dropped `selectedNode.data.args`. The Inspector then compared missing args on the selected snapshot against the subtree source args and reported false overrides.

## 2. Goals

- Treat a missing arg and its nodeDef default value as equal during subtree override comparisons.
- Preserve resolved/current args in selected-node snapshots for subtree internal nodes, while keeping committed JSON args for main-tree nodes.
- Keep graph `hasOverride`, Inspector arg override bars, and host reducer diffs aligned.
- Add regression tests that cover UI projection and reducer behavior, not only materialization.

## 3. Non-Goals

- Do not change nodeDef default-value semantics.
- Do not change subtree persistence shape or add a new override encoding.
- Do not redesign the override reset UI.

## 4. Current Behavior

Materialization normalizes `subtreeOriginal`, but downstream comparison code still directly compares raw arg values in some paths. If a selected-node snapshot or test fixture has `subtreeOriginal.args` missing a defaulted key while `selectedNode.data.args` contains the displayed default, the comparison can report an override even though the logical values are equal.

For subtree selections, `selectedNode.data.args` can also be absent because the controller cannot find a committed main-tree node for the materialized subtree node. In that case every arg present on `subtreeOriginal` looks overridden in the Inspector.

## 5. Proposed Behavior

All subtree override comparisons that know the nodeDef should compare args through nodeDef default fallback:

- if an arg key is present, use its actual value
- if an arg key is missing and the nodeDef declares a default, compare using that default
- otherwise compare as `undefined`

Selected-node snapshots should keep two distinct baselines:

- main-tree ordinary nodes use committed persisted JSON args, so resolved defaults stay display-only
- subtree internal nodes use resolved/current args, because override editing compares them against `subtreeOriginal`

## 6. Design

Add a small shared override-comparison helper and use it from:

- graph VM projection for `hasOverride`
- Inspector arg override checks
- host reducer subtree arg diffing

The materializer normalization remains in place; the comparison helper is a defensive consistency layer for raw or cached snapshots.

Update the controller's selected-node snapshot builder so subtree nodes clone `resolvedNode.args` into `data.args`; ordinary main-tree nodes continue to clone only the committed persisted node args.

## 7. Implementation Plan

1. Add the work-item spec.
   Exit Criteria: root cause and desired comparison semantics are documented.
2. Add shared arg override comparison helpers and wire graph, Inspector, and reducer code to them.
   Exit Criteria: default-only args are treated as equal even when one side is missing the key.
3. Preserve subtree selected-node snapshot args while retaining main-tree committed-JSON snapshot semantics.
   Exit Criteria: subtree Inspector comparisons receive current resolved args and main-tree snapshots still omit default-only args.
4. Add regression tests for graph `hasOverride`, reducer diffing with raw `subtreeOriginal`, and controller selected-node snapshots.
   Exit Criteria: tests fail without the helper-level fallback and pass with it.

## 8. Testing Plan

- Run `npm run test:shared`.
- Run `npm run check`.

Verification completed:

- `npm run test:shared`
- `npm run check`

## 9. Acceptance Criteria

- A subtree node whose only difference is a displayed nodeDef default does not set `GraphNodeVM.hasOverride`.
- A subtree update whose only arg difference is a missing-vs-default value does not write a main-document `overrides` arg diff.
- A host-confirmed subtree node selection keeps resolved/current args in `selectedNodeSnapshot.data.args`.
- A host-confirmed main-tree node selection still omits default-only args from `selectedNodeSnapshot.data.args`.
- Existing materializer default normalization tests continue to pass.

## 10. Risks and Rollback

Risk:

- Comparing missing args through defaults could hide a real explicit override that restates the default.

Mitigation:

- Existing semantics already reject default-only override persistence; this change aligns UI and reducer comparisons with that rule.

Rollback:

- Revert the shared helper wiring and its regression tests.
