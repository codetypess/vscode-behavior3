# Baseline Spec Sync With Current Code

Status: Done
Date: 2026-05-06
Scope: Synchronize numbered baseline specs in `docs/spec/` with the current extension-host and webview implementation

## 1. Context

The numbered baseline specs under `docs/spec/` were originally written during the G6 migration and architecture reset. The repository has since accumulated concrete implementation details in the extension-host session, shared contracts, controller runtime, inspector sidebar sync, subtree cache loading, and node-check validation flows.

Several baseline documents now describe boundaries at the right level, but some specific rules, message names, state fields, and runtime behaviors no longer line up exactly with the code in `src/`, `webview/`, and `webview/shared/`.

## 2. Goals

- Re-sync the numbered baseline specs with the current implementation.
- Preserve the existing SDD structure while updating inaccurate or missing runtime details.
- Make the specs usable as a reliable baseline for future SDD work and reviews.

## 3. Non-Goals

- No product redesign or behavior changes.
- No protocol changes purely to match old docs.
- No broad code refactor during this documentation sync.

## 4. Current Behavior

- The webview runtime uses `documentStore`, `workspaceStore`, `selectionStore`, a G6-based `graphAdapter`, and a VS Code `hostAdapter`.
- The extension-host session serializes main-document save/revert/mutation flows, tracks transitive subtree references, and mirrors selection/content into the inspector sidebar session.
- The numbered specs still contain migration-era wording that does not always mention current message names, state fields, or runtime responsibilities.

## 5. Proposed Behavior

- Every numbered baseline spec reflects current code terminology and behavior.
- Cross-document terminology is consistent for:
  - `persistedTree`
  - `resolved graph`
  - `subtreeSources`
  - `overrides`
  - `documentUpdated` / `fileChanged` / `documentReloaded`
  - inspector sidebar proxy mutations
- `90-implementation-plan.md` is updated to describe the current implementation baseline rather than an outdated future-only migration plan.

## 6. Design

- Treat the current codebase as the source of truth.
- Update specs by stable concern area:
  - product scope and acceptance
  - runtime architecture and shared contracts
  - graph / inspector / editor semantics
- Prefer accurate baseline descriptions over speculative future design.

## 7. Implementation Plan

1. Create this work-item spec and register it in `docs/spec/README.md`.
2. Re-read the current shared contracts, controller runtime, host session, graph adapter, and inspector forms.
3. Rewrite numbered baseline specs to match current behavior and vocabulary.
4. Re-read the updated spec set for consistency and move this work item to `Done`.

## 8. Testing Plan

- Manual consistency pass across `docs/spec/*.md`.
- Verify referenced runtime names and message names against current code.
- Confirm `docs/spec/README.md` work-item index reflects the final status.

## 9. Acceptance Criteria

- `01-product-scope.md`, `02-acceptance-scenarios.md`, `10-architecture.md`, `11-document-model.md`, `12-runtime-and-commands.md`, `13-host-protocol.md`, `14-resolved-graph.md`, `15-graph-contract.md`, `16-inspector-contract.md`, `17-editor-semantics.md`, and `90-implementation-plan.md` all reflect current implementation terminology and behavior.
- No numbered baseline spec depends on message names, state fields, or architectural layers that no longer exist in code.
- `docs/spec/README.md` records this work item.

## 10. Risks and Rollback

- Risk: documentation drifts further if some sections are updated in isolation.
- Mitigation: update the full numbered baseline set in one change and perform a terminology pass at the end.
- Rollback: revert the documentation-only change if reviewers find mismatches, then re-apply with corrected wording.
