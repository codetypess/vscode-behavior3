# Selection Reassert Reveals Inspector

Status: Done
Date: 2026-05-10
Scope: host selection authority, inspector sidebar reveal, repeated tree/node selection gestures

## 1. Context

The inspector sidebar is revealed when the active editor session updates the coordinator with a newer `selectionRevision`.

Current host selection handling only increments that revision when the normalized shared selection actually changes. If the user clicks the already-selected node or tree again after switching to another panel, the host treats that gesture as a no-op. The selection stays correct, but the inspector sidebar is not reactivated.

## 2. Goals

- Let repeated selection gestures on the same tree or node reactivate the inspector sidebar.
- Keep shared selection authority unchanged when the selected logical target is unchanged.
- Avoid broad protocol changes or editor-local authority regressions.

## 3. Non-Goals

- Do not introduce optimistic webview-owned selection state.
- Do not change subtree open relay or node reveal semantics.
- Do not make every internal selection reuse bump the sidebar reveal signal.

## 4. Current Behavior

- `selectTree` and `selectNode` intents reach the host session.
- The host normalizes the target and compares it against current `sharedSelection`.
- Equal selections short-circuit without incrementing `selectionRevision`.
- The coordinator therefore does not call `revealInspectorView()` for repeated same-target clicks.

## 5. Proposed Behavior

- Repeated editor selection gestures for the current tree or node reassert the current shared selection.
- A reassert does not change `sharedSelection`, but it does increment `selectionRevision`.
- The host does not rebroadcast a new document snapshot for reassert-only gestures; it only refreshes the inspector session snapshot so the coordinator can reveal the sidebar.

## 6. Design

- Extract a pure helper for host-side shared selection updates with two outcomes:
  - real change
  - reassert same selection
- Use reassert mode only for explicit `selectTree` / `selectNode` messages coming from editor gestures.
- Internal selection updates from reducer commits or other host flows keep the old "change-only" behavior.

## 7. Implementation Plan

1. Add the pure shared-selection reassert helper.
2. Wire editor `selectTree` / `selectNode` handlers to use reassert mode.
3. Update inspector/editor semantics docs.
4. Add focused regression tests.

## 8. Testing Plan

- Add a pure unit test for the selection helper proving same-target reassert bumps revision without changing selection.
- Keep existing controller selection-intent tests green.
- Run `npm run check`.
- Run `npm run test:shared`.

## 9. Acceptance Criteria

- Clicking the already-selected node after leaving the inspector can reactivate the inspector sidebar.
- Clicking the already-selected tree after leaving the inspector can reactivate the tree inspector.
- Shared selection authority remains the same object shape and still only changes through host normalization.
- Checks and shared tests pass.

## 10. Risks and Rollback

Risk: if reassert logic is applied too broadly, background host flows could over-reveal the inspector.

Mitigation: scope reassert mode to explicit editor selection intents only.

Rollback: remove reassert handling and revert to change-only revision bumps.
