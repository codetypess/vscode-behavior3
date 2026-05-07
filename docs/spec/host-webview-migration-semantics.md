# Host Webview Migration Semantics

Status: Done
Date: 2026-05-07
Scope: Audit and normalize host-first sidebar/editor migration semantics across specs, protocol, adapter, controller, and tests

## 1. Context

The sidebar/editor migration has moved main-document authority into the extension host: webviews send intents, the host commits authoritative document/session/selection state, and both editor and sidebar converge through host snapshots. Several cleanup work items have already removed public `nextSelection` and split local graph UI hints from host-projected selection.

The remaining risk is semantic drift. Some code still carries migration-era names, local reducer preflight behavior, or duplicated raw/normalized protocol shapes. Those may be valid implementation details, but they should be explicit and consistent so future work does not accidentally reintroduce a second document authority.

## 2. Goals

- Identify behavior/spec/implementation mismatches in the completed host-first migration.
- Use one vocabulary for public protocol, normalized DTOs, host commits, webview projection, and local preflight.
- Keep webviews as intent senders and projection owners, not main-document commit authorities.
- Add or adjust tests for any clarified boundary that could regress.
- Update baseline specs when the clarified behavior is a lasting rule.

## 3. Non-Goals

- Do not rewrite the graph adapter, Inspector forms, or host session architecture.
- Do not remove useful webview-local UI validation unless it conflicts with host authority.
- Do not change persisted tree schema, subtree file ownership, build behavior, or node-check behavior.
- Do not introduce new public host/webview messages unless an inconsistency requires it.

## 4. Current Behavior

- `EditorToHostMessage` contains intent messages for save, revert, undo, redo, selection, variable-focus requests, and document mutations.
- `HostToEditorMessage` contains raw host replies/events; the adapter normalizes them into `HostEvent` DTOs.
- `documentSnapshotChanged` carries committed content, document session metadata, sync kind, and shared selection.
- Webview commands forward document mutations to the host. At the start of this audit, `updateTreeMeta` and `updateNode` still ran the shared reducer against the current projection to provide no-op suppression and early UI errors.
- The host session still performs the authoritative reduce/commit/fanout path.

## 5. Proposed Behavior

The durable semantics should be:

- Raw protocol message types stay transport-shaped and may differ from normalized app DTOs.
- Normalized DTOs are the only shape consumed by app/controller code after the host adapter boundary.
- Document-affecting commands may do local input preparation and cheap UI guards, but must not run the shared reducer locally to decide noop/error/commit outcomes.
- Any real document change must enter the extension-host session as an intent before becoming committed state.
- The host remains the only owner of document dirty/history/reload state and shared tree/node selection snapshots.

## 6. Design

Audit the following boundaries and only patch concrete drift:

- `webview/shared/message-protocol.ts` raw transport messages
- `webview/shared/contracts.ts` normalized DTOs and app-facing adapter/command contracts
- `webview/adapters/host/vscode-host-adapter.ts` normalization
- `webview/commands/*` intent forwarding and local projection/preflight
- `src/editor-session/*` host commit/session behavior
- `src/inspector-sidebar-coordinator.ts` sidebar proxy behavior
- numbered specs under `docs/spec/`
- shared tests that encode the migration boundary

## 7. Implementation Plan

1. Create this work-item spec.
2. Audit code and specs for inconsistent authority, naming, response shape, or residual legacy protocol paths.
3. Patch the smallest set of inconsistencies.
4. Add or update tests that lock the clarified semantics.
5. Update affected numbered specs and the spec index.
6. Run `npm run check` and `npm run test:shared`.

## 8. Testing Plan

- Run `npm run check`.
- Run `npm run test:shared`.
- Add focused tests if the cleanup changes observable boundary behavior or documents an existing boundary that lacked coverage.

## 9. Acceptance Criteria

- Public protocol and normalized DTO docs use one consistent host-first vocabulary.
- No public protocol surface exposes reducer-internal `nextSelection` or webview-local document commit authority.
- Webview-local reducer usage is either removed or clearly constrained to preflight/projection behavior.
- Host commit flows remain the sole source of dirty/history/reload/session fanout.
- Automated checks pass.

## 10. Risks and Rollback

Risk is mostly accidental behavior churn around save, undo/redo, mutation errors, and selection projection. Keep changes narrow, test shared reducer/controller/session behavior, and rollback by reverting the most recent cleanup slice at the protocol/controller boundary.
