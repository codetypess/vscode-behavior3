# Shared Document Helper Consolidation

Status: Done
Date: 2026-05-10
Scope: Merge document version helpers with shared document reducer ownership.

## 1. Context

`webview/shared/document-version.ts` only owns the document version constant and version comparison helpers. `webview/shared/document-mutation-reducer.ts` owns host-first persisted document mutation reduction.

Both belong to shared document semantics, but `b3type.ts` currently imports `DOCUMENT_VERSION` from `document-version.ts` to expose `VERSION` for persisted tree serialization and the public build type package. Directly moving `DOCUMENT_VERSION` into a large reducer module would make the package type surface depend on reducer internals.

## 2. Goals

- Delete `document-version.ts`.
- Rename `document-mutation-reducer.ts` to `document.ts`.
- Move version comparison helpers into `document.ts`.
- Keep `DOCUMENT_VERSION` / `VERSION` available from `b3type.ts` without importing the reducer module.
- Keep runtime behavior unchanged.

## 3. Non-Goals

- Do not change the document version string.
- Do not change reducer behavior, error shapes, or selection follow-up semantics.
- Do not make `b3type.ts` depend on reducer internals.
- Do not add compatibility facades for old module names.

## 4. Current Behavior

Callers import document helpers from two module names:

- `document-version.ts` for version comparison.
- `document-mutation-reducer.ts` for host-first document mutations.

`package.json` includes `document-version.ts` so packaged `b3type.ts` can resolve `VERSION`.

## 5. Proposed Behavior

`webview/shared/document.ts` owns document reducer exports and version comparison helpers:

- `compareDocumentVersion`
- `isDocumentVersionNewer`
- `DocumentMutationSelection`
- `DocumentMutationReducerError`
- `DocumentMutationReducerResult`
- `ReducibleDocumentMutation`
- `isReducibleDocumentMutation`
- `formatDocumentMutationReducerError`
- `reduceDocumentMutation`

`b3type.ts` directly exports `DOCUMENT_VERSION` and `VERSION`, keeping the public package type surface self-contained.

## 6. Design

This keeps document semantics discoverable under one `document.ts` module for runtime code while preserving the lighter `b3type.ts` package boundary. The version string has a single source of truth in `b3type.ts`; `document.ts` imports it to implement version comparison helpers.

Rejected alternative: make `document.ts` own `DOCUMENT_VERSION` and have `b3type.ts` re-export it. That would force package consumers resolving `b3type.ts` to also resolve the reducer module and its private dependencies.

## 7. Implementation Plan

1. Move `DOCUMENT_VERSION` into `b3type.ts` and keep `VERSION` as an alias export.
2. Rename `document-mutation-reducer.ts` to `document.ts`.
3. Move `compareDocumentVersion` and `isDocumentVersionNewer` into `document.ts`.
4. Update imports, package file list, and specs.
5. Run `npm run check`, `npm run test:shared`, and `npm run build`.

## 8. Testing Plan

- Run `npm run check`.
- Run `npm run test:shared`.
- Run `npm run build`.
- Search for removed module imports after editing.

## 9. Acceptance Criteria

- `webview/shared/document-version.ts` and `webview/shared/document-mutation-reducer.ts` no longer exist.
- `webview/shared/document.ts` exports reducer and version comparison helpers.
- `b3type.ts` still exports `DOCUMENT_VERSION` and `VERSION`.
- `package.json` no longer needs to include `document-version.ts`.
- No source import references the removed module names.
- `npm run check` succeeds.
- `npm run test:shared` succeeds.
- `npm run build` succeeds.

## 10. Risks and Rollback

Risk: moving the version constant can break package type resolution.
Mitigation: keep the constant in `b3type.ts`, which is already included in the package file list.

Risk: import rewrites miss a host or webview call site.
Mitigation: source search and TypeScript check.

Rollback: restore `document-version.ts`, rename `document.ts` back to `document-mutation-reducer.ts`, and restore imports/package files.

## 11. Verification

- `npm run check`
- `npm run test:shared` (94 shared tests passed)
- `npm run build`
- `npm run pack:npm`
- Source search for removed module imports has no matches outside this spec's historical references.
