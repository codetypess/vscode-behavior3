# Deterministic Stable ID Regression

Status: Done
Date: 2026-05-27
Scope: shared tree parsing / legacy stable id generation / save writeback regression

## 1. Context

Legacy tree files can omit `uuid` fields. The editor normalizes those files in memory and writes the
normalized stable ids back on save. A regression in deterministic id generation currently produces
strings containing the literal text `undefined`, which then gets persisted into the saved document.

## 2. Goals

- Ensure deterministic stable ids generated for legacy tree files only use the configured id alphabet.
- Prevent save writeback from persisting malformed ids like `undefined...`.
- Add regression coverage for both generic legacy content and the sample legacy vars tree fixture.

## 3. Non-Goals

- Redesign the stable id format or length.
- Change how existing explicit `uuid` fields are preserved.
- Expand this work into broader save-pipeline refactors.

## 4. Current Behavior

- `parsePersistedTreeContent()` passes a stable-id seed for legacy files missing `uuid`.
- `generateDeterministicUuid()` mixes the seed through bitwise operations.
- After the xor step, the intermediate state can become a signed negative integer.
- Negative modulo results index outside the stable-id alphabet and stringify as `undefined`, so save
  writeback persists malformed ids.

## 5. Proposed Behavior

- Deterministic stable-id generation re-normalizes the mixed integer state to an unsigned 32-bit
  value before indexing into the alphabet.
- Legacy files missing `uuid` continue to receive deterministic ids derived from file path and node
  position, but those ids are always valid 10-character ASCII strings.

## 6. Design

- Keep the existing hash and alphabet logic.
- Fix the root cause locally by converting the post-xor state back to unsigned with `>>> 0`.
- Add shared tests that assert deterministic ids match the expected alphabet and never contain the
  literal text `undefined`.

## 7. Implementation Plan

1. Patch deterministic stable-id generation.
   Exit criteria: the generator returns valid alphabet-only ids for legacy inputs.
2. Add regression tests for generic legacy content and the sample vars fixture.
   Exit criteria: shared tests fail before the fix and pass after it.

## 8. Testing Plan

- Extend shared validation/materialization tests for deterministic stable-id format checks.
- Add a regression test covering `sample/vars/test.json`.
- Run `npm run test:shared`.

## 9. Acceptance Criteria

- Parsing a legacy tree file without explicit `uuid` fields yields deterministic ids matching
  `^[0-9A-Za-z]{10}$`.
- Parsing the same file twice yields the same generated ids.
- Saving a normalized legacy file does not persist `uuid` values containing `undefined`.

## 10. Risks and Rollback

- Risk: tightening format assertions could reveal other legacy fixtures relying on malformed ids.
  Mitigation: scope the change to the signed/unsigned conversion and verify against shared tests.
- Rollback: revert the generator fix and the new regression assertions.
