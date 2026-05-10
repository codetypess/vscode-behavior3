# Document Mutation Selection Internal Boundary

Status: Done
Date: 2026-05-07
Scope: Move reducer follow-up selection typing out of public contracts

## 1. Context

`nextSelection` has already been removed from the public host/webview protocol, but its helper type `DocumentMutationSelection` still lives in `webview/shared/contracts.ts`. That file reads as the stable DTO surface, so leaving the type there makes an internal reducer/session detail look public.

## 2. Goals

- Keep `DocumentMutationSelection` scoped to the reducer and host session boundary.
- Remove the type from public shared contracts.
- Preserve existing reducer behavior and host translation into committed `HostSelectionState`.
- Document that `nextSelection`-related types are internal only.

## 3. Non-Goals

- Do not reintroduce `nextSelection` to `mutateDocumentResult` or `documentSnapshotChanged`.
- Do not change mutation intent payloads.
- Do not change graph, Inspector, or selection projection behavior.

## 4. Current Behavior

The reducer returns `nextSelection` for structural mutations such as insert, paste, replace, delete, and drop. `TreeEditorWebviewSession` consumes it immediately and updates host-owned shared selection before snapshot fanout. The public protocol no longer exposes `nextSelection`, but `DocumentMutationSelection` remains exported from `contracts.ts`.

## 5. Proposed Behavior

`DocumentMutationSelection` is exported from the reducer module because it describes the reducer result consumed by the host session. Public `contracts.ts` contains only DTOs that can cross the host/webview boundary or are stable shared domain models.

## 6. Design

- Define `DocumentMutationSelection` in `webview/shared/document.ts`.
- Keep `DocumentMutationReducerResult.nextSelection` unchanged.
- Import the type from the reducer module in the host session.
- Update the host protocol baseline to state that `nextSelection` helper types belong only to the host/reducer boundary.

## 7. Implementation Plan

1. Move the type definition from `contracts.ts` to `document.ts`.
2. Update reducer and host-session imports.
3. Update baseline/work-item spec index entries.
4. Run TypeScript and shared tests.

## 8. Testing Plan

- Run `npm run check`.
- Run `npm run test:shared`.

## 9. Acceptance Criteria

- `webview/shared/contracts.ts` no longer exports `DocumentMutationSelection`.
- Reducer `nextSelection` tests continue to pass.
- Public protocol docs state that `nextSelection` helper types are internal host/reducer implementation detail.

## 10. Risks and Rollback

Risk is limited to TypeScript import churn. Rollback is restoring the type export to `contracts.ts` and the previous imports.
