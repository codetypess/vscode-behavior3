# Focus Variable Wire Rename

Status: Done
Date: 2026-05-07
Scope: Rename raw `focusVariable` protocol messages to request/relay names while preserving the transient local-only semantics.

## 1. Context

The previous work item clarified that variable focus is a transient relay into editor-local graph UI state and never becomes host snapshot authority. The remaining mismatch is only on the raw wire surface: both directions still use `focusVariable`, even though the editor-to-host leg is a request and the host-to-editor leg is a relay.

This ambiguity is now isolated enough to clean up without changing runtime ownership, controller semantics, or persistence behavior.

## 2. Goals

- Rename the editor-to-host raw message from `focusVariable` to `requestFocusVariable`.
- Rename the host-to-editor raw message from `focusVariable` to `relayFocusVariable`.
- Preserve `HostAdapter.requestFocusVariable(names)` and `EditorCommand.focusVariable(names)` as the stable internal APIs.
- Keep variable focus out of `init`, `documentSnapshotChanged`, `HostDocumentSnapshot`, and `HostSelectionState`.
- Keep regression coverage focused on relay behavior and non-persistence.

## 3. Non-Goals

- Change variable focus authority or persistence rules.
- Rename the controller command `focusVariable(names)`.
- Introduce snapshot-carried variable focus.
- Broaden this work into search, selection, or graph UI refactors.

## 4. Current Behavior

- The sidebar calls `HostAdapter.requestFocusVariable(names)`.
- The adapter serializes that call as raw `focusVariable`.
- The host session forwards sidebar-originated raw `focusVariable` messages to the active editor as raw `focusVariable`.
- The editor host adapter normalizes that host message back into a local variable-focus event and the controller updates `graphUiStore.activeVariableNames`.

## 5. Proposed Behavior

- `EditorToHostMessage` uses raw `requestFocusVariable`.
- `HostToEditorMessage` uses raw `relayFocusVariable`.
- The host adapter continues exposing `requestFocusVariable(names)` to the UI layer.
- The webview controller continues consuming a normalized variable-focus event and updates local graph UI state only.
- Reload, save, undo, redo, and init still cannot restore variable focus without a fresh relay.

## 6. Design

- Keep the rename at the protocol boundary: raw message types, adapter serialization, and host session routing.
- Keep the controller/runtime API name `focusVariable(names)` because it describes the editor-local effect rather than transport intent.
- Keep the normalized host event name stable unless a future adapter-boundary cleanup proves useful; this work item is focused on raw wire clarity first.
- Update baseline specs so protocol docs clearly distinguish request vs relay directions.

## 7. Implementation Plan

### Phase 1. Spec and Protocol Rename

- Add this work-item spec.
- Update `message-protocol.ts`, host adapter, host session routing, and unavailable-message handling to use the new raw names.

Exit criteria:

- No runtime code still emits or expects raw `focusVariable` messages.

### Phase 2. Baseline Docs and Regression Coverage

- Update the baseline protocol/semantics docs and inspector wording.
- Add or tighten tests that cover the request/relay boundary and confirm non-persistence behavior remains unchanged.

Exit criteria:

- Docs and tests reflect the renamed raw messages without changing local semantics.

## 8. Testing Plan

- Run `npm run test:shared`.
- Run `npm run check`.

Verified:

- `npm run test:shared` passed on 2026-05-07.
- `npm run check` passed on 2026-05-07.

## 9. Acceptance Criteria

- Editor-to-host raw protocol uses `requestFocusVariable`.
- Host-to-editor raw protocol uses `relayFocusVariable`.
- Sidebar variable clicks still result in editor-local `graphUiStore.activeVariableNames` updates.
- Reload/update snapshots still never restore variable focus from host snapshot state.
- Running `npm run test:shared` succeeds.
- Running `npm run check` succeeds.

## 10. Risks and Rollback

- Risk: one boundary keeps the old raw name and silently drops the message.
- Mitigation: update all protocol switch sites together and add adapter-level request/relay assertions.
- Risk: doc wording drifts between raw protocol names and local controller names.
- Mitigation: explicitly distinguish transport names from internal command names in baseline docs.
- Rollback: revert the raw rename while keeping the already-landed transient semantics work intact.
