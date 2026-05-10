# Inspector Commit Service

Status: Approved
Date: 2026-05-10
Scope: Node Inspector commit/reset orchestration and field target consistency

## 1. Context

`node-inspector-form.tsx` has been split into smaller render components, but commit, reset, related arg/input validation targets, and payload construction still live inside the React component body.

## 2. Goals

- Move Node Inspector committers into a hook or command helper.
- Keep JSX focused on rendering fields and wiring callbacks.
- Centralize field target construction for args, inputs, and outputs.
- Preserve independent field commit behavior.

## 3. Non-Goals

- Do not redesign Inspector UI.
- Do not change commit timing or queue semantics.
- Do not change persisted node payload semantics.

## 4. Current Behavior

- `commitNodeMutation`, `queueNodeMutation`, `commitName`, `commitInputField`, `commitArgField`, and reset helpers are local to the component.
- Field targets mix strings and nested arrays in ad hoc arrays.

## 5. Proposed Behavior

- `useNodeInspectorCommitters()` owns commit/reset callbacks.
- The form component receives committers and renders sections.
- Field target types live in the commit helper module.

## 6. Design

- The hook accepts runtime, form, selection state, nodeDefs, nodeDef, override state, and read-only flags.
- Pure payload helpers remain in `inspector-form-values.ts`.
- The hook remains feature-local because it uses Ant Design form APIs and runtime controller methods.

## 7. Implementation Plan

1. Add the hook module and move commit/reset logic.
2. Update `NodeInspectorForm` to use hook return values.
3. Keep or add focused tests for pure payload helpers.
4. Verify.

## 8. Testing Plan

- Existing Inspector shared helper tests must pass.
- `npm run check` must catch hook/prop wiring errors.
- `npm run test:shared` must remain green.

## 9. Acceptance Criteria

- `node-inspector-form.tsx` no longer owns commit payload construction.
- Node arg/input oneof linked field commits still validate both fields.
- Override reset behavior remains unchanged.

## 10. Risks and Rollback

Risk: moving closures can capture stale selected node or form state.
Mitigation: keep hook called inside component and derive committers from current props each render.

Rollback: restore local commit helpers in the component.
