# Inspector Remove Create-Tree Action

Status: Done
Date: 2026-05-16
Scope: Inspector quick actions in sidebar and embedded modes

## 1. Context

The Behavior3 inspector currently exposes quick actions in two mirrored surfaces:

- the VS Code sidebar view title
- the embedded inspector header toolbar

Both surfaces currently include a `createTree` action. The user wants that “create file” shortcut removed from the inspector UI while keeping the underlying `behavior3.createTree` command available from explorer flows.

## 2. Goals

- Remove the inspector quick action that creates a new tree file.
- Keep sidebar and embedded inspector toolbars aligned with each other.
- Leave the underlying `behavior3.createTree` command intact for other entry points.

## 3. Non-Goals

- Remove `behavior3.createTree` from explorer menus or the command palette.
- Change build, create-project, toggle-editor, or toggle-JSON behavior.
- Redesign the rest of the inspector toolbar grouping.

## 4. Current Behavior

- Sidebar inspector `view/title` includes `behavior3.createTree`.
- Embedded inspector header includes `behavior3.createTree`.
- Baseline specs currently describe create-tree as part of the inspector quick-action set.

## 5. Proposed Behavior

- Sidebar inspector `view/title` no longer contributes `behavior3.createTree`.
- Embedded inspector header no longer renders a `behavior3.createTree` button.
- Remaining quick actions stay aligned across the two inspector surfaces:
  - `behavior3.build`
  - `behavior3.toggleEditorMode`
  - `behavior3.toggleInspectorNodeJson`
  - `behavior3.createProject`

## 6. Design

- Remove the `view/title` contribution for `behavior3.createTree`.
- Remove the corresponding embedded action entry from `EMBEDDED_INSPECTOR_ACTIONS`.
- Update baseline inspector specs so the quick-action set reflects the new toolbar contents.

## 7. Implementation Plan

1. Add the work-item spec and update affected baseline docs.
2. Remove the create-tree action from sidebar and embedded inspector surfaces.
3. Run typecheck and inspect the resulting action lists.

## 8. Testing Plan

- Run `npm run check`.
- Inspect `package.json` view-title contributions.
- Inspect the embedded inspector action list in code.

## 9. Acceptance Criteria

- The inspector sidebar title no longer shows the create-tree action.
- The embedded inspector header no longer shows the create-tree action.
- The `behavior3.createTree` command still exists for non-inspector entry points.
- `npm run check` succeeds.

## 10. Risks and Rollback

- Risk: sidebar and embedded actions could drift if only one surface is changed. Mitigation: update both in the same change.
- Rollback: re-add the removed action contributions; no persistence or protocol behavior is affected.
