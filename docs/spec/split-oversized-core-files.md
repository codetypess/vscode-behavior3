# Split Oversized Core Files

Status: Done
Date: 2026-05-11
Scope: Behavior-preserving module splits for oversized core files

## 1. Context

Several implementation files have grown large enough that unrelated responsibilities are colocated, making future changes harder to review and riskier to verify. The affected areas already have clear architectural boundaries in the baseline specs: host session orchestration, shared build helpers, Inspector feature UI, and G6 adapter-local rendering helpers.

This work only splits cohesive internal seams. It must not alter behavior, public contracts, persistence, protocol, graph rendering semantics, Inspector submission semantics, or build output.

## 2. Goals

- Reduce oversized file size by moving cohesive helper/component groups into focused modules.
- Preserve existing public imports and facade files.
- Keep host authority, shared build helpers, graph adapter, and Inspector feature boundaries aligned with the baseline specs.
- Make future changes easier to localize without introducing new runtime ownership.

## 3. Non-Goals

- No user-facing behavior changes.
- No host/webview protocol changes.
- No persisted tree, resolved graph, history, save, reload, or build output changes.
- No broad graph event, viewport, draw-method, mutation, save, or watcher refactors.
- No new public API surface beyond internal section/helper modules needed by the existing facades.

## 4. Current Behavior

- `webview/shared/b3build.ts` owns build orchestration plus check script pattern resolution.
- `src/editor-session/tree-editor-webview-session.ts` owns session orchestration plus live VS Code setting resolution.
- `webview/features/inspector/node-inspector-form.tsx` owns the full Node Inspector form and its args/slot sections.
- `webview/adapters/graph/g6-graph-node.ts` owns custom G6 node registration, drawing, measurement, theme/palette, and state style helpers.

All current behavior is expected to remain unchanged.

## 5. Proposed Behavior

From the system and user point of view, behavior remains the same. Internally:

- Check script glob/path resolution lives in `webview/shared/b3build-check-scripts.ts` and remains re-exported from `b3build.ts`.
- Live editor settings resolution lives in `src/editor-session/session-live-settings.ts`.
- Node Inspector args and variable sections live in dedicated feature-local modules, while `NodeInspectorForm` remains the external component.
- Low-coupling graph node helpers live in adapter-local modules, while `g6-graph-node.ts` remains the custom node class and registration facade.

## 6. Design

### Build shared layer

`webview/shared/b3build-check-scripts.ts` contains only checkScripts-specific constants, glob helpers, and `resolveCheckScriptPaths`. `webview/shared/b3build.ts` imports/re-exports `resolveCheckScriptPaths` to preserve callers.

### Host session layer

`src/editor-session/session-live-settings.ts` contains `EditorLiveSettings` and `createLiveSettingsResolver`. It may depend on VS Code configuration APIs and existing settings/color helpers, but it must not own webview posting, message routing, or session state.

### Inspector feature UI

`node-inspector-args-section.tsx` owns structured arg field rendering and validation wiring. `node-inspector-variable-section.tsx` owns input/output slot rendering and validation wiring. These modules import shared inspector utilities directly and do not import `node-inspector-form.tsx`, avoiding cycles.

### Graph adapter boundary

Graph node helper modules stay under `webview/adapters/graph/`. Extracted helpers may be imported by the custom node class, but the class remains in `g6-graph-node.ts`; draw methods and registration are not split in this pass.

## 7. Implementation Plan

1. Extract checkScripts helpers from `b3build.ts` and preserve the facade export.
2. Extract live settings resolver from `tree-editor-webview-session.ts`.
3. Extract Node Inspector args and variable sections into feature-local modules.
4. Extract vector tree node theme, measurement, and style helpers only where dependencies remain straightforward.
5. Run checks and update this work item to `Verifying`, then `Done` after acceptance criteria pass.

## 8. Testing Plan

Automated checks:

- `npm run check`
- `npm run test:shared`

Manual smoke checks when feasible:

- Open a behavior tree editor and select a node.
- Confirm Node Inspector args still render, validate, and submit.
- Confirm input/output variable slots still autocomplete, validate, and submit.
- Confirm graph node colors, icons, states, sizing, and text wrapping look unchanged.
- Confirm a workspace with `settings.checkScripts` resolves checker scripts and reports missing patterns as before.
- Change behavior3 VS Code settings and confirm live settings refresh as before.

## 9. Acceptance Criteria

- Existing public imports remain compatible for `NodeInspectorForm`, `resolveCheckScriptPaths`, `resolveTreeEditorSession`, `ActiveTreeEditorWebview`, `registerGraphNode`, and `measureGraphNode`.
- `npm run check` succeeds.
- `npm run test:shared` succeeds.
- No behavior, protocol, persistence, graph contract, Inspector contract, or build output semantics change.
- Extracted modules contain cohesive moved logic rather than duplicated implementations.

## 10. Risks and Rollback

Risk is primarily accidental import cycles or subtle behavior drift during JSX/helper movement. Mitigation is to preserve original code bodies, move cohesive blocks mechanically, keep facade exports, and run type/test checks.

Rollback is mechanical: move extracted code back to its original file and restore the original imports. Because public facades remain stable, external call sites should not need rollback edits.