# Host Request Spec Map

Status: Approved
Date: 2026-05-10
Scope: host/webview request-response registry, adapter pending request handling, protocol baseline

## 1. Context

Host request/response messages already use explicit `requestId` values and timeout handling. The current implementation is correct, but the request type list, timeout fallback, response resolver, and outgoing adapter methods are encoded in separate switch statements.

When a new request is added, multiple files must remain manually synchronized:

- `message-protocol.ts`
- `vscode-host-adapter.ts`
- `tree-editor-webview-session.ts`

## 2. Goals

- Add a single shared request registry for request type, result message type, response payload mapping, and timeout fallback.
- Keep the existing raw message shapes and public `HostAdapter` methods stable.
- Make adapter pending-request resolution table-driven instead of duplicating every request in local switches.
- Document the request registry as the long-term protocol rule.

## 3. Non-Goals

- Do not redesign raw host message names.
- Do not replace `requestId` with another correlation mechanism.
- Do not change extension-host message dispatch behavior in this work item.

## 4. Current Behavior

- Requests time out after 30 seconds.
- Each pending request is stored by `requestId`.
- Response handling in the webview adapter switches over result message names and manually maps them back to pending request types.

## 5. Proposed Behavior

- `HostRequestSpec` becomes the registry for all request/response pairs.
- The adapter asks the registry to create timeout values and resolve result messages.
- Adding a request requires adding one registry entry plus the existing public adapter method and host handler.

## 6. Design

- Create a shared module under `webview/shared/`.
- Keep result normalization that depends on branded paths in the adapter/protocol layer.
- Export narrow helper functions instead of exposing mutable registry internals.

## 7. Implementation Plan

1. Add the request spec module.
   Exit: all request result types and timeout fallbacks are represented in one registry.
2. Refactor `vscode-host-adapter.ts`.
   Exit: pending request timeout and response resolution use the registry.
3. Update baseline protocol docs.
   Exit: `13-host-protocol.md` and `12-runtime-and-commands.md` describe the registry rule.
4. Verify.
   Exit: `npm run check` and `npm run test:shared` pass.

## 8. Testing Plan

- Existing shared test covering pending host requests on disconnect must keep passing.
- Add focused helper tests if the registry exposes pure mapping helpers.
- Run `npm run check`.
- Run `npm run test:shared`.

## 9. Acceptance Criteria

- Every request/response pair handled by `HostAdapter` appears in the registry.
- Timeout fallback values are created through the registry.
- Response result messages resolve pending requests through one table-driven path.
- Existing host request tests pass unchanged or with only mechanical import updates.

## 10. Risks and Rollback

Risk: incorrect result mapping can leave host requests unresolved.
Mitigation: keep existing message names and add tests around registry mappings.

Rollback: restore the adapter-local pending request map and response switch.
