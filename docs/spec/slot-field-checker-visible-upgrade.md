# Slot Field Checker Visible Upgrade

Status: Implemented
Date: 2026-05-30
Scope: shared checker runtime / host protocol / inspector slot semantics

## 1. Context

`behavior3` node definitions already allow `input` and `output` slots to use object entries with
`name`, `visible`, and `checker`, but the editor runtime still treats slots as plain `string[]` in
most internal helpers and UI flows.

Today:

- custom `@behavior3.check(...)` and `@behavior3.visible(...)` hooks only run for structured args
- Inspector input/output sections only apply built-in required/variable/oneof validation
- slot visibility is not resolved through the host runtime
- hidden slots are not auto-cleared from committed node data
- shared custom-script context types are arg-only and cannot describe input/output slots cleanly

This creates a split semantic model where node definitions advertise field-level hook metadata but
the editor only honors it for args.

## 2. Goals

- Make `input`, `output`, and `args` all participate in the same custom checker/visible model.
- Preserve persisted node data shape: `node.input` and `node.output` remain serialized as
  `string[]`.
- Make hidden `input`/`output` fields auto-clear committed values the same way hidden args do.
- Define variadic slot hook semantics explicitly: variadic slot values are passed as arrays.
- Replace arg-only custom-script context types with field-level types in a deliberate breaking API
  upgrade.

## 3. Non-Goals

- Do not change persisted tree JSON shape for `input` or `output`.
- Do not make `visible` affect build CLI export semantics; it remains Inspector-only display and
  cleanup behavior.
- Do not preserve the old arg-only type names as compatibility aliases.
- Do not introduce a second mutation path outside the existing host-first `updateNode` flow.

## 4. Current Behavior

### 4.1 Shared runtime

- `collectNodeArgCheckDiagnostics` only scans `nodeDef.args`.
- `resolveNodeArgVisibility` only scans `nodeDef.args`.
- custom script context types expose `arg` and `argName`, so slots have no first-class runtime
  representation.

### 4.2 Inspector

- structured args are filtered by host-side visible hooks
- hidden args are removed from structured form state and committed `data.args`
- input/output sections always render from slot definitions and only apply built-in validation
- input/output do not consume host custom diagnostics or host visibility state

### 4.3 Protocol and DTOs

- host request and store naming is arg-specific: `validateNodeChecks`,
  `resolveNodeArgVisibility`, `selectedNodeArgVisibility`, `NodeArgVisibilityTarget`
- custom diagnostics identify only `argName`

## 5. Proposed Behavior

### 5.1 Field-level custom hooks

The editor treats three node field kinds uniformly:

- `arg`
- `input`
- `output`

If a node definition field declares `checker`, the registered custom checker runs for that field.
If a node definition field declares `visible`, the registered visible hook runs for that field.

### 5.2 Slot value semantics

- non-variadic input/output slot values are passed to custom hooks as `string | undefined`
- variadic input/output slot values are passed to custom hooks as `string[]`
- structured args keep their existing parsed-value behavior

### 5.3 Hidden field cleanup

- if a visible hook returns `false` for an arg, the arg is removed from committed `data.args`
- if a visible hook returns `false` for a non-variadic input/output slot, the committed slot value
  at that index is cleared
- if a visible hook returns `false` for a variadic input/output slot, the committed tail starting
  from that slot index is cleared

### 5.4 Breaking custom-script API

The shared custom-script API moves from arg-specific context to field-level context.

Old arg-only names are removed from the public type surface rather than kept as aliases.
Custom checker/visible scripts must migrate to the new field-level context types.

## 6. Design

### 6.1 Internal slot normalization

Introduce a shared normalized slot-definition helper that accepts either:

- legacy string slot declarations
- object slot declarations with `name`, `checker`, and `visible`

The normalized slot shape must include:

- `fieldKind`
- `name`
- `label`
- `required`
- `variadic`
- `checker`
- `visible`
- `index`

String slot declarations remain valid and continue to derive required/variadic markers from the
existing `?` and `...` suffix syntax.

### 6.2 Public build-model API

Replace arg-only context types in the shared script API with field-level types.

Required public types:

- `NodeFieldKind = "arg" | "input" | "output"`
- `NodeFieldCheckContext`
- `NodeFieldVisibleContext`
- `NodeFieldChecker`
- `NodeFieldVisible`

Context requirements:

- shared fields: `node`, `tree`, `nodeDef`, `fieldKind`, `fieldName`, `fieldIndex`, `treePath`,
  `env`
- arg-only metadata: `arg` when `fieldKind === "arg"`
- slot-only metadata: normalized slot definition when `fieldKind === "input" | "output"`

Whether the implementation uses one context type or separate aliases for checker/visible is an
implementation detail, but the exported names must be field-level rather than arg-level.

### 6.3 Shared runtime and protocol naming

Arg-specific naming becomes field-specific across shared contracts and host requests.

Target naming:

- `validateNodeChecks` -> `validateNodeFields`
- `resolveNodeArgVisibility` -> `resolveNodeFieldVisibility`
- `selectedNodeArgVisibility` -> `selectedNodeFieldVisibility`
- `NodeArgVisibilityTarget` -> `NodeFieldVisibilityTarget`
- `NodeCheckDiagnostic.argName` -> field-level diagnostic identity

Diagnostics must identify at least:

- `fieldKind`
- `fieldName`
- `fieldIndex` for slot-based fields
- `checker`
- `message`

### 6.4 Inspector rendering and commit semantics

Inspector consumes one host-provided field-visibility structure that includes args, input, and
output. Structured args and slot sections both filter their rendered fields against that structure.

Hidden-field cleanup must still route through the existing host-first `updateNode` path. The webview
may compute scoped replacement arrays/objects locally, but committed authority stays in the host
reducer.

### 6.5 Build and validation semantics

- custom checkers run for fields during editor validation and build CLI validation
- visible hooks run only for Inspector field visibility and hidden-field cleanup
- build CLI does not drop input/output/args because of visible hooks

## 7. Implementation Plan

### Phase 1. Spec and public API rename

- add this work-item spec
- update shared build-model declarations to field-level exported types
- update checker scaffold/template and sample scripts to the new API

Exit criteria:

- public custom-script type names are field-level
- no shared declaration still presents arg-only context as the primary API

### Phase 2. Shared normalized slot helpers and runtime

- add normalized slot-definition helpers
- refactor shared validation/runtime code to iterate over args and slots through field-level helpers
- replace arg-specific diagnostics/visibility DTOs with field-level DTOs

Exit criteria:

- one shared runtime path can validate args, input, and output custom checkers
- one shared runtime path can resolve args, input, and output visibility

### Phase 3. Host protocol and webview controller

- rename host request/response types and adapter wiring to field-level names
- update workspace store projection names and controller refresh flow

Exit criteria:

- webview requests field-level diagnostics and field-level visibility through renamed protocol
- store state no longer uses arg-only visibility naming

### Phase 4. Inspector slot UI and cleanup

- apply host-side field visibility to input/output sections
- surface custom slot diagnostics in input/output form items
- auto-clear hidden slot values and commit the resulting node mutation

Exit criteria:

- hidden input/output values are removed from committed node data
- slot checker failures display on the corresponding Inspector fields

### Phase 5. Tests and baseline spec sync

- add or update shared tests for runtime, protocol, Inspector, and build validation
- update numbered baseline specs with the new lasting field-level rules

Exit criteria:

- automated coverage exists for input/output checker and visible behavior
- baseline docs describe field-level custom hook semantics rather than arg-only semantics

## 8. Testing Plan

Automated:

- shared runtime tests for custom checker registration and execution on input/output fields
- shared runtime tests for slot visible hook resolution, including missing hook warnings
- editor controller tests for field-level host request wiring and store updates
- Inspector tests for slot visibility filtering, hidden-slot cleanup, and slot diagnostic rendering
- build CLI tests showing slot checkers run during build validation while visible hooks do not alter
  exported tree data

Manual:

- open an old file with saved input/output values that are now hidden and confirm selecting the node
  clears the hidden slot values and marks the tab dirty
- verify a variadic slot checker receives the full tail array semantics
- save, reopen, and confirm cleared hidden slots stay removed

## 9. Acceptance Criteria

- A node definition can attach `checker` to an `input` slot and the custom checker result appears on
  the corresponding Inspector slot field.
- A node definition can attach `checker` to an `output` slot and the custom checker result is
  included in shared node diagnostics.
- A node definition can attach `visible` to an `input` or `output` slot and the Inspector hides that
  field when the hook returns `false`.
- When an input/output field becomes hidden, the committed node data is cleared using the same
  host-first mutation flow as arg cleanup.
- Variadic input/output slots pass `string[]` values to custom checker and visible hooks.
- Shared public custom-script declarations no longer expose arg-only primary context names.
- Build validation runs slot custom checkers, but build output is not rewritten by visible hooks.

## 10. Risks and Rollback

Risks:

- breaking external checker/visible scripts by removing arg-only public types
- widening shared protocol and DTO churn across host, webview, and tests
- subtle regressions in variadic slot indexing and oneof interactions

Mitigations:

- update scaffolded checker templates and sample scripts in the same change
- keep persisted node JSON shape unchanged
- add focused shared tests for slot indexing, hidden cleanup, and protocol mapping

Rollback:

- revert the field-level API rename and runtime changes together as one change set
- because persisted node JSON does not change shape, data rollback only requires code/spec rollback
