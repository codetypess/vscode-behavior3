# Helper Boundary Cleanup

Status: Done
Date: 2026-05-08
Scope: Behavior-preserving cleanup for shared validation, main-document save serialization, drop preflight, and Inspector helper ownership.

## 1. Context

The current implementation already follows host-first mutation authority, but several helper modules sit on fuzzy boundaries:

- Shared validation used to be coupled to legacy utility ownership, creating unclear dependency direction.
- Main-document save serialization lives in `webview/shared`, while it resolves graphs through domain logic.
- Drop legality is checked once in the webview command layer for quick feedback and again in the host reducer for authority.
- Inspector helper files mix pure payload/validation helpers with UI components.

## 2. Goals

- Keep user-visible behavior and raw host/webview protocol unchanged.
- Make shared validation pure and usable by legacy utilities, domain graph validation, build validation, and Inspector validation.
- Move main-document save serialization out of `shared` so shared code no longer depends on domain modules.
- Keep drop preflight rules pure while keeping host reducer as the final authority.
- Split Inspector helpers by responsibility: pure `.ts` modules for payload/value/validation logic, `.tsx` modules for UI components.

## 3. Non-Goals

- Do not redesign `contracts.ts` or split public protocol types in this work item.
- Do not change persisted JSON shape, save output semantics, node ids, subtree override semantics, or host-first mutation authority.
- Do not rewrite Inspector forms or change field-level submit behavior.

## 4. Current Behavior

- Validation helpers were duplicated between domain validation and legacy shared utilities.
- `webview/domain/main-document-save.ts` depends on `domain/resolve-graph`.
- Webview drop preflight has its own local checks, and the reducer has a second implementation of overlapping structural checks.
- `inspector-shared.tsx` exports both React UI components and pure variable/diagnostic helpers; `inspector-state.ts` exports React hooks and pure form payload builders.

## 5. Proposed Behavior

Behavior remains the same:

- Invalid drop attempts still show immediate webview feedback where possible.
- Host reducer still rejects invalid mutations even if webview preflight misses or is bypassed.
- Save still writes main-tree display ids before disk persistence.
- Inspector payloads and validation results remain equivalent.

Implementation boundaries change:

- Pure validation helpers live under `webview/shared`.
- Main-document save serialization lives under `webview/domain`.
- Drop preflight is a pure webview command-local rule; host reducer keeps final mutation validation.
- Inspector pure helpers move into `.ts` modules; React components stay in `.tsx`.

## 6. Design

- Add `webview/shared/validation.ts` for variable-name checks, expression variable parsing, expression validation, variable reference validation, and shared validation diagnostic types.
- Keep `webview/domain/tree-validation.ts` focused on resolved-node diagnostics by composing shared validation helpers.
- Move `serializePersistedTreeForMainDocumentSave()` to `webview/domain/main-document-save.ts`.
- Keep the pure drop rule close to the webview mutation command that maps typed denial reasons to localized immediate feedback, while the host reducer keeps final mutation validation.
- Split Inspector helpers so value/payload/validation utilities do not live in React component modules.

## 7. Implementation Plan

1. Update this work-item spec and affected baseline specs.
2. Add shared validation helpers and update imports from domain/legacy utilities/Inspector.
3. Move main-document save serialization to domain and update extension-host imports.
4. Add pure drop preflight logic and use it in webview mutation commands.
5. Split Inspector pure helper modules and update form imports.
6. Run `npm run check` and `npm run test:shared`.

## 8. Testing Plan

- Run `npm run check`.
- Run `npm run test:shared`.
- Rely on existing coverage for validation diagnostics, save display-id writeback, host-first mutation routing, drop reducer behavior, and Inspector field serialization.

## 9. Acceptance Criteria

- No `webview/shared/**` file imports from `webview/domain/**`.
- shared validation helpers no longer depend on `webview/domain/tree-validation.ts`.
- Main-document save serialization is imported from `webview/domain/main-document-save.ts`.
- Drop immediate feedback uses pure preflight logic; host reducer remains authoritative.
- Inspector pure helpers are in `.ts` files and UI components remain in `.tsx`.
- `npm run check` succeeds.
- `npm run test:shared` succeeds.

## 10. Risks and Rollback

Risk: moving validation helpers can subtly change expression parsing or variable validation.
Mitigation: route existing callers through the same shared functions and keep existing shared tests green.

Risk: moving save serialization can break extension-host imports.
Mitigation: keep the function signature unchanged and verify save writeback tests.

Risk: drop preflight can diverge from host reducer semantics.
Mitigation: make preflight conservative and keep reducer checks unchanged as final authority.

Rollback: restore prior imports and helper locations; no persisted data migration is involved.

## 11. Verification

- `npm run check`
- `npm run test:shared`
- `rg -n "\.\./domain|\.\./\.\./domain|domain/" webview/shared` returns no matches.
