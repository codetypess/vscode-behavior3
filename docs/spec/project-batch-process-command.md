# Project Batch Process Command

Status: Done
Date: 2026-05-07
Scope: Add extension-host commands that let users choose or directly run a TypeScript or JavaScript batch script against every behavior tree source file in one project

## 1. Context

The repository already has a `buildScript` runtime that can load ESM JavaScript and runtime-transpiled TypeScript build hooks, including local TypeScript imports with explicit extensions.

That runtime is currently tied to project build output:

- the script path comes from `.b3-workspace`
- hooks run against build-time tree data
- results are written into a separate output directory

This is not sufficient for one-off source migrations or large tree refactors where the user wants to:

- choose a temporary script file from VS Code
- run it once against the current project
- rewrite the source behavior tree files in place

## 2. Goals

- Add a user-invokable VS Code command for project-wide batch processing.
- Add a direct "run this script" entry for batch scripts in the explorer menu.
- Let the command pick a `.ts`, `.mts`, `.js`, or `.mjs` script file at runtime.
- Reuse the existing runtime module loader so TypeScript scripts can import local TypeScript helpers.
- Process persisted source tree files, not build-expanded output trees.
- Avoid partial source-file rewrites when the batch run fails validation or throws.

## 3. Non-Goals

- No new webview-to-host protocol for batch processing in this change.
- No requirement to persist the selected script path into `.b3-workspace`.
- No new batch-script hook surface beyond the existing build-hook class shape.
- No change to build output semantics or `behavior3-build` CLI behavior.

## 4. Current Behavior

- `behavior3.build` and `behavior3.buildDebug` run project builds through `.b3-workspace`.
- `settings.buildScript` can mutate build output trees through `onProcessTree` and `onProcessNode`.
- Build walks every project tree file, but it materializes build-time tree data and writes to an output directory.
- There is no extension command for in-place source-tree batch rewriting.

## 5. Proposed Behavior

- Add a new extension command named `behavior3.batchProcess`.
- Add a second command named `behavior3.runBatchProcessScript`.
- The command resolves the current project from the selected resource, active tree file, or workspace folder.
- The command opens a file picker for the batch script, defaulting to the current workspace or the last selected script path.
- The direct-run command skips the picker and uses the selected script file immediately.
- The batch runtime reuses the existing hook loader and supports the same class entry rules as build scripts.
- The command walks every project behavior tree source file under the resolved `.b3-workspace` directory.
- Each file is parsed as a persisted source tree, processed by the selected script, validated, and staged in memory first.
- If any file fails script execution or validation, the run aborts without rewriting source tree files.
- On success, staged tree files are written back to their original paths and the output channel reports a summary.

## 6. Design

### 6.1 Script Runtime

The batch command should reuse:

- `loadRuntimeModule`
- the current build-hook class discovery rules
- TypeScript runtime transpilation with import rewriting
- workspace `checkScripts` loading for validation parity

The selected script replaces `settings.buildScript` for this command only.

For direct-run entry points, the selected explorer resource becomes both:

- the script path to execute
- the initial path used to resolve the nearest `.b3-workspace` project

### 6.2 Source Tree Semantics

The batch command must process persisted source trees from disk rather than build-expanded trees. This preserves:

- subtree link nodes
- source-file-local overrides
- source tree names and file identities

The existing build pipeline cannot be reused directly for writeback because build materialization expands subtree references for export.

### 6.3 Write Safety

The command should prevent common write hazards in two ways:

1. Refuse to run when matching tree editors are dirty.
2. Stage all rewritten tree content before any source tree file is overwritten.

This change only guarantees all-or-nothing behavior for the tree source files the command writes. Script-defined side effects outside those files remain the script author's responsibility.

### 6.4 Validation

After transformation, each candidate tree should still pass the same core validation used by offline builds:

- var-decl refresh
- node data validation against node definitions
- node arg checker diagnostics from the selected script and workspace `checkScripts`

Invalid transformed files should be reported and withheld from disk writes.

## 7. Implementation Plan

1. Add a work-item spec and baseline updates for the new command boundary.
Exit criteria: spec describes command scope, safety, and runtime reuse.

2. Add a shared source-tree batch processor.
Exit criteria: shared code can load the selected script, scan the project, validate staged trees, and report counts.

3. Add the VS Code command contributions and extension-host runners.
Exit criteria: users can invoke the picker-based command or direct-run a selected script and see success or failure summaries.

4. Add regression tests for TypeScript-import scripts and failure-abort behavior.
Exit criteria: shared tests prove TS imports work and invalid rewrites do not partially write source trees.

## 8. Testing Plan

- Extend `test/shared-suite.ts` with source-tree batch processor coverage.
- Run `npm run check`.
- Run `npm run test:shared`.
- Manually verify the command contribution and script picker behavior in VS Code if needed.

## 9. Acceptance Criteria

- A contributed `behavior3.batchProcess` command exists and is invokable from VS Code.
- A contributed `behavior3.runBatchProcessScript` command exists for supported script files.
- The command can select a `.ts` batch script that imports local `.ts` helpers with explicit extensions.
- The direct-run command can invoke the same runtime without opening the script picker.
- Running the command processes every project behavior tree source file under the resolved `.b3-workspace` directory.
- If any processed file fails validation or script execution, no source tree file is rewritten in that run.
- A successful run reports how many tree files were scanned, written, skipped, or left unchanged.

## 10. Risks and Rollback

- Risk: users may expect build-expanded subtree traversal semantics.
Mitigation: process persisted source trees only and document that the command rewrites source files, not build output.

- Risk: dirty open editors could conflict with external rewrites.
Mitigation: refuse to run while matching tree editors are dirty.

- Risk: scripts with side effects outside tree file writes cannot be fully rolled back.
Mitigation: keep the guaranteed atomicity boundary limited to staged tree source-file rewrites and report failures clearly.
