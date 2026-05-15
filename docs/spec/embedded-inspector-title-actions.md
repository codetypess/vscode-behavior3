# Embedded Inspector Title Actions

Status: Done
Date: 2026-05-15
Scope: Embedded inspector header quick actions

## 1. Context

The Behavior3 sidebar inspector already exposes quick actions for build, editor-mode toggle, raw JSON toggle, project creation, and tree-file creation through the VS Code view title. In embedded inspector mode, the same inspector content is rendered inside the custom editor webview, so that native view title is not visible. Users therefore lose access to the same shortcuts at the moment they switch to embedded mode.

## 2. Goals

- Expose the same quick actions inside the embedded inspector header.
- Reuse the existing extension-host commands and their validation semantics.
- Keep document mutations and save/build authority in the existing host/controller flow.

## 3. Non-Goals

- Change the behavior of the existing build, toggle-editor, toggle-JSON, create-project, or create-tree commands.
- Add duplicate document-editing logic inside the toolbar.
- Introduce a second editable inspector surface when inspector mode is `sidebar`.

## 4. Current Behavior

- `docs/spec/inspector-title-actions.md` defines sidebar-only title actions contributed through `menus.view/title`.
- `InspectorPane` renders the embedded inspector form content, but no header action row.
- The webview-to-host bridge has a dedicated `build` message, but no narrow command-forwarding path for the other existing extension commands.

## 5. Proposed Behavior

- When inspector mode is `embedded`, the inspector pane shows a compact header row labeled `BEHAVIOR3` followed by quick action buttons for:
    - `behavior3.build`
    - `behavior3.toggleEditorMode`
    - `behavior3.toggleInspectorNodeJson`
    - `behavior3.createProject`
    - `behavior3.createTree`
- The buttons dispatch existing extension-host commands. Command-level validation, prompts, and error messages remain authoritative.
- When inspector mode is `sidebar`, these controls remain absent from the webview because VS Code view-title actions already cover that surface.

## 6. Design

- Add an embedded-only inspector header component above the current pane body.
- Extend the webview host adapter with a narrow allowlisted host-command message rather than a general arbitrary-command executor.
- Handle the new message in the editor-session dispatcher by calling the corresponding existing VS Code command IDs.

## 7. Implementation Plan

1. Add the work-item-driven host message and allowlisted dispatcher handling.
2. Render an embedded-only inspector header row with icon buttons and tooltips.
3. Update the inspector baseline spec so embedded and sidebar command surfaces are both documented.
4. Run the narrow build/typecheck validation.

## 8. Testing Plan

- Run the workspace `build` task.
- Verify the embedded inspector header only appears in embedded mode.
- Verify each button maps to the existing extension command IDs.

## 9. Acceptance Criteria

- Embedded inspector mode shows the same five quick actions currently available from the sidebar inspector title.
- The embedded buttons reuse existing extension-host commands instead of duplicating their logic in the webview.
- Sidebar mode behavior and VS Code view-title actions remain unchanged.
- The workspace build succeeds.

## 10. Risks and Rollback

- Risk: toolbar density may feel cramped in narrow embedded widths. Mitigation: use compact icon buttons with overflow-safe layout.
- Risk: a generic command bridge would widen the protocol surface. Mitigation: keep the message payload allowlisted.
- Rollback: remove the embedded header component and the corresponding host-command forwarding path.
