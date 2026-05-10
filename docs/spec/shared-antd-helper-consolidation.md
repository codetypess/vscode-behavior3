# Shared Antd Helper Consolidation

Status: Done
Date: 2026-05-10
Scope: Merge small Ant Design app helpers in `webview/shared`.

## 1. Context

`webview/shared/hooks.ts` and `webview/shared/antd-locale.ts` are both small Ant Design app integration helpers:

- `hooks.ts` owns the runtime store for Ant Design `message`, `notification`, and `modal` hooks.
- `antd-locale.ts` maps the app language into Ant Design locale objects.

They are webview-only helpers and have no host/domain dependency.

## 2. Goals

- Merge `hooks.ts` and `antd-locale.ts` into `webview/shared/antd.ts`.
- Preserve existing exported type/function names.
- Keep `theme.ts` separate because it owns larger VS Code theme token mapping logic.
- Keep runtime behavior unchanged.

## 3. Non-Goals

- Do not merge `theme.ts` into this change.
- Do not merge common i18n runtime into Ant Design helpers.
- Do not change app shell layout, locale selection, or hook binding timing.

## 4. Current Behavior

App/runtime code imports Ant Design glue from two shared modules:

- `../shared/hooks`
- `../shared/antd-locale`

## 5. Proposed Behavior

`webview/shared/antd.ts` owns:

- `AppHooks`
- `AppHooksStore`
- `createAppHooksStore`
- `getAntdLocale`

Old modules are deleted and no compatibility facades are kept.

## 6. Design

This is a mechanical module consolidation. `antd.ts` remains webview/UI-only and may import Ant Design runtime locale objects. `theme.ts` stays separate because its main responsibility is VS Code-to-AntD theme translation, not app shell glue.

## 7. Implementation Plan

1. Rename `hooks.ts` to `antd.ts`.
2. Move `getAntdLocale` into `antd.ts`.
3. Delete `antd-locale.ts`.
4. Rewrite imports and specs.
5. Run `npm run check` and `npm run test:shared`.

## 8. Testing Plan

- Run `npm run check`.
- Run `npm run test:shared`.
- Search for removed module imports after editing.

## 9. Acceptance Criteria

- `webview/shared/hooks.ts` and `webview/shared/antd-locale.ts` no longer exist.
- `webview/shared/antd.ts` exports the moved helpers.
- No source import references the removed module names.
- `npm run check` succeeds.
- `npm run test:shared` succeeds.

## 10. Risks and Rollback

Risk: import rewrites miss an app/runtime call site.
Mitigation: source search and TypeScript check.

Rollback: split `antd.ts` back into `hooks.ts` and `antd-locale.ts` and restore imports.

## 11. Verification

- `npm run check`
- `npm run test:shared` (94 shared tests passed)
- `npm run build`
- Source search for removed module imports has no matches outside this spec's historical references.
