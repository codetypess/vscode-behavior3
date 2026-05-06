# Focus Variable Relay Semantics

Status: Done
Date: 2026-05-07
Scope: Clarify and guard `focusVariable` as a transient sidebar-to-editor relay without changing the raw wire name.

## 1. Context

The previous selection ownership work split shared host-projected tree/node selection from editor-local graph UI state. The remaining ambiguous surface is `focusVariable`: runtime behavior already treats it as a transient relay, while the raw protocol name and some documentation still read like cross-webview state synchronization.

Today the sidebar inspector calls `HostAdapter.requestFocusVariable(names)`. The extension host relays that message only to the active editor, and the editor updates `graphUiStore.activeVariableNames` to drive local graph highlight/gray-out rendering.

## 2. Goals

- Define `focusVariable` as an instantaneous relay intent, not snapshot authority.
- Keep variable focus out of `init`, `documentSnapshotChanged`, `HostDocumentSnapshot`, and `HostSelectionState`.
- Ensure reload/reset cannot restore variable highlights from host state.
- Preserve the existing raw `focusVariable` wire name for this low-risk step.
- Add focused regression coverage for relay behavior, reload/reset cleanup, and host selection snapshot boundaries.

## 3. Non-Goals

- Rename the raw wire message to `requestFocusVariable` or `relayFocusVariable`.
- Add persisted variable focus to document JSON, history, save, reload, undo, or redo.
- Make the sidebar an authority for editor graph UI state.
- Change variable hotspot behavior inside the main editor canvas.

## 4. Current Behavior

- Sidebar variable clicks send raw `focusVariable` through the host adapter.
- `TreeEditorWebviewSession` forwards sidebar-originated `focusVariable` messages to the active editor and ignores editor-originated ones for relay.
- The editor handles `HostEvent.focusVariable` by running `controller.focusVariable(names)`.
- `controller.focusVariable(names)` writes only `graphUiStore.activeVariableNames` and reapplies graph visuals.
- `init.selection` and `documentSnapshotChanged.selection` contain only tree/node selection authority.

## 5. Proposed Behavior

`focusVariable` remains a raw message for compatibility, but its contract is:

- Editor -> host: request a one-shot relay to the active editor.
- Host -> editor: deliver a one-shot variable focus visual intent.
- The message is not a state snapshot and does not represent shared authority.
- The message is not stored in host session state, not serialized into document snapshots, and not replayed after reload, save, undo, redo, or webview reinitialization.
- Editor-local reset/reload paths may clear active variable focus; the host must not restore it unless a fresh relay message is sent.

## 6. Design

- `HostSelectionState` stays limited to `{ kind: "tree" }` and `{ kind: "node", ref }`.
- `HostDocumentSnapshot` stays limited to committed content, document session metadata, shared selection, and sync kind.
- `HostAdapter.requestFocusVariable(names)` is the normalized API name to make caller intent clearer than the raw wire name.
- `HostEvent.focusVariable` remains only an event envelope for a fresh relay.
- Baseline specs should call this out in host protocol and editor semantics docs so the durable rule is not hidden in tests.

## 7. Implementation Plan

### Phase 1. Specs and Types

- Add this work-item spec.
- Update `13-host-protocol.md` and `17-editor-semantics.md`.
- Tighten comments in `contracts.ts` and `message-protocol.ts`.

Exit criteria:

- The docs no longer describe `focusVariable` as cross-webview state sync.

### Phase 2. Regression Coverage

- Add or tighten shared tests for:
  - sidebar-originated variable focus relay into editor-local graph UI state
  - reload/reset cleanup preventing spontaneous variable highlight restore
  - host selection snapshots carrying tree/node selection only

Exit criteria:

- The tests encode the protocol boundary without requiring a wire rename.

## 8. Testing Plan

- Run `npm run test:shared`.
- Run `npm run check`.

Verified:

- `npm run test:shared` passed on 2026-05-07.
- `npm run check` passed on 2026-05-07.

## 9. Acceptance Criteria

- Baseline specs define `focusVariable` as transient relay, not snapshot authority.
- `HostInitPayload`, `HostDocumentSnapshot`, and `HostSelectionState` do not carry variable focus.
- Sidebar variable clicks still reach editor-local `graphUiStore.activeVariableNames`.
- Reload snapshots clear stale local variable focus and do not restore it from host snapshot data.
- Running `npm run test:shared` succeeds.
- Running `npm run check` succeeds.

## 10. Risks and Rollback

- Risk: preserving the raw `focusVariable` name may keep some ambiguity for future readers.
- Mitigation: comments and baseline specs explicitly label it as a relay and leave raw rename as a follow-up.
- Risk: overly broad reset behavior could clear variable focus on ordinary snapshot echoes.
- Mitigation: tests focus on reload/reset behavior while existing selection tests continue to cover ordinary snapshot convergence.
- Rollback: remove the added comments/tests and return to the previous docs; no wire or persistence migration is involved.
