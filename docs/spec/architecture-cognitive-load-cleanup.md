# Architecture Cognitive Load Cleanup

Status: Done
Date: 2026-05-10
Scope: Behavior-preserving architecture documentation and entrypoint navigation cleanup.

## 1. Context

The current implementation intentionally uses host-first document authority, shared contracts, a webview controller runtime, and graph/host adapters. That structure solves real editor/sidebar/save/reload problems, but the repository now exposes many files, specs, and helper modules before it shows the small mental model needed to work safely.

## 2. Goals

- Make the first-pass architecture model four layers: host authority, webview runtime, pure model/contracts, and adapters/features.
- Make the spec index tell readers what to read first and what to ignore until they touch a specific flow.
- Remove obvious documentation noise that increases perceived complexity without adding rules.
- Add short navigation comments at stable code entrypoints.
- Keep user-facing behavior, protocol messages, persisted data, and module boundaries unchanged.

## 3. Non-Goals

- Do not merge or rename runtime modules.
- Do not change host/webview protocol, contracts, stores, reducers, or persistence behavior.
- Do not change graph, Inspector, build, save, undo, redo, or selection semantics.
- Do not add new test expectations.

## 4. Current Behavior

- `docs/spec/10-architecture.md` describes the architecture accurately, but it starts from a broad component tree before giving a compact reading model.
- `docs/spec/README.md` lists many baseline and work-item documents, which is useful as an index but noisy as a first entrypoint.
- `docs/spec/12-runtime-and-commands.md` repeats the `applyDocumentTree(tree, opts?)` heading.
- Key code entrypoints are correct but require readers to infer which file is the composition root, provider facade, or command catalog.

## 5. Proposed Behavior

From a user's point of view, nothing changes.

From a contributor's point of view:

- The spec index and architecture baseline start with a four-layer map.
- The docs explicitly say which files are primary entrypoints and which thin helper files are implementation details.
- Runtime command docs remove duplicate wording.
- A few entrypoint comments explain why those files exist.

## 6. Design

Use documentation and comments rather than code motion. Moving modules would create churn and risk conflicts with already-stable specs. The cleanup should make the existing structure easier to understand without changing the structure itself.

The four-layer model is:

1. Host authority: VS Code lifecycle, IO, document/session truth, project index, and inspector coordination.
2. Webview runtime: stores, controller commands, local projections, and intent construction.
3. Pure model/contracts: DTOs, path rules, reducers, tree parsing, resolved graph, validation, and shared helpers.
4. Adapters/features: G6 rendering, VS Code message bridge, Inspector/Graph/Search UI, and styles.

## 7. Implementation Plan

1. Add this work-item spec.
2. Update the spec index with a short four-layer fast path.
3. Update the architecture baseline to lead with the four-layer mental model and entrypoint guidance.
4. Remove duplicate runtime-command documentation.
5. Add entrypoint comments to stable composition/facade files.
6. Run `npm run check`.

## 8. Testing Plan

- Run `npm run check`.
- Review the diff to confirm only documentation and comments changed.

## 9. Acceptance Criteria

- `docs/spec/README.md` gives a concise four-layer first-read path.
- `docs/spec/10-architecture.md` explains the four-layer mental model before detailed components.
- `docs/spec/12-runtime-and-commands.md` no longer repeats the same `applyDocumentTree(tree, opts?)` heading.
- Code changes are limited to comments.
- `npm run check` succeeds.

## 10. Risks and Rollback

Risk: documentation could drift from implementation.
Mitigation: keep statements tied to existing files and current protocol names.

Risk: adding another work-item spec adds one more file.
Mitigation: keep it short and mark it done when verified.

Rollback: revert this spec, documentation edits, and comment-only code edits. No persisted data or runtime migration is involved.

## 11. Verification

- `npm run check`
