# Shared JSON Helper Consolidation

Status: Done
Date: 2026-05-10
Scope: Merge JSON value helpers in `webview/shared` into `json.ts`.

## 1. Context

`webview/shared` currently splits JSON-shaped value helpers across three files:

- `equality.ts` owns `isJsonEqual`.
- `json5-display.ts` owns compact JSON5 display stringification for graph/search/inspector UI.
- `stringify.ts` owns deterministic persisted JSON serialization.

The helpers have different output semantics, but they are all stateless JSON value operations and their split now adds import noise in host, domain, adapter, and command code.

## 2. Goals

- Merge the three helpers into `webview/shared/json.ts`.
- Preserve existing exported function names.
- Update all imports to use `json.ts`.
- Keep persisted serialization, JSON5 display strings, and JSON equality behavior unchanged.

## 3. Non-Goals

- Do not change persisted tree JSON formatting or key ordering.
- Do not change graph/search/inspector display text.
- Do not introduce a shared barrel file.
- Do not rewrite JSON equality semantics beyond moving the function.

## 4. Current Behavior

Callers import JSON helpers from three module names even when a single JSON helper surface would be clearer:

- `../shared/equality`
- `../shared/json5-display`
- `../shared/stringify`

## 5. Proposed Behavior

`webview/shared/json.ts` owns:

- `isJsonEqual`
- `stringifyCompactJson5`
- `stringifySearchValueAsJson5`
- deterministic JSON serialization types and helpers, including `stringifyJson`

Old modules are deleted and no compatibility facades are kept.

## 6. Design

This is a module ownership cleanup. The merged file is still state-free and does not depend on domain, features, adapters, or host modules.

The JSON5 dependency becomes part of the unified JSON helper module. This is acceptable because the current runtime already bundles the JSON5 display helper for webview code, and build verification must confirm the extension/webview bundles still compile.

## 7. Implementation Plan

1. Rename `stringify.ts` to `json.ts`.
2. Move `isJsonEqual` and JSON5 display helpers into `json.ts`.
3. Delete `equality.ts` and `json5-display.ts`.
4. Rewrite imports and specs.
5. Run `npm run check` and `npm run test:shared`.

## 8. Testing Plan

- Run `npm run check`.
- Run `npm run test:shared`.
- Search for removed module imports after editing.

## 9. Acceptance Criteria

- `webview/shared/equality.ts`, `webview/shared/json5-display.ts`, and `webview/shared/stringify.ts` no longer exist.
- `webview/shared/json.ts` exports all moved helpers.
- No source import references the removed module names.
- `npm run check` succeeds.
- `npm run test:shared` succeeds.

## 10. Risks and Rollback

Risk: import rewrites miss a host or webview call site.
Mitigation: source search and TypeScript check.

Risk: merging display and persisted serialization semantics makes future edits easier to conflate.
Mitigation: keep function names explicit and retain comments around persisted serializer behavior.

Rollback: split `json.ts` back into the three original files and restore imports.

## 11. Verification

- `npm run check`
- `npm run test:shared` (94 shared tests passed)
- `npm run build`
- Source search for removed module imports has no matches outside this spec's historical references.
