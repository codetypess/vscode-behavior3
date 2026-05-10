# Shared Model Type Consolidation

Status: Done
Date: 2026-05-10
Scope: Merge `webview/shared/b3model.d.ts` into `webview/shared/b3type.ts`.

## 1. Context

`webview/shared/b3type.ts` is already the internal import surface for behavior tree model types, node definition helpers, and the document version alias. `webview/shared/b3model.d.ts` only stores the `NodeData`, `TreeData`, variable, import, and group interfaces, and current source code reaches them through `b3type.ts`.

The remaining direct `b3model` consumers are public declaration files:

- `build.d.ts`
- `webview/shared/b3build-model.d.ts`

That means the split no longer describes an internal ownership boundary. It mainly exists as a packaging artifact.

## 2. Goals

- Make `b3type.ts` the single internal owner for B3 tree/model types.
- Delete `b3model.d.ts`.
- Keep the npm `./build` type entry resolving after the deletion.
- Keep runtime behavior unchanged.

## 3. Non-Goals

- Do not rename persisted model type names such as `NodeData` or `TreeData`.
- Do not change tree JSON shape, build script API shape, or host/webview protocol payloads.
- Do not introduce a shared barrel file.
- Do not merge build runtime declaration types into runtime implementation modules.

## 4. Current Behavior

Internal code imports model types from `b3type.ts`, which re-exports them from `b3model.d.ts`. Public build declarations import `NodeData` and `TreeData` directly from `b3model.d.ts`.

## 5. Proposed Behavior

`b3type.ts` directly declares and exports:

- `NodeData`
- `VarDecl`
- `TreeVariables`
- `GroupDecl`
- `ImportDecl`
- `FileVarDecl`
- `TreeData`

Public declaration files import those model types from `b3type.ts`. The npm package file list includes `b3type.ts` and the local module it re-exports for `VERSION`, so `build.d.ts` remains type-resolvable without `b3model.d.ts`.

## 6. Design

This is a module ownership cleanup. `b3type.ts` already mixes public tree model types with node definition type helpers and state-free runtime predicates; moving the model interfaces into the file removes a pure forwarding dependency.

Rejected alternative: keep a new `b3type.d.ts` beside `b3type.ts`. That would preserve a package-only declaration file but duplicate the model interfaces, which is worse for maintenance.

Rejected alternative: keep `b3model.d.ts` as a public-only facade. The user explicitly allowed dropping compatibility facades, and the package's supported `./build` type entry can resolve through `b3type.ts` instead.

## 7. Implementation Plan

1. Move the model interfaces from `b3model.d.ts` into `b3type.ts`.
2. Update declaration imports to use `b3type.ts`.
3. Delete `b3model.d.ts` and remove it from `package.json`.
4. Add `b3type.ts` and `document-version.ts` to the package file list.
5. Run `npm run check`, `npm run test:shared`, and package type/file checks.

## 8. Testing Plan

- Run `npm run check`.
- Run `npm run test:shared`.
- Search for remaining `b3model` imports.
- Run `npm run pack:npm` to verify the packaged file list still contains the declaration dependencies.

## 9. Acceptance Criteria

- `webview/shared/b3model.d.ts` no longer exists.
- No source or declaration file imports `./b3model`.
- Internal model type imports continue to use `b3type.ts`.
- `build.d.ts` still exports `NodeData` and `TreeData`.
- `npm run check` succeeds.
- `npm run test:shared` succeeds.
- `npm run pack:npm` succeeds and includes the type files required by `build.d.ts`.

## 10. Risks and Rollback

Risk: published `build.d.ts` can reference a file not included in the npm tarball.
Mitigation: include `b3type.ts` and `document-version.ts` in `package.json` files and verify with `npm run pack:npm`.

Risk: consumers that imported the package-internal `webview/shared/b3model` path break.
Mitigation: that path is not the supported package export, and compatibility facades are no longer a constraint for this cleanup.

Rollback: restore `b3model.d.ts`, point declarations back to it, and restore the old package file list.

## 11. Verification

- `npm run check`
- `npm run test:shared` (94 shared tests passed)
- `npm run pack:npm`
- Source search for `./b3model` imports has no matches outside this historical spec text.
