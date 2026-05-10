# Tree Editor Session Service Split

Status: Approved
Date: 2026-05-10
Scope: extension-host session helper extraction and host lifecycle clarity

## 1. Context

`tree-editor-webview-session.ts` is still the largest host-side file. It owns lifecycle, message routing, document snapshots, subtree file IO, project index refresh, version blocking, and node checker runtime creation.

## 2. Goals

- Extract cohesive host helpers without changing message flow or persisted behavior.
- Keep `resolveTreeEditorSession()` as the lifecycle orchestrator.
- Reduce local helper density in the session body.
- Make host-side services easier to test or reason about in isolation.

## 3. Non-Goals

- Do not change host-first authority.
- Do not split into classes unless a plain helper is insufficient.
- Do not change watcher timing or save/reload semantics.

## 4. Current Behavior

- Session helper functions are nested inside `resolveTreeEditorSession()`.
- Node checker runtime setup and subtree save helpers are coupled to the session closure.
- Version helper logic is duplicated between provider and session.

## 5. Proposed Behavior

- Extract node checker runtime creation/validation mapping.
- Extract subtree save/read guard helpers where possible.
- Reuse shared session version/language helper functions from provider code.
- Keep closure-dependent lifecycle orchestration in the session.

## 6. Design

- New helpers live under `src/editor-session/`.
- Helpers receive explicit dependencies such as workspace folder, document URI, project root, nodeDefs, and write/read functions.
- Session remains the only owner of watcher registration and message dispatch.

## 7. Implementation Plan

1. Reuse file-version/settings helpers in `TreeEditorProvider`.
2. Extract node-check runtime helpers.
3. Extract small subtree save guard helpers if the dependency surface stays small.
4. Verify checks and tests.

## 8. Testing Plan

- Existing checker/build tests must continue passing.
- Existing host-first and subtree save tests must continue passing.
- Run `npm run check` and `npm run test:shared`.

## 9. Acceptance Criteria

- Provider no longer duplicates tree version/language helpers.
- Session delegates node-check runtime construction to a focused helper module.
- Public host message behavior is unchanged.

## 10. Risks and Rollback

Risk: helper extraction can accidentally lose access to session-local state.
Mitigation: pass dependencies explicitly and keep message handlers in the session.

Rollback: inline the helper module back into the session.
