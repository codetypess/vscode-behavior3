# Batch Decorator Split

Status: Done
Date: 2026-05-16
Scope: Shared build runtime public script decorators and type definitions

## 1. Context

The current shared script runtime uses `@behavior3.build` for both build scripts and batch-processing scripts. Public type definitions also model both flows through a single `BuildScript` type, even though batch processing has extra semantics such as `shouldUpgradeTree()` and is launched through a different command/runtime path.

This makes the public API blur two distinct concepts:

- project build scripts that generate exported build output
- batch scripts that rewrite persisted source trees in place

The recent explorer scaffolding work also exposed that ambiguity because the generated batch template still had to use the build decorator and build-centric type names.

## 2. Goals

- Introduce a dedicated `@behavior3.batch` decorator for batch-processing scripts.
- Split public build-vs-batch type definitions so templates and docs can express the intended API clearly.
- Keep build script loading, batch script loading, and checker loading behavior explicit in shared runtime code.

## 3. Non-Goals

- Change batch processing writeback semantics or build validation semantics.
- Redesign the script hook method names.
- Change the checker decorator API.

## 4. Current Behavior

- `BuildRuntime` exposes `build` and `check`, but no `batch`.
- Public `.d.ts` surfaces a single `BuildScript` type for both build and batch flows.
- Batch runtime hook detection reuses the same decorated-class marker and hook instance detection as build scripts.
- Batch scaffolds and sample batch scripts use `@behavior3.build`.

## 5. Proposed Behavior

- `behavior3` global decorators become:
  - `@behavior3.build`
  - `@behavior3.batch`
  - `@behavior3.check(...)`
- Public type definitions are split into:
  - `BuildScript`
  - `BatchScript`
  - `BuildHookClass`
  - `BatchHookClass`
  - `BuildDecorator`
  - `BatchDecorator`
- Build runtime resolves build hooks from build-specific exports/decorators.
- Batch runtime resolves batch hooks from batch-specific exports/decorators.
- New scaffolds and bundled sample batch scripts use `@behavior3.batch` and batch-specific types.

Compatibility decision:

- Existing build scripts continue using `@behavior3.build`.
- Batch runtime may continue accepting legacy `@behavior3.build`-decorated batch classes as a compatibility fallback, but `@behavior3.batch` becomes the canonical public API and all bundled examples/templates switch to it.

## 6. Design

- Add separate runtime markers for build hooks and batch hooks.
- Factor shared hook-shape helpers so build and batch instance validation can share overlapping method checks without sharing the same public type.
- Extend the global decorator bridge installed during runtime module loading to expose `behavior3.batch`.
- Keep `BuildRuntime` as the exported global runtime object type, but expand it with the new `batch` decorator.

## 7. Implementation Plan

1. Update the work-item spec and baseline specs for the split API.
2. Split the public script types and decorator types in `b3build-model.d.ts` and `build.d.ts`.
3. Update shared runtime marker/detection logic to distinguish build hooks from batch hooks.
4. Update scaffold generation, sample scripts, and tests to use `@behavior3.batch` for batch scripts.
5. Run typecheck and shared tests, then mark the spec done.

## 8. Testing Plan

- Run `npm run check`.
- Run `npm run test:shared`.
- Add or update tests that verify:
  - batch scaffolds generate `@behavior3.batch`
  - batch CLI processing accepts batch-decorated scripts
  - build runtime still accepts build-decorated scripts

## 9. Acceptance Criteria

- Public runtime typings expose a dedicated `batch` decorator and separate build/batch script types.
- Shared batch runtime recognizes `@behavior3.batch` batch scripts.
- Generated batch scaffolds and bundled sample batch scripts use `@behavior3.batch`.
- `npm run check` and `npm run test:shared` succeed.

## 10. Risks and Rollback

- Risk: existing user batch scripts using `@behavior3.build` could break. Mitigation: keep a temporary compatibility fallback in batch runtime.
- Risk: runtime detection changes could accidentally widen or narrow build-script acceptance. Mitigation: update build and batch tests together.
- Rollback: remove `@behavior3.batch`, restore the shared decorator marker path, and revert template/test updates.
