# Check Scripts Mixed Glob Regression

Status: Done
Date: 2026-05-29
Scope: shared checker runtime / workspace checkScripts loading / inspector validation noise

## 1. Context

Workspace `settings.checkScripts` are used by both project builds and inspector-side node argument
validation. In real projects it is easy to point that setting at a broader script folder such as
`scripts/**/*.ts`, which can legitimately contain build hooks, batch hooks, and checker hooks side by
side.

The current runtime treats every matched module that does not export an `@behavior3.check(...)`
class as a hard error. That means a workspace can still load valid checkers and surface correct node
diagnostics in Inspector, while the output channel repeatedly logs errors for unrelated build or
batch scripts and the node-check runtime reports a generic runtime-error banner.

## 2. Goals

- Stop reporting non-checker modules matched by `checkScripts` as runtime errors.
- Keep loading every actual `@behavior3.check(...)` registration from the matched module set.
- Preserve accurate node-level diagnostics when a node definition references an unregistered checker
  name.

## 3. Non-Goals

- Redesign workspace settings or introduce a new script-setting split.
- Change how build scripts or batch scripts are loaded in their own explicit flows.
- Silence real checker runtime failures such as duplicate registrations or invalid checker classes.

## 4. Current Behavior

- `resolveCheckScriptPaths()` expands every workspace `checkScripts` glob to matching TS/JS files.
- `createBuildScriptRuntimeWithCheckModules()` loads each matched module and marks it as an error if
  the module exports zero decorated checker classes.
- Inspector validation can still succeed for checker names that were registered by other matched
  modules, so users see correct field diagnostics together with unrelated output-channel errors.

## 5. Proposed Behavior

- `checkScripts` loading only registers decorated `@behavior3.check(...)` classes from each matched
  module.
- A matched module that exports no checker classes is ignored instead of being treated as a runtime
  failure.
- If a node definition references a checker name that no matched module registered, the existing
  node-level diagnostic `checker '<name>' is not registered` remains the user-facing feedback.

## 6. Design

- Keep `resolveCheckScriptPaths()` unchanged so file discovery semantics stay stable.
- Fix the root cause locally inside `createBuildScriptRuntimeWithCheckModules()` by skipping
  checker-less modules instead of logging `check script must export at least one ...`.
- Add shared regression coverage with a mixed script glob that matches a build script and a checker
  script in the same folder.

## 7. Implementation Plan

1. Update shared check-script runtime loading.
   Exit criteria: matched modules without checker exports no longer set `hasError`.
2. Add regression coverage for mixed script globs.
   Exit criteria: shared tests prove valid checkers still run and mixed folders do not create runtime
   errors.
3. Sync the lasting rule into the affected baseline spec.
   Exit criteria: baseline docs describe that `checkScripts` register checker hooks only.

## 8. Testing Plan

- Extend shared build/runtime tests with a mixed-folder `checkScripts` regression.
- Run `npm run test:shared`.

## 9. Acceptance Criteria

- When `checkScripts` matches both a build script and a checker script, the checker still loads and
  validates node arguments.
- The same mixed match does not produce a generic node-check runtime error solely because the build
  script has no `@behavior3.check(...)` export.
- A referenced checker name that is still absent from the matched set continues to surface as the
  existing node-level "checker is not registered" diagnostic.

## 10. Risks and Rollback

- Risk: silently ignoring checker-less modules could hide a misconfigured broad glob.
  Mitigation: missing checker registrations still surface at the node level, and real checker load /
  instantiation errors remain hard errors.
- Rollback: restore the previous `check script must export at least one ...` runtime error and
  remove the regression test.
