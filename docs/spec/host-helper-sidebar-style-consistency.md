# Host Helper And Sidebar Style Consistency

Status: Done
Date: 2026-05-10
Scope: host helper duplication and Inspector sidebar stylesheet boundaries

## 1. Context

Some host helpers for tree file version and language selection are duplicated between provider and session modules. Inspector SCSS is already split from the old monolithic stylesheet, but sidebar-only rules still live inside `_inspector.scss`.

## 2. Goals

- Reuse shared host-side file version and language helper modules.
- Split sidebar-only Inspector stylesheet rules into a dedicated partial.
- Keep user-facing behavior and styles unchanged.

## 3. Non-Goals

- Do not change newer-file protection semantics.
- Do not redesign Inspector styling.
- Do not remove sidebar-specific overrides when still needed.

## 4. Current Behavior

- `TreeEditorProvider` locally implements `getTreeFileVersion`, `getEditorLanguage`, and newer-version edit message construction.
- `_inspector.scss` contains general Inspector styling and sidebar-specific selectors.

## 5. Proposed Behavior

- Provider imports `getTreeFileVersion`, `getNewerVersionMessage`, and `getEditorLanguage`.
- Sidebar-only selectors move to `_inspector-sidebar.scss`, imported after `_inspector.scss`.

## 6. Design

- Keep helper signatures stable and small.
- Preserve SCSS import order so cascade behavior stays the same.

## 7. Implementation Plan

1. Replace provider-local helper implementations with imports.
2. Add sidebar style partial and move sidebar-only rules.
3. Verify check/tests and formatting.

## 8. Testing Plan

- `npm run check`.
- `npm run test:shared`.
- `npm run format:check`.
- Manual visual risk is low because selectors and order are preserved.

## 9. Acceptance Criteria

- Provider does not duplicate file-version/language helper logic.
- Sidebar-specific Inspector selectors live in a sidebar partial.
- Build/type checks pass.

## 10. Risks and Rollback

Risk: SCSS order changes can alter sidebar layout.
Mitigation: import the sidebar partial immediately after `_inspector.scss`.

Rollback: move rules back into `_inspector.scss` and restore local provider helpers.
