# Inspector Label Click Editing

Status: Done
Date: 2026-05-12
Scope: Inspector form label click behavior

## 1. Context

Inspector forms use Ant Design `Form.Item` labels for node and tree fields. Ant Design links labels to controls by default, so clicking label text focuses the associated input/control.

## 2. Goals

- Clicking an Inspector form label must not enter field editing or focus the field.
- Clicking the input/control itself must continue to focus and edit as before.
- Preserve existing Inspector layout, required marks, colon rendering, and switch behavior.

## 3. Non-Goals

- Do not redesign Inspector layout.
- Do not change commit timing or validation semantics.
- Do not change graph selection or variable-focus behavior.

## 4. Current Behavior

Clicking labels such as `节点说明` or an arg label focuses the related input and can enter edit mode even when the user intended to click only the label.

## 5. Proposed Behavior

Inspector labels are display-only text. They remain visually unchanged, but no label click forwards focus to the field. Fields still enter edit only from direct interaction with the input/control.

## 6. Design

Set `htmlFor: undefined` in the shared Inspector label prop helper so Ant Design does not emit label-to-control focus binding for ordinary Inspector labels. Keep the existing switch helper as a compatibility wrapper around the same shared behavior.

## 7. Implementation Plan

1. Update `createInspectorLabelProps` in the shared Inspector helper.
2. Keep existing form call sites unchanged so the behavior applies consistently.
3. Run the relevant checks.

## 8. Testing Plan

- Run type checking or the repository check script if available.
- Manually verify that clicking a label does not focus a field, while clicking the field still does.

## 9. Acceptance Criteria

- Inspector label clicks do not focus or edit the corresponding field.
- Direct clicks on inputs, selects, textareas, autocomplete fields, and switches still work.
- Existing Inspector styling remains unchanged.

## 10. Risks and Rollback

Risk is low because the change only removes generated label-control focus binding from shared Inspector label props. Rollback is restoring the previous helper output.
