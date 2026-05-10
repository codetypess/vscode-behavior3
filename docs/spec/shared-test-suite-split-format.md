# Shared Test Suite Split And Format Scripts

Status: Done
Date: 2026-05-10
Scope: shared test organization and package script quality gates

## 1. Context

`test/shared-suite.ts` has broad and valuable coverage but is a single large file. `package.json` has `check` and `test:shared`, but no format check or lint-style quality gate.

## 2. Goals

- Split the shared tests into multiple focused files without changing test behavior.
- Keep a single `npm run test:shared` command.
- Add a format check script using the existing Prettier dependency.

## 3. Non-Goals

- Do not introduce a new test framework.
- Do not require network-installed lint dependencies.
- Do not rewrite test assertions beyond mechanical relocation.

## 4. Current Behavior

- `test/run-tests.js` bundles only `test/shared-suite.ts`.
- All shared tests live in one array in one file.
- Formatting is available as a dependency but not exposed in scripts.

## 5. Proposed Behavior

- Tests are registered through small suite modules.
- `shared-suite.ts` becomes the runner/aggregator.
- `package.json` exposes `format:check` and optionally `format`.

## 6. Design

- Add `test/shared-test-types.ts` for the test case shape.
- Add focused test files by area where practical.
- Keep global setup in `run-tests.js` unchanged unless multiple entry points are needed.

## 7. Implementation Plan

1. Add test case type and registration helper.
2. Move at least inspector/protocol-focused tests into separate files.
3. Update runner imports.
4. Add package scripts.
5. Verify.

## 8. Testing Plan

- Run `npm run test:shared`.
- Run `npm run check`.
- Run `npm run format:check`.

## 9. Acceptance Criteria

- `test/shared-suite.ts` is no longer the only file containing all shared tests.
- `npm run test:shared` still reports all tests passing.
- `package.json` exposes a format check script.

## 10. Risks and Rollback

Risk: bundling tests across modules can accidentally duplicate side effects.
Mitigation: keep one bundled entrypoint and only split test declarations.

Rollback: move tests back into `shared-suite.ts` and remove scripts.
