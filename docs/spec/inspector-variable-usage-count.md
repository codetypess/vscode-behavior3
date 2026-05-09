# Inspector Variable Usage Count

Status: Done
Date: 2026-05-09
Scope: Tree Inspector variable usage badges

## 1. Context

Tree Inspector variable rows show a usage badge for local variables, imported declarations, and reachable subtree declarations.

Today that badge is computed by traversing only `document.root` inside the webview. This misses any variable references that live inside materialized subtree content, even though the same Inspector view already shows subtree declaration rows resolved from those external files.

## 2. Goals

- Make Tree Inspector variable usage badges reflect the current resolved graph, not just the main persisted root.
- Count usages consistently for local, import, and subtree declaration rows.
- Keep the implementation inside existing webview/runtime boundaries when possible.

## 3. Non-Goals

- Changing variable declaration resolution or import ordering.
- Changing variable focus relay semantics.
- Adding new host protocol fields if existing runtime state is sufficient.

## 4. Current Behavior

- Local variable rows only see usages from the main document's persisted root.
- Variables that are only referenced inside reachable subtree files show `0`.
- Reusing the same subtree file multiple times does not contribute multiple badge hits because those materialized instances are not part of the current count source.

## 5. Proposed Behavior

- Build Tree Inspector variable usage counts from the current resolved graph semantics:
  - main persisted tree
  - reachable subtree sources already loaded into runtime state
  - current `nodeDefs`
  - current `subtreeEditable` setting
- Count:
  - input slot references
  - output slot references
  - expression-variable references from expression args
- Materialized subtree instances each contribute to the total count, matching what the user can currently highlight in the active editor.

## 6. Design

- Reuse the webview-side subtree source cache instead of extending the host protocol.
- Resolve the graph with the same subtree expansion rules used by the main editor runtime.
- Keep the variable counting helper pure so shared tests can cover subtree-only and repeated-subtree cases.

## 7. Implementation Plan

1. Add this work-item spec and sync the Inspector baseline rule.
2. Move Tree Inspector variable counting to a resolved-graph-based helper.
3. Update Tree Inspector state wiring to use the resolved graph count source.
4. Add regression tests for subtree-only usage and repeated subtree instances.

## 8. Testing Plan

- Add shared-suite coverage for variable usage counts coming from materialized subtree content.
- Add shared-suite coverage showing repeated subtree references contribute repeated counts.
- Run the relevant automated test command after implementation.

## 9. Acceptance Criteria

- A variable referenced only inside a reachable subtree no longer shows `0` in Tree Inspector.
- Reusing the same subtree multiple times increases the displayed usage count for variables used inside that subtree.
- Expression-variable references inside subtree nodes contribute to the same badge totals as input/output slots.
- The fix does not require any new `HostToEditorMessage` or `EditorToHostMessage` fields.

## 10. Risks and Rollback

- Risk: recomputing resolved-graph-based counts inside Inspector could add avoidable work on every render.
- Mitigation: keep the computation memoized on document, subtree sources, node defs, and subtree editability.
- Rollback: revert the Inspector count source to the old persisted-root traversal if a regression appears, accepting subtree counts returning to `0`.
