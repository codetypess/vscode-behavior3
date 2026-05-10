# Shared Helper Consolidation

Status: Done
Date: 2026-05-10
Scope: Trim low-value files from `webview/shared` without changing runtime behavior.

## 1. Context

`webview/shared` was flattened from the old `shared/misc` directory. The next maintenance issue is file count and unclear ownership: some helpers are only used by one runtime module, while some tiny helpers describe the same domain concept but live in separate files.

Current scan results:

- `array.ts` only mutates `Array.prototype` and no source code calls the added methods.
- `drop-preflight.ts` is only consumed by `webview/commands/controller-mutation-commands.ts`.
- `slot-definition-utils.ts` and `node-definition-utils.ts` are both node-definition helper surfaces and are often read together.

## 2. Goals

- Remove unused shared global side effects.
- Move single-consumer helper logic out of `webview/shared`.
- Merge node-definition and slot-definition helpers into one shared module.
- Keep existing editor, graph, inspector, build, save, and host protocol behavior unchanged.

## 3. Non-Goals

- Do not rewrite `b3build.ts`, tree persistence, schema parsing, or protocol contracts.
- Do not introduce barrel files or path aliases.
- Do not change stable DTO names or host/webview message shapes.
- Do not change user-facing validation or drop denial behavior.

## 4. Current Behavior

- `b3util.ts` imports `./array` for prototype side effects, but the augmented methods are unused.
- Drop preflight lives in shared despite only being command-local UI feedback.
- Slot parsing lives in a separate file from node-definition lookup/group helpers.

## 5. Proposed Behavior

Runtime behavior remains the same.

Implementation changes:

- Delete the unused `array.ts` prototype extension and its side-effect import.
- Inline drop preflight types and function into `controller-mutation-commands.ts`.
- Move `ParsedSlotDefinition` and `parseSlotDefinition` into `node-definition-utils.ts`.
- Update imports and tests to use `node-definition-utils.ts` for slot parsing.

## 6. Design

The consolidation follows existing boundaries:

- Shared keeps state-free helpers that have multiple consumers or describe stable data concepts.
- Command-local preflight stays next to the command that formats and uses its denial reasons.
- No shared module should add new dependencies on domain, feature, or adapter code.

Rejected alternatives:

- Adding a `shared/index.ts` barrel: this would hide dependency direction and create accidental cycles.
- Merging DOM/Ant Design theme helpers: these files are intentionally split so extension-host imports do not pick up DOM or UI library types.

## 7. Implementation Plan

1. Add this work-item spec and register it in `docs/spec/README.md`.
2. Merge slot parsing into `node-definition-utils.ts` and rewrite imports.
3. Inline drop preflight into `controller-mutation-commands.ts` and delete the shared file.
4. Remove `array.ts` and its unused side-effect import.
5. Run `npm run check` and `npm run test:shared`.

## 8. Testing Plan

- Run `npm run check`.
- Run `npm run test:shared`.
- Search for removed module imports after editing.

## 9. Acceptance Criteria

- `webview/shared/array.ts`, `webview/shared/drop-preflight.ts`, and `webview/shared/slot-definition-utils.ts` no longer exist.
- No source import references the removed modules.
- Node definition and slot utility tests still pass.
- `npm run check` succeeds.
- `npm run test:shared` succeeds.

## 10. Risks and Rollback

Risk: import rewrites can miss a call site.
Mitigation: TypeScript check and source search.

Risk: command-local preflight can diverge from host reducer validation.
Mitigation: this change only moves existing code; host reducer behavior is untouched.

Rollback: restore the removed files and original imports.

Follow-up: `shared-legacy-facade-removal.md` removes the remaining `b3util.ts` facade once compatibility is no longer a constraint.

## 11. Verification

- `npm run check`
- `npm run test:shared` (94 shared tests passed)
