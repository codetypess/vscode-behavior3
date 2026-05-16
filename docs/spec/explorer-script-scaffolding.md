# Explorer Script Scaffolding

Status: Done
Date: 2026-05-16
Scope: Explorer Behavior3 submenu script creation commands

## 1. Context

The explorer `Behavior3` submenu currently lets users create a project, create a tree file, run batch processing, open JSON files with the custom editor, and run an existing batch script. However, build scripts, batch scripts, and checker scripts still have to be created manually by copying examples from `sample/scripts/` or writing the required decorator boilerplate from scratch.

This makes the first-run workflow slower and easy to get wrong, especially for `@behavior3.build` / `@behavior3.batch` / `@behavior3.check(...)` scaffolds where the exported class shape must match the runtime loader expectations.

## 2. Goals

- Add explorer submenu commands to create a build script, batch script, or checker script inside the selected folder.
- Reuse host-side command authority so file creation stays in the extension-host layer.
- Generate valid TypeScript starter files that the current runtime can load without extra boilerplate fixes.

## 3. Non-Goals

- Add a general template picker or support multiple output languages/extensions.
- Auto-edit workspace `settings.checkScripts` or build pipeline configuration after file creation.
- Change the behavior of existing build, batch-process, or open-with-editor commands.

## 4. Current Behavior

- Folder explorer entries under `Behavior3` expose `createProject`, `batchProcess`, and `createTree`.
- Script examples live under `sample/scripts/`, but there is no direct command to scaffold them into the user workspace.
- Existing runtime rules already distinguish:
  - build scripts via `@behavior3.build`
  - batch scripts via `@behavior3.batch` when launched through batch processing
  - checker scripts via `@behavior3.check("<name>")`

## 5. Proposed Behavior

- When the user opens the explorer context menu on a folder and enters the `Behavior3` submenu, they can choose:
  - `Create Build Script`
  - `Create Batch Script`
  - `Create Checker Script`
- Each command prompts for a file base name without extension, writes a `.ts` scaffold into the selected folder, and opens the new file in the text editor.
- Default base names are:
  - `build`
  - `batch`
  - `checker`
- Generated starter content is valid for the current runtime:
  - build scaffold exports one `@behavior3.build` class with no-op `onProcessTree` / `onProcessNode`
  - batch scaffold exports one `@behavior3.batch` class with no-op batch hooks plus `shouldUpgradeTree()`
  - checker scaffold exports one `@behavior3.check("<normalized-name>")` class with a small validation example

## 6. Design

- Add a small host-side scaffold module that owns:
  - per-command defaults
  - filename validation
  - class-name / checker-name normalization
  - template rendering
- Register three new extension commands in `package.json` and handle them in `src/extension.ts`.
- Limit the new explorer submenu entries to folder context so the target directory is explicit and matches the existing `createTree` / `createProject` mental model.

## 7. Implementation Plan

1. Add the work-item spec and baseline updates for the new command catalog entries.
2. Implement the scaffold helper and extension-host commands.
3. Add shared tests for template rendering and name normalization.
4. Run typecheck and shared tests, then mark the spec done.

## 8. Testing Plan

- Run `npm run check`.
- Run `npm run test:shared`.
- Manually inspect the generated template strings through shared tests for:
  - decorator presence
  - class naming
  - checker registration naming

## 9. Acceptance Criteria

- Folder explorer `Behavior3` menus expose create-build-script, create-batch-script, and create-checker-script actions.
- Each action creates a `.ts` scaffold in the selected folder and opens it.
- Generated files are valid starter shapes for the current build/check runtime.
- `npm run check` and `npm run test:shared` succeed.

## 10. Risks and Rollback

- Risk: generated checker names could be invalid or awkward for unusual filenames. Mitigation: normalize them separately from the filesystem name.
- Risk: command proliferation could clutter the explorer submenu. Mitigation: keep the commands folder-scoped and adjacent to existing project/tree creation entries.
- Rollback: remove the new command registrations and scaffold helper; no persisted protocol or document model changes are involved.
