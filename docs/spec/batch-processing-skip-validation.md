# Batch Processing Skip Validation

Status: Done
Date: 2026-05-12
Scope: Batch processing project commands only

## 1. Context

Batch processing currently shares the normal build validation path after a batch script transforms each persisted tree. That means transformed source rewrites can be blocked by built-in node legality checks or workspace `settings.checkScripts`, even when the batch script is intended to be a mechanical migration over source files.

The desired behavior is for batch processing to be a source transformation flow. Validation remains a build/editor concern, while batch scripts decide whether their own processing should fail by pushing explicit errors or throwing.

## 2. Goals

- Run the selected batch script over persisted behavior tree source files.
- Skip built-in node legality validation during batch processing.
- Skip workspace `settings.checkScripts` resolution, loading, and execution during batch processing.
- Preserve all-or-nothing source writeback when a batch script reports an error or throws.
- Keep normal build validation unchanged.

## 3. Non-Goals

- Do not change normal build validation.
- Do not change the batch script hook API.
- Do not add a user setting or command flag for validation mode.
- Do not ignore errors explicitly reported by the batch script.

## 4. Current Behavior

`batchProcessProjectWithContext(...)` runs `processBatchTree(...)`, then refreshes variable declarations, runs `context.checkNodeData(...)`, runs node arg checkers from workspace `settings.checkScripts`, and aborts the staged writeback if any validation error is found.

## 5. Proposed Behavior

Batch processing loads and runs only the selected batch script. After `onProcessTree` / `onProcessNode` complete for a tree, the transformed tree is staged for write if the script did not return `null`, did not throw, and did not push any errors.

The batch path does not run built-in node legality validation and does not load workspace `settings.checkScripts`. A transformed tree that normal build would reject may still be written by batch processing. Normal builds continue to run those validations.

## 6. Design

- Keep `processBatchTree(...)`, staged writes, `onWriteFile`, and `onComplete` behavior intact.
- Construct the batch runtime with the selected script only.
- Remove batch-only check script setup and transformed-tree validation from `batchProcessProjectWithContext(...)`.
- Keep `buildProjectWithContext(...)` validation code unchanged.

## 7. Implementation Plan

1. Update `docs/spec/17-editor-semantics.md` to make the new batch behavior the baseline rule.
2. Edit `webview/shared/b3build.ts` so batch no longer resolves check scripts or validates transformed trees.
3. Update `test/shared-suite.ts` batch tests for invalid transformed trees, script-reported errors, and ignored workspace check scripts.
4. Run `npm run check` and `npm run test:shared`.

## 8. Testing Plan

- Rewrite the existing invalid-tree batch test to assert that a transformed tree with an unknown node is written successfully.
- Add or keep coverage that a batch script pushing to `errors` aborts all staged writes.
- Add coverage that workspace `settings.checkScripts` are ignored by batch processing.
- Rely on existing normal build checker tests to ensure build validation remains active.

## 9. Acceptance Criteria

- `npm run check` succeeds.
- `npm run test:shared` succeeds.
- Batch processing writes transformed trees even when transformed nodes would fail normal build validation.
- Batch processing is unaffected by missing or failing workspace `settings.checkScripts`.
- Batch processing still aborts all writes when the batch script itself reports errors.
- Normal build validation behavior is unchanged.

## 10. Risks and Rollback

The main risk is that batch processing can persist trees that normal builds reject. This is intentional for source migrations, but users should understand that validation is deferred to build/editor flows.

Rollback is straightforward: restore the validation/checkScripts setup in `batchProcessProjectWithContext(...)` and revert the associated spec/test changes.