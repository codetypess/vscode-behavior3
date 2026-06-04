# Visible Expressions With Field Errors

Status: Implementing
Date: 2026-06-04
Scope: inspector field visibility / workspace settings / field diagnostics

## 1. Context

`visible` currently supports only injected hook names resolved from the check-script runtime.

Today the shared runtime in `webview/shared/b3build.ts` treats every non-empty `visible`
string as a lookup key in the visible-handler registry. That creates two gaps:

- inline expressions such as `args.type==4 || input[0] == "x"` are treated as unregistered
  hook names
- failures in the visibility path only log warnings or set request-level errors, but the
  Inspector renders field-level errors only from `nodeFieldDiagnostics`

The requested change is to allow inline visibility expressions implemented with
`new Function`, gated by `.b3-workspace.settings.allowNewFunction`, while making compile and
runtime failures show as errors on the corresponding field.

## 2. Goals

- Support `visible` as either a registered hook name or an inline expression.
- Add `.b3-workspace.settings.allowNewFunction` with default `false`.
- Evaluate inline visibility expressions only when `allowNewFunction` is enabled.
- Surface visibility failures on the corresponding arg/input/output field through the existing
  `nodeFieldDiagnostics` Inspector error path.
- Preserve current hidden-field cleanup semantics: only an explicit visible result of `false`
  hides the field.

## 3. Non-Goals

- Do not change persisted node JSON or node-def JSON shape.
- Do not add a new host request just for visibility diagnostics.
- Do not change `checker` semantics or turn `checker` into an expression feature.
- Do not hide fields on visibility failures; failures stay visible and become field errors.

## 4. Current Behavior

- `NodeDef.args[].visible` and structured slot `visible` metadata are preserved as strings.
- `resolveNodeFieldVisibility()` only resolves named visible handlers from the registered map.
- Missing visible handlers and visible runtime exceptions only emit logger warnings.
- Inspector args/input/output show field errors only when `validateNodeFields` returns
  `NodeFieldDiagnostic[]` entries that match the current field.
- `.b3-workspace` settings do not include an `allowNewFunction` capability flag.

## 5. Proposed Behavior

- A `visible` string matching `^\w+$` is always treated as a named visible hook.
- A non-empty `visible` string that already resolves from the visible-handler registry also stays on
  the named-hook path for backward compatibility.
- Other non-empty `visible` strings that contain expression syntax are treated as inline
  expressions.
- Inline expressions execute with the scope `{ args, input, output, value }`.
- Inline expressions compile and execute only when
  `.b3-workspace.settings.allowNewFunction === true`.
- The following cases must produce field diagnostics on the corresponding field:
    - named visible hook is not registered
    - inline expression is disabled because `allowNewFunction` is false
    - inline expression compilation fails
    - inline expression references `args`, `input`, or `output` outside the node-definition scope
        - inline expression execution throws
- In every failure case above, the field remains visible.
- Field diagnostics emitted from the visible runtime follow the active editor language setting.
- `resolveNodeFieldVisibilityResult.error` remains reserved for request-level failures rather than
  single-field failures.

## 6. Design

### 6.1 Workspace setting

Add `allowNewFunction?: boolean` to the workspace-model settings shape, normalize it into the
shared `Settings` DTO, and default it to `false` in the editor/webview runtime when absent.

The setting must flow through:

- `.b3-workspace` parsing
- extension-host live settings
- `init` and `settingLoaded` messages
- webview `WorkspaceState.settings`

### 6.2 Shared visibility runtime

Extract a shared field-visibility resolver for args/input/output.

- named visible hooks keep the existing registry lookup path
- inline expressions use `new Function("args", "input", "output", "value", ...)`
- compiled expressions are cached by source string

### 6.3 Diagnostics path

Visibility failures must enter the existing field-diagnostic channel instead of logger-only
warnings.

Implementation rule:

- extend the shared node-field diagnostics runtime so it can emit diagnostics for visibility
  failures in addition to checker failures
- keep the Inspector binding model unchanged so args/input/output continue reading from
  `nodeFieldDiagnostics`

If the current `NodeFieldDiagnostic.checker` naming is too checker-specific, widen the contract so
the diagnostic source can represent both checker and visible entries without losing field identity.

### 6.4 Refresh semantics

Changing `.b3-workspace.settings.allowNewFunction` must take effect without reopening the editor.

Existing `settingLoaded -> applyNodeDefs() -> rebuildGraph()` flow already refreshes:

- `nodeFieldDiagnostics`
- rendered graph error styling
- selected-node field visibility

The implementation must ensure those refreshes run against the latest workspace setting.

## 7. Implementation Plan

### Phase 1. Spec and contracts

- add this work-item spec
- update affected baseline specs in `13`, `16`, and `17`
- add `allowNewFunction` to shared settings contracts

Exit criteria:

- repository specs describe the new setting and field-error semantics
- shared settings types can carry `allowNewFunction`

### Phase 2. Workspace settings flow

- parse `allowNewFunction` from `.b3-workspace`
- flow it through host live settings, `init`, and `settingLoaded`
- default missing values to `false`

Exit criteria:

- current webview sessions receive `allowNewFunction` updates from workspace-file changes

### Phase 3. Shared visibility runtime and diagnostics

- support named-hook vs inline-expression classification without regressing existing non-identifier
  hook names
- add cached `new Function` compilation for inline expressions
- emit field diagnostics for visibility failures
- keep visibility fallback as visible on failure

Exit criteria:

- inline expressions can drive visible state when enabled
- visibility failures appear on the corresponding Inspector field

### Phase 4. Tests and examples

- add shared tests for workspace parsing, diagnostics, and runtime behavior
- optionally update the sample workspace to show how the setting is enabled

Exit criteria:

- regression coverage exists for disabled, successful, compile-failure, and runtime-failure paths

## 8. Testing Plan

Automated:

- workspace-model parsing tests for `allowNewFunction`
- shared runtime tests for named hooks and inline expressions
- shared runtime tests proving visibility failures produce field diagnostics
- host/protocol tests if diagnostic contracts or settings payloads widen

Manual:

- leave `allowNewFunction` unset and confirm the affected field stays visible but shows an error
- enable `allowNewFunction` and confirm the error disappears without reopening the editor
- use `args.type==4 || input[0] == "x"` to verify mixed arg/input visibility control

## 9. Acceptance Criteria

- `.b3-workspace.settings.allowNewFunction` is supported and defaults to `false` when omitted.
- `visible` strings matching `^\w+$` still resolve through the injected visible-hook registry, and
  previously supported non-identifier hook names continue to resolve when they are registered.
- `visible` expressions execute through `new Function` only when `allowNewFunction` is enabled.
- `visible` expressions only treat `args`, `input`, and `output` members defined by the current
  node definition as valid references; out-of-scope references become field errors.
- A disabled expression, compile failure, runtime failure, or missing named hook produces an error
  on the corresponding Inspector field.
- A visibility failure does not hide the field; the field remains visible until visibility resolves
  to explicit `false`.
- Updating `.b3-workspace` while the editor is open refreshes both field diagnostics and field
  visibility using the new setting value.

## 10. Risks and Rollback

- Risk: settings flow and node-check runtime diverge, causing webview and host to disagree on
  whether expressions are enabled.
  Mitigation: source the setting from the same normalized workspace model on both paths and cover
  it with shared tests.
- Risk: widening diagnostics contracts breaks Inspector field matching.
  Mitigation: keep field identity (`fieldKind`, `fieldName`, `fieldIndex`) unchanged and update
  tests around field binding.
- Rollback: remove inline expression execution, remove `allowNewFunction`, and keep the named-hook
  path unchanged.
