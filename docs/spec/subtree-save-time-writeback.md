# Subtree Save-Time Writeback

Status: Done
Date: 2026-05-08
Scope: Defer legacy subtree normalization writes from graph loading to explicit main-tree save flows

## 1. Context

Opening a main tree can recursively load reachable subtree files. Legacy subtree files may be parsed into the current persisted model by adding stable ids or migrating old root-level fields. The current runtime writes those normalized subtree files during subtree cache synchronization, so a read-oriented action such as opening a main tree or rebuilding the graph can mutate files on disk.

Root cause: `syncReachableSubtreeSources()` passes an `onTreeLoaded` callback to `loadSubtreeSourceCache()` and immediately calls `hostAdapter.saveSubtree()` when `needsWriteback` is true.

## 2. Goals

- Make subtree normalization writes happen at an explicit, user-understandable time.
- Keep opening, reload, graph rebuild, and subtree cache refresh read-only with respect to subtree files.
- Flush legacy subtree normalization when the user saves the main tree.
- Ensure independent parents that reference the same legacy subtree produce the same migrated `uuid` values.
- Preserve current main-document save behavior, including display id writeback for main-tree nodes.

## 3. Non-Goals

- Do not redesign subtree materialization, override semantics, or identity generation.
- Do not add a new host/webview protocol message.
- Do not make subtree writeback transactional across multiple files.
- Do not change explicit `saveSubtree` or `saveSelectedAsSubtree` behavior.

## 4. Current Behavior

- Opening or reloading a main tree loads reachable subtree sources in the webview.
- If a loaded subtree needs stable-id migration, the webview immediately sends `saveSubtree`.
- The write is not tied to `saveDocument`, so users can see subtree files change just by opening a parent tree.

## 5. Proposed Behavior

- Subtree cache loading remains recursive and still parses legacy subtree files into current in-memory models.
- Subtree cache loading does not write any subtree file.
- Missing legacy `uuid` values are generated deterministically from the tree file path and node location so repeated parses of the same file converge.
- Main-tree save builds a save plan that includes:
  - normalized main document content
  - any reachable subtree files that need normalization writeback
- The extension host flushes those subtree writebacks as part of the main-tree save flow.
- Save As follows the same explicit main-tree save rule.

## 6. Design

- Keep `loadSubtreeSourceCache()` as the shared recursive loader and keep its `needsWriteback` signal.
- Remove immediate `saveSubtree` from the webview runtime subtree-cache sync path.
- Generate deterministic stable ids when parsing legacy tree files that do not already carry `uuid` or `$id`.
- Add a main-document save preparation helper that returns both saved main content and pending subtree writebacks.
- Resolve writeback paths in the extension host using the project root, then write them through the existing normalized disk write helper.
- If subtree writeback is blocked by newer-file protection or write failure, surface the save error instead of failing silently.

## 7. Implementation Plan

1. Add a work-item spec and update affected baseline specs.
2. Make webview subtree cache synchronization read-only.
3. Make legacy missing-`uuid` migration deterministic for the same file path.
4. Extend main-document save preparation to collect pending subtree writebacks.
5. Flush pending subtree writebacks from `TreeEditorProvider` save and save-as flows.
6. Add shared tests for deterministic legacy ids and save-time writeback planning.
7. Run the repo checks that cover shared behavior and TypeScript contracts.

## 8. Testing Plan

- Add a shared test proving legacy subtree content produces a pending writeback only from the main-document save preparation path.
- Add a shared test proving the same legacy tree file path gets the same generated ids across parses.
- Keep existing subtree materialization tests passing.
- Run `npm test`.
- Run `npm run check` if local dependencies and environment allow it.

## 9. Acceptance Criteria

- Opening or rebuilding a main tree with a legacy reachable subtree no longer sends `saveSubtree` from subtree cache loading.
- Saving the main tree collects and writes normalized content for reachable legacy subtree files.
- Two parents that independently reference the same legacy subtree converge on the same migrated `uuid` values for that subtree.
- Main-document save still writes normalized main content with main-tree display ids.
- Newer-version file protection still prevents writing protected subtree targets.

## 10. Risks and Rollback

Risk: save-time subtree writeback can touch multiple files and is not transactional.
Mitigation: keep writeback limited to reachable legacy subtrees and surface errors.

Risk: removing eager writeback may leave legacy subtree files on disk until the next main save.
Mitigation: in-memory parsing still upgrades the graph projection, so editing and display continue to work.

Rollback: restore the webview runtime `saveSubtree` callback during `syncReachableSubtreeSources()` and remove the save-plan writeback collection.
