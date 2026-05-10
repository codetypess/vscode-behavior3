# Runtime Feature Selector Boundary

Status: Done
Date: 2026-05-10
Scope: app runtime store hooks and feature-owned selectors

## 1. Context

`webview/app/runtime.tsx` owns runtime creation and basic store hooks. It also exports Inspector and Graph feature selector hooks, which makes the app layer know feature-specific projection details.

## 2. Goals

- Keep app runtime focused on provider, base store hooks, adapters, and app shell state.
- Move Inspector and Graph selector hooks into their feature modules.
- Preserve hook names at call sites where practical through local imports.

## 3. Non-Goals

- Do not change store shapes.
- Do not change runtime creation or context behavior.
- Do not change app shell state hooks.

## 4. Current Behavior

- `useInspectorPaneState`, `useNodeInspectorState`, `useTreeInspectorState`, and `useGraphPaneState` are exported from `app/runtime.tsx`.
- Feature code imports selector hooks from the app layer.

## 5. Proposed Behavior

- Feature selectors live near the feature code that consumes them.
- `app/runtime.tsx` exports only runtime, webview kind, base store hooks, and app shell/theme state.

## 6. Design

- Add feature-local selector modules where needed.
- Reuse base store hooks from runtime.
- Keep cached Inspector node snapshot behavior in Inspector-owned selectors.

## 7. Implementation Plan

1. Move Inspector selectors into `features/inspector`.
2. Move Graph pane selector into `features/graph`.
3. Update imports.
4. Verify.

## 8. Testing Plan

- Type check is the main verification.
- Existing selector-dependent tests must pass.

## 9. Acceptance Criteria

- `app/runtime.tsx` no longer imports Inspector feature cache code.
- Inspector and Graph components import feature selectors from their own feature directories.
- Runtime provider behavior is unchanged.

## 10. Risks and Rollback

Risk: circular imports can appear if feature selector modules import runtime and are imported back by runtime.
Mitigation: remove feature imports from runtime entirely.

Rollback: move selectors back into runtime.
