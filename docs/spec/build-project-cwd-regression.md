# Build Project Cwd Regression

Status: Done
Date: 2026-06-01
Scope: extension-host build cwd

## 1. Context

`Ctrl+B` / `behavior3.build` resolves the behavior-tree project from the active tree file and already computes a project `workdir` from the resolved `*.b3-workspace` directory. That `workdir` is passed into the shared build context, but the host process current working directory is not switched before build hooks run.

Build scripts that rely on `process.cwd()`, relative Node.js filesystem access, or child-process defaults therefore observe the VS Code workspace folder or extension-host cwd instead of the behavior-tree project directory.

On macOS, the first cwd fix also exposed a second issue: temp roots like `/var/...` are symlinked to `/private/var/...`, so `process.cwd()` reports the canonical filesystem path after `chdir()` while the build context still held the lexical discovery path. That broke the guarantee that build hooks see the same directory through both surfaces.

## 2. Goals

- Make behavior-tree builds run with `process.cwd()` set to the resolved project directory.
- Keep the build context `workdir` and process cwd aligned during build execution.
- Restore the previous cwd after the build completes or fails.

## 3. Non-Goals

- Changing subtree path resolution rules.
- Changing batch-process cwd semantics unless required by the build entry point in this work item.
- Adding new build settings for custom cwd overrides.

## 4. Current Behavior

- `runBuild()` resolves the active project from the tree file and workspace metadata.
- `buildBehaviorProject()` derives `paths.workdir` from the resolved `*.b3-workspace` directory.
- The shared build runtime receives that `workdir`, but Node `process.cwd()` remains at the surrounding extension-host or debug-session cwd.
- The debug launcher currently uses the VS Code workspace folder as its launch cwd, which also differs from the resolved behavior-tree project directory when the project is nested.

## 5. Proposed Behavior

- `behavior3.build` and `behavior3.buildDebug` should execute their build pipeline with process cwd set to the resolved project directory.
- Build hooks should observe the same canonical filesystem directory through both `ctx.env.workdir` and `process.cwd()`.
- After the build finishes, the previous cwd must be restored even when the build throws.

## 6. Design

- Treat the resolved `paths.workdir` from `buildBehaviorProject()` as the single source of truth for build cwd.
- Canonicalize discovered existing project paths (`*.b3-workspace`, `*.b3-setting`, and the derived workdir) before they enter the build context or debug launch config so symlinked parents do not diverge from `process.cwd()`.
- Wrap the shared build execution in a `try/finally` helper that temporarily calls `process.chdir(paths.workdir)` and restores the previous cwd afterward.
- Update the debug launch config to start the CLI from the same project directory so the debug path matches the non-debug path from process start onward.
- Add a shared build-cli regression test that asserts build scripts observe `process.cwd()` equal to the project directory.

## 7. Implementation Plan

1. Add this work-item spec and update the baseline editor semantics spec.
   Exit criteria: the intended build cwd behavior is documented.
2. Update build execution to switch process cwd to the resolved project directory and restore it afterward.
   Exit criteria: normal build and debug build both use the project directory.
3. Add a regression test covering `process.cwd()` inside a build script.
   Exit criteria: the test fails before the fix and passes after it.

## 8. Testing Plan

- Add a shared build-cli test that runs a build script and records `process.cwd()` into build output.
- Run `npm run check`.
- Run `npm run test:shared`.

## 9. Acceptance Criteria

- Running the build pipeline from a tree nested under a workspace folder exposes the resolved `*.b3-workspace` directory through `process.cwd()` inside the build script.
- On platforms with symlinked temp or workspace roots, `process.cwd()` and build context `workdir` still agree on the same canonical filesystem path.
- The previous process cwd is restored after build completion or failure.
- `behavior3.buildDebug` starts the CLI with the same project cwd used by the normal build path.
- `npm run check` succeeds.
- `npm run test:shared` succeeds.

## 10. Risks and Rollback

- `process.chdir()` is process-global, so builds must remain single-flight and must restore cwd in `finally`.
- If any unexpected side effect appears, rollback is limited to removing the cwd wrapper and debug config cwd change while keeping the spec history.
