# Selection Snapshot Single Authority

Status: Done
Date: 2026-05-07
Scope: Remove public `nextSelection` protocol exposure so shared selection converges only through host snapshot `selection`

## 1. Context

The repository already migrated shared tree/node selection ownership to the host:

- ordinary `selectTree` / `selectNode` gestures enter the host first
- the host stores one shared `HostSelectionState`
- `init.selection` and `documentSnapshotChanged.selection` already expose that host-owned snapshot to both editor and inspector sidebar

However, structural mutation follow-up selection still carries a transitional dual track:

- host-side reducers return `nextSelection`
- the host translates that reducer result into `sharedSelection`
- the same reducer result is still exposed publicly through `mutateDocumentResult.nextSelection`
- the same reducer result is also still exposed publicly through `documentSnapshotChanged.nextSelection`

That means the selection authority migration is incomplete. Even though the host already owns the shared selection snapshot, the public protocol still exposes a second mutation-follow surface that clients can depend on.

## 2. Goals

- Remove `nextSelection` from the public host/webview protocol.
- Keep reducer `nextSelection` only as an internal host-side mutation result.
- Make both editor and inspector sidebar converge selection exclusively from `init.selection` and `documentSnapshotChanged.selection`.
- Preserve current mutation follow-up behavior by translating reducer `nextSelection` into host `sharedSelection` before snapshot fanout.

## 3. Non-Goals

- No change to shared reducer return shapes.
- No change to ordinary `selectTree` / `selectNode` host intent routing.
- No attempt in this work item to remove optimistic editor-local selection projection before the host echo returns.
- No change to variable-focus ownership.

## 4. Current Behavior

- `HostDocumentSnapshot` still includes optional `nextSelection`.
- `mutateDocumentResult` still includes optional `nextSelection`.
- `TreeEditorWebviewSession` already updates `state.sharedSelection` from reducer `nextSelection`, but it also forwards the same field through snapshot fanout and request/response replies.
- The VS Code webview host adapter still normalizes `mutateDocumentResult.nextSelection` into `DocumentMutationResponse`.
- Shared controller snapshot application already treats `snapshot.selection` as the real authority, but test fixtures and protocol types still encode the old dual-track contract.

## 5. Proposed Behavior

- Reducers may continue returning `nextSelection` internally.
- The host session immediately folds any reducer `nextSelection` into `state.sharedSelection`.
- The host then fans out only the committed `selection` snapshot through `documentSnapshotChanged`.
- `mutateDocumentResult` becomes success/error only; it no longer exposes mutation-follow selection.
- Webviews must not depend on any mutation-response `nextSelection` field or any snapshot `nextSelection` field.

## 6. Design

### 6.1 Internal vs Public Selection Surfaces

Keep two distinct layers:

- internal reducer/session layer:
  - reducer returns `nextSelection`
  - host converts it into `HostSelectionState`
- public protocol layer:
  - `init.selection`
  - `documentSnapshotChanged.selection`

The internal reducer result is a host implementation detail, not a stable protocol field.

### 6.2 Host Commit Rule

When a host-side mutation reducer returns `nextSelection`:

- update `state.sharedSelection` in the same host commit
- do not forward `nextSelection` on `mutateDocumentResult`
- do not forward `nextSelection` on `documentSnapshotChanged`

The committed selection authority visible to webviews is only the host snapshot `selection`.

### 6.3 Webview Projection Rule

Editor and inspector sidebar continue projecting selection locally against their own resolved graph/runtime state, but they may only do that from:

- `init.selection`
- `documentSnapshotChanged.selection`

Mutation responses remain transport acknowledgements, not selection-state carriers.

## 7. Implementation Plan

### Phase 1. Spec and Protocol Cleanup

- Add this work item.
- Remove `nextSelection` from public protocol/contracts DTOs.
- Update baseline specs that still describe public `nextSelection` exposure.

Exit criteria:

- Public protocol types no longer mention snapshot/response `nextSelection`.

### Phase 2. Host Session Fanout Cleanup

- Keep reducer `nextSelection` only inside `TreeEditorWebviewSession`.
- Update shared selection from reducer results before snapshot fanout.
- Reply to mutation requests without `nextSelection`.

Exit criteria:

- Host fanout uses only `selection` snapshots.

### Phase 3. Webview and Test Cleanup

- Remove adapter normalization and tests that expect mutation/snapshot `nextSelection`.
- Keep controller snapshot application driven only by `snapshot.selection`.

Exit criteria:

- No webview runtime contract depends on public `nextSelection`.

## 8. Testing Plan

- Update shared tests to validate reducer `nextSelection` only at reducer level.
- Update controller snapshot tests to drive selection through `snapshot.selection` alone.
- Run `npm run test:shared`.
- Run `npm run check`.

## 9. Acceptance Criteria

- `HostDocumentSnapshot` no longer exposes `nextSelection`.
- `mutateDocumentResult` no longer exposes `nextSelection`.
- Host-side mutation reducers may still return `nextSelection`, but only the host session consumes it.
- Editor and inspector sidebar still converge on the expected selected node after structural mutations through `documentSnapshotChanged.selection`.
- Running `npm run test:shared` succeeds.
- Running `npm run check` succeeds.

## 10. Risks and Rollback

- Risk: a remaining webview call site still expects mutation-response `nextSelection` and silently stops updating selection.
- Mitigation: remove the field at the type level and update snapshot-based tests to assert the committed `selection` path only.
- Risk: a host mutation path forgets to translate reducer `nextSelection` into `sharedSelection` before fanout.
- Mitigation: keep the translation inside the host session commit path and verify structural mutation flows in shared tests.
- Rollback: restore the public protocol fields temporarily, but keep the host-owned `selection` snapshot as the primary authority.
