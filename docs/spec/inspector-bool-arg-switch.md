# Inspector Bool Arg Switch

Status: Done
Date: 2026-05-08
Scope: Node Inspector bool/bool? arg control rendering and submission

## 1. Context

Node Inspector currently renders required `bool` args with an Ant Design `Switch`, but renders optional `bool?` args with a three-value `Select` (`unset` / `true` / `false`).

The current behavior makes business bool args such as `stop_move` and `skip_cd` appear as dropdowns even though they are semantically switches. The reported node definition uses:

- `type: "bool?"`
- `default: false`
- no `options`

Root cause:

- `NodeArgField` has a dedicated optional-bool branch that returns `Select`.
- `formatArgInitialValue()` maps missing optional bools to `"__unset__"`, which was designed for the old dropdown control.

## 2. Goals

- Render all scalar bool args (`bool` and `bool?`) as `Switch`.
- Treat missing optional bool values as `false` in the Inspector form so the switch has a real boolean value.
- Preserve explicit `true` and `false` submission.
- Keep non-bool option args using `Select`.

## 3. Non-Goals

- Do not change node definition schema.
- Do not add bool `options` support; project usage does not configure options for bool values.
- Do not change array, string, numeric, JSON, or expression arg controls.

## 4. Current Behavior

- `bool` renders as `Switch`.
- `bool?` renders as `Select`.
- Missing `bool?` initial value becomes `"__unset__"`.
- Submitting `"__unset__"` omits the arg from persisted node data.

## 5. Proposed Behavior

- `bool` and `bool?` both render as `Switch`.
- Missing `bool?` initial value becomes `false`.
- Submitting a bool switch always yields a boolean value.
- `hasArgOptions(arg)` no longer preempts bool rendering.

## 6. Design

- In `NodeArgField`, check `isBoolType(type)` before the generic `hasArgOptions(arg)` branch.
- Remove the optional-bool `Select` branch.
- Update `formatArgInitialValue()` so optional bools use `false` instead of `"__unset__"`.
- Keep `parseArgSubmitValue()` tolerant of `"__unset__"` for backward-compatible helper behavior, but normal Switch flow should submit booleans.

## 7. Implementation Plan

1. Add this work-item spec and update Inspector baseline behavior.
   Exit Criteria: desired bool control rule is documented.
2. Update Inspector bool arg rendering.
   Exit Criteria: `bool?` args render with `Switch`.
3. Update arg value helper tests.
   Exit Criteria: missing optional bool initializes to `false`, and explicit booleans serialize as booleans.
4. Run checks.
   Exit Criteria: `npm run check` and `npm run test:shared` pass.

## 8. Testing Plan

- Update shared helper tests for optional bool initial values.
- Run `npm run test:shared`.
- Run `npm run check`.
- Manual check: open a node with `bool?` args such as `stop_move` / `skip_cd`; the Inspector displays switches instead of dropdowns.

Verification completed:

- `npm run check`
- `npm run test:shared`

## 9. Acceptance Criteria

- `bool?` node args without options render as switches.
- `bool` node args continue to render as switches.
- Non-bool args with options continue to render as selects.
- A missing optional bool initializes to off/`false` in the Inspector.
- Submitting the switch writes `true` or `false`, not `"__unset__"`.

## 10. Risks and Rollback

Risk:

- Optional bools lose the old explicit unset state in the Inspector UI.

Mitigation:

- This matches the project rule that bool values are not configured with options and are expected to behave as two-state switches.

Rollback:

- Restore the optional-bool `Select` branch and revert the helper test expectation.
