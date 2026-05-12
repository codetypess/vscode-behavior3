# Batch Processing Upgrade Input Trees

Status: Done
Date: 2026-05-12
Scope: Batch processing project source writeback

## 1. Context

Batch processing reads each persisted tree source file, parses it into the normalized in-memory model, runs the selected batch script, and writes transformed source files back in one staged operation.

The current change detector compares `writeTree(originalTree)` with `writeTree(processedTree)`. Since `originalTree` is already normalized by parsing, legacy-only input upgrades are invisible when the batch script returns the tree unchanged. Examples include legacy `$id` becoming `uuid`, `$override` becoming `overrides`, and top-level `import` / `vars` becoming `variables`.

## 2. Goals

- Let batch scripts declare upgrade intent with `shouldUpgradeTree()` so VS Code command runs can opt in without extra UI.
- Preserve existing batch behavior unless a script opts in.
- Keep batch scripts receiving normalized tree data.
- Preserve all-or-nothing staged writeback when scripts report errors or throw.

## 3. Non-Goals

- Do not change normal build output generation.
- Do not add VS Code UI for this option in this work item.
- Do not run built-in validation or workspace `settings.checkScripts` during batch processing.

## 4. Current Behavior

A no-op batch script over a legacy persisted tree does not write the upgraded canonical tree back to disk, because both the original and processed comparison inputs are serialized from normalized in-memory trees.

VS Code command batch scripts have no way to request canonical input-tree upgrade writeback independently from script-produced semantic rewrites.

## 5. Proposed Behavior

Batch scripts may implement `shouldUpgradeTree(path, tree)`.

When it is omitted or returns false, batch processing keeps the current behavior: a file is staged only when the processed normalized tree serializes differently from the original normalized tree.

When `shouldUpgradeTree(...)` returns true, batch processing also stages that file when the processed normalized tree serializes differently from the original raw disk content. This lets a no-op script upgrade legacy input trees into the current canonical persisted shape, including when the script is launched from VS Code project commands.

Files skipped by the script are not upgraded. Script-reported errors or thrown hook errors still fail the whole batch and abandon all staged writes, including upgrade-only writes.

## 6. Design

- `batchProcessProjectWithContext(...)` owns the source writeback decision because it already owns staged writes and summary counters.
- The default diff remains normalized-to-normalized so existing command behavior does not change.
- The opt-in diff compares the final serialized tree to the raw input file, so parser/serializer migrations and canonical formatting are written only when requested.
- Script-level `shouldUpgradeTree(path, tree)` is evaluated per processed file after script errors are known; returning true enables input-upgrade writeback for that file.
- `onWriteFile` receives upgrade-only staged writes the same way it receives script-produced rewrites.

## 7. Implementation Plan

1. Add optional `shouldUpgradeTree(path, tree): boolean` to the public build script types and batch hook detection.
2. Read the raw disk content before parsing each candidate tree.
3. Stage writes when either the normalized semantic diff changes, or `shouldUpgradeTree(...)` returns true and the final serialized content differs from raw disk content.
4. Add shared regression tests for default preservation, script-declared legacy upgrade writeback, and all-or-nothing error behavior.
5. Update the baseline specs and README hook list for runtime command behavior and editor command semantics.

## 8. Testing Plan

- Add a no-op batch test showing legacy input trees are not rewritten by default.
- Add a script-declared no-op batch test showing `shouldUpgradeTree()` rewrites legacy input trees into canonical persisted format.
- Add a script-declared error test showing script errors keep all legacy source files byte-for-byte unchanged.
- Run `npm run check`.
- Run `npm run test:shared`.

## 9. Acceptance Criteria

- Default batch processing does not rewrite a legacy file when the script makes no semantic edit.
- A batch script with `shouldUpgradeTree()` returning true rewrites a legacy file into canonical persisted format when launched through normal batch script execution.
- Upgrade-only writes are included in `stagedWriteFiles` and `writtenFiles`.
- Script errors still abandon all staged writes, including upgrade-only writes.
- Existing batch validation-skipping behavior remains unchanged.
- `npm run check` and `npm run test:shared` succeed.

## 10. Risks and Rollback

The opt-in mode can rewrite files solely because their raw JSON differs from canonical serialization. This is intentional for migrations, but scripts should return true only when source upgrades are desired.

Rollback is straightforward: remove the hook from public types and restore the previous normalized-to-normalized comparison in `batchProcessProjectWithContext(...)`.
