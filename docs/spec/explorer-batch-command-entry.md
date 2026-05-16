# Explorer Batch Command Entry

Status: Done
Date: 2026-05-16
Scope: Explorer Behavior3 submenu batch-processing entry

## 1. Context

The explorer `Behavior3` submenu currently exposes two batch-processing-related commands with different entry shapes:

- a folder-scoped project command that asks the user to pick a batch script
- a script-file command that runs the selected script directly

That split makes the menu feel more complex than it needs to be. From the user's point of view, the desired action is “run a batch script against this project,” whether the script is already selected or still needs to be chosen.

## 2. Goals

- Use `Run Script as Batch Process` as the visible explorer entry for both folder and script contexts.
- Keep direct execution when the user invokes the command from an actual script file.
- Fall back to the existing script picker flow when the command is invoked from a folder or without a selected script file.

## 3. Non-Goals

- Change the underlying batch processing runtime or writeback semantics.
- Remove the internal project-level batch helper implementation if it is still useful as a shared command path.
- Add new protocol or webview command surfaces.

## 4. Current Behavior

- `behavior3.batchProcess` appears on folder explorer entries and opens a script picker.
- `behavior3.runBatchProcessScript` appears on `.ts/.mts/.js/.mjs` explorer entries and runs that file directly.
- The two commands share the same runtime after script resolution, but the menu makes them look like separate workflows.

## 5. Proposed Behavior

- The explorer folder submenu no longer shows the separate `behavior3.batchProcess` menu item.
- The explorer instead shows `behavior3.runBatchProcessScript` for both:
  - folders
  - supported script files
- When `behavior3.runBatchProcessScript` is invoked from:
  - a supported script file: run that script directly
  - a folder, non-script resource, or no explicit script selection: resolve the current project and open the existing batch script picker

## 6. Design

- Keep `runBatchProcess(...)` as the picker-backed project flow.
- Extend `runBatchProcessScript(...)` so it delegates to `runBatchProcess(...)` whenever there is no explicit supported script file to run.
- Rewire `package.json` explorer menu contributions so the folder entry uses `behavior3.runBatchProcessScript`.

## 7. Implementation Plan

1. Update specs for the unified explorer entry.
2. Adjust menu contributions and command fallback behavior.
3. Run typecheck and inspect the resulting explorer command mapping.

## 8. Testing Plan

- Run `npm run check`.
- Inspect `package.json` explorer menu contributions for folder and script contexts.
- Confirm `runBatchProcessScript(...)` still keeps the direct-file fast path and now reuses picker flow for folder launches.

## 9. Acceptance Criteria

- Folder explorer `Behavior3` submenus expose `Run Script as Batch Process` instead of the separate project batch-processing title.
- Script-file explorer `Behavior3` submenus still expose the same command and run the selected script directly.
- Invoking `behavior3.runBatchProcessScript` without a selected script file falls back to script picking for the current project context.
- `npm run check` succeeds.

## 10. Risks and Rollback

- Risk: the same command label now appears in multiple explorer contexts. Mitigation: keep the command semantics consistent around “select or use a script, then run batch processing.”
- Risk: fallback project resolution could change edge-case error messages. Mitigation: delegate to the existing picker-backed project flow instead of reimplementing it.
- Rollback: restore the previous folder menu contribution and direct-only `runBatchProcessScript(...)` behavior.
