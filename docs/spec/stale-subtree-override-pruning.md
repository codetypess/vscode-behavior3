# Stale Subtree Override Pruning

Status: Done
Date: 2026-05-10
Scope: main-document override reachability, host mutation normalization, save serialization

## 1. Context

`PersistedTreeModel.overrides` stores sparse edits for subtree-internal nodes keyed by `sourceStableId`.

Current reducer behavior only cleans one override entry when the user edits that exact subtree node back to its original value. It does not sweep stale entries when a main-tree mutation removes or replaces the subtree link that used to materialize those source nodes.

That leaves dead override entries in the main document even though no reachable subtree instance can consume them.

## 2. Goals

- Remove override entries whose source node is no longer reachable from the current subtree graph.
- Keep this cleanup on the host side so persisted document content stays canonical.
- Preserve overrides when reachability cannot be proven because a reachable subtree file is missing or invalid.

## 3. Non-Goals

- Do not redesign override key semantics.
- Do not change subtree materialization precedence.
- Do not drop overrides merely because a reachable subtree file currently fails to load.

## 4. Current Behavior

- Editing a subtree-internal node computes a diff and deletes that single override entry when the diff becomes empty.
- Deleting a subtree link, replacing a branch, or changing a node `path` can orphan older override entries.
- Main-document save currently rewrites display ids and legacy subtree normalization, but does not prune stale overrides.

## 5. Proposed Behavior

- Compute the set of reachable subtree source node stable ids from the current main tree plus loaded reachable subtree sources.
- When that reachable subtree graph is complete, delete any override entries whose keys are not in the reachable set.
- Run the cleanup:
  - during main-document save normalization
  - after host mutations that can change reachable subtree links or replace/delete subtree-containing branches

## 6. Design

- Add a shared helper that walks reachable subtree source trees from `subtreeSources` and prunes stale override keys.
- The helper returns whether pruning was possible; if any reachable subtree source is missing or invalid, the helper leaves overrides untouched.
- Host mutation routing decides when a mutation can affect subtree reachability, then loads current subtree sources and runs the prune helper before serializing back into the document.

## 7. Implementation Plan

1. Add the shared reachability/prune helper.
2. Use it in main-document save normalization.
3. Use it in host mutation handling for path/delete/replace/paste cases that can change subtree reachability.
4. Add regression tests.

## 8. Testing Plan

- Add a save-serialization test proving stale overrides are dropped when no reachable subtree uses them.
- Add a host-reducer-adjacent test path proving mutations that remove a subtree branch also clear the orphaned overrides after host-side normalization.
- Run `npm run check`.

## 9. Acceptance Criteria

- Saving a document with orphaned subtree override entries writes content without those entries.
- Deleting or replacing a subtree-linked branch does not leave unreachable override keys in host-owned document content when reachable subtree sources can be resolved.
- Reachable overrides remain intact.
- No overrides are pruned when reachable subtree loading is incomplete.

## 10. Risks and Rollback

Risk: over-pruning could drop valid user edits if reachability is computed from incomplete subtree source data.

Mitigation: only prune when every reachable subtree source needed for the walk resolves successfully.

Rollback: remove the prune helper wiring and keep the current per-entry diff cleanup only.
