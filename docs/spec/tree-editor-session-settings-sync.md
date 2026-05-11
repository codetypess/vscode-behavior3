# Tree Editor Session Settings Sync

Status: Done
Date: 2026-05-11
Scope: Extract settings refresh and settingLoaded fanout from `resolveTreeEditorSession`

## 1. Context

`resolveTreeEditorSession` still owns settings refresh logic directly. This logic re-resolves node definitions and setting directory when needed, resolves live VS Code settings, posts `settingLoaded`, and refreshes the Inspector/sidebar session snapshot.

The caller still needs to decide when settings refresh happens: explicit `requestSetting`, setting/workspace file watchers, and VS Code configuration changes.

## 2. Goals

- Move settings refresh implementation into a focused session-local module.
- Keep watcher registration and dispatcher routing in `tree-editor-webview-session.ts`.
- Preserve `settingLoaded` payloads and Inspector/sidebar synchronization behavior.
- Continue shrinking `resolveTreeEditorSession` without touching save/mutation/history handlers.

## 3. Non-Goals

- No user-facing behavior changes.
- No settings schema, nodeDefs, node color, language, Inspector mode, or theme behavior changes.
- No watcher registration changes.
- No protocol, persisted model, reducer, save/reload/history, selection, subtree tracking, or build/check semantic changes.

## 4. Current Behavior

`tree-editor-webview-session.ts` owns `refreshSettings`, which:

- optionally re-runs `resolveNodeDefs` and `getResolvedB3SettingDir`
- refreshes live editor settings through `resolveLiveSettings`
- posts `settingLoaded`
- calls Inspector session update fanout

## 5. Proposed Behavior

Runtime behavior remains unchanged. Internally, `src/editor-session/session-settings-sync.ts` exposes `createSessionSettingsSync(context, inspectorSync)` with:

- `refreshSettings(opts?: { refreshDefs?: boolean })`

`tree-editor-webview-session.ts` continues to call `refreshSettings` from watchers, configuration changes, and `requestSetting`.

## 6. Design

The settings sync module accepts `TreeEditorSessionContext` and `SessionInspectorSync`. It may update `state.nodeDefs`, `state.settingDir`, and `state.currentSettings`, and it may post `settingLoaded` through `context.postMessage`.

It must not register watchers, dispatch editor messages, enqueue document operations, or mutate document content.

## 7. Implementation Plan

1. Add `session-settings-sync.ts`.
2. Move `refreshSettings` implementation into the module.
3. Replace `tree-editor-webview-session.ts` local closure with the module method.
4. Update the architecture directory map.
5. Run `npm run check` and `npm run test:shared`.

## 8. Testing Plan

Automated checks:

- `npm run check`
- `npm run test:shared`

Manual smoke checks before release:

- Change Behavior3 configuration or setting/workspace files and confirm `settingLoaded` and Inspector/sidebar updates still occur.

## 9. Acceptance Criteria

- `tree-editor-webview-session.ts` no longer owns settings refresh implementation.
- Watcher registration and dispatcher routing remain in `tree-editor-webview-session.ts`.
- `npm run check` succeeds.
- `npm run test:shared` succeeds.
- No behavior changes to settings refresh, nodeDefs refresh, live settings, `settingLoaded`, Inspector sync, or document operation ordering.

## 10. Risks and Rollback

The main risk is changing setting refresh ordering or omitting Inspector sync after refresh. Mitigation is to preserve call order exactly and run checks.

Rollback is mechanical: inline `refreshSettings` back into `tree-editor-webview-session.ts` and remove `session-settings-sync.ts`.
