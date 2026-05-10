# Shared Misc Flatten

Status: Done
Date: 2026-05-10
Scope: Flatten `webview/shared/misc` into `webview/shared` without behavior changes.

## 1. Context

`webview/shared/misc` contained legacy shared helpers and model files such as `b3type`, `b3util`, `b3build`, `logger`, `i18n`, and `stringify`. The directory name no longer communicated a useful boundary: these files were already part of the stable shared layer, and callers routinely imported them through `shared/misc/*`.

The current top-level `webview/shared` directory has no filename conflicts with the files in `misc`.

## 2. Goals

- Remove the `webview/shared/misc` directory.
- Move every file currently under `webview/shared/misc` to `webview/shared`.
- Update import paths, package file entries, and public type references.
- Keep module contents and runtime behavior unchanged.
- Keep then-current file names such as `b3util.ts` and `b3build.ts` while flattening paths.

## 3. Non-Goals

- Do not split or rewrite large helpers as part of this flattening step.
- Do not change public npm exports beyond correcting internal file paths.
- Do not introduce barrel files or new path aliases.
- Do not change validation, build, tree parsing, theme, i18n, or logger behavior.

## 4. Current Behavior

- Shared helpers are imported through paths like `../shared/misc/b3type`, `./misc/util`, and `../../webview/shared/misc/logger`.
- `package.json` includes `.d.ts` files under `webview/shared/misc/`.
- `build.d.ts` references build model and tree model types under `webview/shared/misc/`.

## 5. Proposed Behavior

Runtime behavior remains the same.

Implementation changes:

- `webview/shared/misc/<name>` becomes `webview/shared/<name>`.
- Call sites import `shared/<name>` directly.
- In moved files, imports that previously went to `../schema`, `../stable-id`, or media assets are adjusted for the new parent directory.
- Documentation references to the old path are updated where they describe current structure.

## 6. Design

This is a mechanical flattening, not a semantic refactor. Avoid barrel files because they obscure dependency direction and can create accidental cycles in the shared layer.

Files with legacy names remain as-is:

- `b3util.ts` remained the compatibility/state facade for this flattening step; follow-up work removes it.
- `b3build.ts` remains the build runtime helper.
- `b3type.ts` remains the model type surface; `b3model.d.ts` was removed by `shared-model-type-consolidation.md`.

## 7. Implementation Plan

1. Add this work-item spec.
2. `git mv webview/shared/misc/* webview/shared/`.
3. Rewrite import and package paths from `shared/misc/*` to `shared/*`.
4. Rewrite moved-file relative imports for the new directory depth.
5. Update baseline/spec references that describe current paths.
6. Run `npm run check` and `npm run test:shared`.

## 8. Testing Plan

- Run `npm run check`.
- Run `npm run test:shared`.
- Search for remaining `shared/misc` or `./misc/` references in source and current docs.

## 9. Acceptance Criteria

- `webview/shared/misc` no longer contains tracked files.
- No source import references `shared/misc/*` or `./misc/*`.
- `package.json` and `build.d.ts` reference the flattened paths.
- `npm run check` succeeds.
- `npm run test:shared` succeeds.

## 10. Risks and Rollback

Risk: a relative import inside a moved file can point one directory too high.
Mitigation: use TypeScript and shared tests to catch path errors.

Risk: public package file paths can drift.
Mitigation: update `package.json` and `build.d.ts` in the same change.

Rollback: move the files back under `webview/shared/misc` and restore import paths.

## 11. Verification

- `npm run check`
- `npm run test:shared`
