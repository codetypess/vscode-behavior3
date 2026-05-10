# Shared Adjacent Utils Consolidation

Status: Done
Date: 2026-05-10
Scope: Merge small adjacent helper modules in `webview/shared` where the dependency boundary stays clear.

## 1. Context

After flattening `webview/shared` and removing the `b3util.ts` facade, a few small modules still split one concept across multiple files:

- `node-definition-utils.ts` and `node-arg-utils.ts` both operate on `NodeDef` / `NodeArg` metadata.
- `theme-mode.ts` and `webview-kind.ts` both detect or apply webview browser environment state.

Other similarly named files should remain split when merging would introduce heavier dependencies or mix different output semantics.

## 2. Goals

- Merge node definition and node argument helpers into `node-utils.ts`.
- Merge theme mode and webview kind helpers into `webview-env.ts`.
- Update source, tests, and specs to use the new module names.
- Keep runtime behavior unchanged.

## 3. Non-Goals

- Do not merge `i18n.ts` with `antd-locale.ts`; that would make common i18n imports pull Ant Design locale dependencies.
- Do not merge `json5-display.ts` with `stringify.ts`; display formatting and persisted serialization have different semantics.
- Do not merge `graph-contracts.ts` into `contracts.ts`; `GraphAdapter.mount` uses DOM `HTMLElement`, while `contracts.ts` is also compiled by extension-host code without DOM lib types.
- Do not merge tree persistence helpers with build-only or schema modules.
- Do not change host/webview protocol shapes.

## 4. Current Behavior

Callers choose between adjacent helper files even when one module would express the boundary better. This keeps file count higher and makes import choices noisier.

## 5. Proposed Behavior

`webview/shared/node-utils.ts` owns pure node metadata helpers:

- `createNodeDefMap`
- `deriveGroupDefs`
- `findNodeDef`
- `parseSlotDefinition`
- `getNodeArgRawType`
- `isNodeArgArray`
- `isNodeArgOptional`
- `getNodeArgOptions`
- `checkOneof`

`webview-env.ts` owns browser webview environment helpers:

- `ThemeMode`
- `detectInitialThemeMode`
- `applyDocumentTheme`
- `WebviewKind`
- `normalizeWebviewKind`
- `detectWebviewKind`

## 6. Design

These are mechanical consolidations. The merged modules remain state-free or DOM-only as before, and no runtime behavior changes.

## 7. Implementation Plan

1. Rename `node-definition-utils.ts` to `node-utils.ts`, move node argument helpers into it, and delete `node-arg-utils.ts`.
2. Rename `theme-mode.ts` to `webview-env.ts`, move webview kind helpers into it, and delete `webview-kind.ts`.
3. Rewrite imports and spec references.
4. Run `npm run check` and `npm run test:shared`.

## 8. Testing Plan

- Run `npm run check`.
- Run `npm run test:shared`.
- Search source for old helper module names.

## 9. Acceptance Criteria

- `webview/shared/node-definition-utils.ts`, `webview/shared/node-arg-utils.ts`, `webview/shared/theme-mode.ts`, and `webview/shared/webview-kind.ts` no longer exist.
- No source import references the removed modules.
- `npm run check` succeeds.
- `npm run test:shared` succeeds.

## 10. Risks and Rollback

Risk: import rewrites can miss one call site.
Mitigation: TypeScript check and source search.

Rollback: split the merged modules back into the original files and restore imports.

## 11. Verification

- `npm run check`
- `npm run test:shared` (94 shared tests passed)
- Source search for `node-definition-utils`, `node-arg-utils`, `theme-mode`, and `webview-kind` has no matches outside this spec's historical references.
