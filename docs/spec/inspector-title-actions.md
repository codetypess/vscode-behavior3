# Inspector Title Actions

Status: Superseded
Date: 2026-05-12
Scope: Behavior3 inspector view title quick actions

## 1. Context

The Behavior3 inspector sidebar already mirrors the active editor context, but project-level actions such as build, editor-mode toggle, project creation, and tree-file creation are only exposed through editor title or explorer menus. The sidebar view title has unused action space that can surface the same commands closer to the inspector workflow.

## 2. Goals

- Show quick-action buttons in the Behavior3 inspector view title for build, toggle editor mode, create project, and create behavior tree file.
- Reuse existing extension commands and command semantics.
- Keep the inspector webview itself free of new document authority.

## 3. Non-Goals

- Add new webview-host protocol messages.
- Change build, create-project, create-tree, or toggle-editor behavior.
- Add custom in-webview toolbar controls for embedded inspector mode.

## 4. Current Behavior

- `behavior3.build` is available from the custom editor title.
- `behavior3.toggleEditorMode` remains available as a command and `F4` keybinding, but is not shown in the custom editor title.
- `behavior3.createProject` and `behavior3.createTree` are available from explorer context menus.
- The Behavior3 inspector view title does not expose these actions.

## 5. Proposed Behavior

The Behavior3 inspector view title contributes four navigation actions:

1. Build the active Behavior3 project.
2. Toggle the active `.json` file between the Behavior3 custom editor and text editor.
3. Create a Behavior3 project.
4. Create a new Behavior3 tree file.

All actions dispatch the existing extension commands. When no suitable active editor or workspace exists, the existing command-level validation and messages remain authoritative.

## 6. Design

- Use `package.json` `menus.view/title` contributions scoped with `view == behavior3.inspectorView`.
- Prefer command icons so title actions render as compact VS Code toolbar buttons.
- Do not introduce webview buttons or protocol messages; these actions are extension-host commands rather than document mutations.

## 7. Implementation Plan

1. Add view-title menu contributions for the four existing commands.
2. Add icons for create-project and create-tree commands so they render as recognizable toolbar buttons.
3. Update baseline specs to record the inspector title action rule.
4. Verify JSON validity and TypeScript build checks.

## 8. Testing Plan

- Run `npm run check`.
- Inspect the package contributions for valid command IDs, menu groups, and view scoping.

## 9. Acceptance Criteria

- The Behavior3 inspector view title exposes build, toggle editor mode, create project, and create behavior tree file actions.
- The actions use existing extension commands without new duplicate command implementations.
- `npm run check` succeeds.

## 10. Risks and Rollback

- Risk: too many actions may overflow into VS Code's secondary view menu on narrow sidebars. This is acceptable because VS Code manages title action overflow.
- Rollback: remove the `view/title` menu contributions and command icons; no persisted data or protocol state is affected.
