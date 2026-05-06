# Sidebar Host Single Source

Status: Done
Date: 2026-05-06
Scope: Migrate main-document authority from webview-local controller state to an extension-host document session, using staged intent-based save, undo/redo, mutation, and snapshot fanout flows
Progress: Phase 1 host session shell landed; Phase 2 host intent routing is complete for save, undo, and redo; Phase 3 is complete for sidebar `updateTreeMeta` / `updateNode`; Phase 4 is complete, all current main-document mutations now commit directly in host; Phase 5 is complete, with unified host document snapshot fanout, mutation-follow selection projection, and `treeSelected` removed from the authoritative document-sync loop

## 1. Context

The current editor has already completed two important steps:

- an extension-host per-document session with a serialized main-document operation queue
- an inspector sidebar that proxies its mutations through the active editor instead of writing independently

That work fixed a large class of race conditions, but it did not yet reach the long-term architecture discussed for "real solution 2".

Today, the main editor webview still owns the authoritative structured document state, history, dirty calculation, and undo/redo behavior. The extension host mainly owns:

- `TreeEditorDocument.content`
- disk save/revert/reload serialization
- watcher coordination
- sidebar message routing

The sidebar is no longer an independent mutation executor, but it still spins up a local runtime with its own mirrored `persistedTree` plus host-projected dirty/reload state.

This means "save entry unified into host/session" was only a partial repair direction. It improves save routing, but it does not change the deeper ownership split that causes save, pending, and dirty semantics to fan out across:

- the main editor runtime
- the sidebar runtime mirror
- the extension-host document/session lifecycle

As a result, a narrow Ctrl+S or pending-dot fix would treat symptoms but would not establish a durable single-source-of-truth model.

## 2. Goals

- Introduce an extension-host authoritative document session for the main document.
- Make save, undo/redo, and document mutation flows converge through host-side intent handling.
- Reduce the sidebar and canvas to intent-driven clients instead of independent document authorities.
- Eliminate classes of divergence where one webview believes the document is still pending, dirty, or unsaved after the host has already committed a save.
- Allow the migration to happen in stages instead of a risky big-bang rewrite.
- Preserve the current graph, inspector, subtree, build, and validation behavior while ownership shifts.

## 3. Non-Goals

- No immediate rewrite of the graph adapter or inspector UI.
- No persisted tree schema change.
- No subtree-source ownership migration out of the current host and webview responsibilities in the first phase.
- No attempt to introduce collaborative or multi-user editing semantics.
- No requirement that every existing mutation reducer move to the host in the first implementation step.
- No baseline-spec rewrite in this draft beyond registering the work item; numbered baseline specs should continue to describe current code until implementation lands.

## 4. Current Behavior

- `documentStore` in the webview now holds `persistedTree` plus host-projected dirty/reload conflict state, without a local history or saved-snapshot mirror.
- `TreeEditorDocument` in the extension host owns only serialized text content, custom-editor dirty state, and own-write suppression.
- The main editor no longer uses `update` as a primary write path, and it no longer acts as a compatibility mutation executor for the host.
- The sidebar receives mirrored init/content/selection data from the host, but still bootstraps a local document runtime for projection, graph rebuilds, and selection state.
- Sidebar `mutateDocument` currently covers `updateTreeMeta` and `updateNode`, and those intents now enter the host first.
- `saveDocument`, `undo`, and `redo` now enter the host first from both the editor and the sidebar.
- The host applies save/history transitions against its own document session state and rebroadcasts the committed result back to both webviews.
- For sidebar `updateTreeMeta` and `updateNode`, the host now runs a shared reducer directly; `updateNode` carries explicit node snapshot context, so fallback is no longer needed for selected-node drift or subtree-original reconstruction.
- Canvas structural commands now enter the host first as `mutateDocument` intents instead of mutating locally before sending `update`.
- `performDrop`, `pasteNode`, `insertNode`, `replaceNode`, `deleteNode`, and `saveSelectedAsSubtree` now commit directly in host, with reducer `nextSelection` folded into host-owned `selection` before fanout.
- Cross-view committed main-document sync now fans out through one `documentSnapshotChanged` payload that carries content, session metadata, sync kind, and the committed shared `selection` snapshot.
- Mutation follow-up selection now enters both editor and sidebar through that same committed snapshot fanout, so sidebar no longer waits for a second editor-origin selection echo after host-side structural commits.
- Host var-decl refresh after committed main-document changes now runs directly from the committed content in the host session; `treeSelected` is no longer part of authoritative document-state convergence.

## 5. Proposed Behavior

### 5.1 End-State Behavior

The final target architecture is:

- the extension host owns the authoritative document session for:
  - current document snapshot
  - last-saved snapshot
  - dirty state
  - undo/redo history
  - save/revert/reload conflict state
  - current shared selection payload used by canvas and sidebar
- canvas and sidebar webviews emit user intents instead of committing document mutations locally
- the host applies or delegates the intent, commits the authoritative result, and broadcasts one authoritative document snapshot payload back to both webviews
- sidebar save and pending-state drift disappears because save-state authority exists in one place only

### 5.2 Migration Behavior

This work should not jump directly from the current webview-authoritative model to the final model in one change.

Instead, the migration should proceed by introducing a host-side authoritative session shell first, then moving entry points behind host intents in phases:

1. save, revert, undo, and redo
2. sidebar-originated tree and node mutation
3. canvas-originated mutation and structural commands
4. final reducer ownership and protocol cleanup

During the transition, compatibility shims are allowed, but only if the host session remains the place that decides what snapshot is committed and rebroadcast.

For Phase 4 specifically, the first migration cut is allowed to:

- let canvas commands enter the host first as `mutateDocument` intents
- complete the migration by removing the host-triggered webview compat executor once all main-document mutations are host-owned

For the current Phase 5 cleanup cut, the migration should additionally:

- replace separate "content changed" and "session changed" fanout with one host document snapshot event
- let mutation-driven reducer `nextSelection` update the same host-owned shared selection snapshot seen by both editor and sidebar
- stop treating `treeSelected` as part of the authoritative main-document sync loop after host commits content

## 6. Design

### 6.1 Authoritative Host Session State

Add a host-side document session state object that becomes the canonical owner of at least:

- normalized current main-document content
- normalized last-saved content
- history stack and active history index
- dirty state derived from current content vs last-saved content
- external reload conflict payload
- current shared selection payload for sidebar and editor fanout

The host may continue to persist `TreeEditorDocument.content` as the VS Code custom-editor mirror, but that mirror should become a projection of the document session rather than an independent conceptual authority.

For committed document fanout, the host should expose one normalized snapshot shape that at minimum carries:

- normalized committed content
- current `HostDocumentSessionState`
- the sync kind (`update` vs `reload`)
- current shared `selection` snapshot after any mutation-follow projection is applied internally

### 6.2 Intent Surface

Add an explicit host intent layer for document-affecting actions. The intent catalog should grow over time, but the migration should plan around these groups:

- lifecycle intents:
  - `saveDocument`
  - `revertDocument`
  - `undo`
  - `redo`
- document mutation intents:
  - `updateTreeMeta`
  - `updateNode`
  - `performDrop`
  - `insertNode`
  - `replaceNode`
  - `deleteNode`
  - `saveSelectedAsSubtree`
- selection intents:
  - `selectTree`
  - `selectNode`
  - variable-focus or inspector-selection sync, where needed

The previous `update { content }` message has been retired from the main document write path and should not be reintroduced as the long-term primary protocol.

### 6.3 Hybrid Reducer Transition

The first host-authoritative phase does not need to port every tree mutation algorithm into the host immediately.

An acceptable transitional design is:

- webviews emit host intents first
- the host session owns queueing, history advancement, dirty/save state, and snapshot fanout
- for commands not yet ported to a pure shared reducer, the host may temporarily ask the active editor runtime to execute the intent and return a proposed snapshot
- the host then validates, normalizes, commits, and rebroadcasts that snapshot as the authoritative result

This keeps the migration incremental while moving state authority before moving every reducer implementation.

### 6.4 Webview Ownership After Migration

After the migration stabilizes:

- main editor webview keeps:
  - parsed document projection
  - resolved graph
  - graph VM
  - graph viewport
  - local search UI state
  - local inspector form pending state
- sidebar webview keeps:
  - projection state needed to render the current selection and forms
  - local form pending state
- neither webview owns the authoritative dirty, save, or undo/redo model

### 6.5 Selection Ownership

Selection is part of the long-term host-authoritative session because sidebar and canvas both consume it.

However, selection can migrate in two steps:

1. host records and rebroadcasts the authoritative selection payload even if the editor still computes most of the selection DTO
2. later, selection changes also enter through host intents and the host decides what shared selection snapshot becomes visible

### 6.6 Protocol Cleanup Rule

Legacy protocol pieces such as:

- `documentUpdated`
- `documentReloaded`
- `documentSessionChanged`

may remain temporarily, but each one must be classified in implementation as either:

- compatibility-only for an unfinished migration phase, or
- replaced by an intent-plus-snapshot session flow

The migration is not complete while these message paths still act as the primary authority boundary.

### 6.7 Mutation-Follow Selection Projection

Full cross-view selection authority does not need to migrate to host intents in this cut.

However, once a host-side mutation commits, the host should be the place that decides the committed follow-up selection projection exposed to both webviews. Concretely:

- shared reducers may continue to return `nextSelection`
- the host should translate that reducer result into the same shared `selection` snapshot it owns
- the public `mutateDocumentResult` and `documentSnapshotChanged` payloads should expose only the committed shared `selection`
- editor and sidebar should apply that projection locally against their own rebuilt graph/runtime state instead of waiting for editor-to-sidebar inspector echo

This shrinks local fallback logic without requiring the host to synthesize full inspector DTOs for every mutation outcome.

### 6.8 `treeSelected` Demotion Rule

`treeSelected` is no longer allowed to be the required bridge that completes host understanding of a just-committed main-document snapshot.

After this cleanup:

- host-owned save, undo/redo, mutation, revert, and reload flows must refresh host vars/session fanout directly from the committed content they already own
- any remaining `treeSelected` usage must be documented as auxiliary or derived behavior only, not as part of authoritative document-state convergence

## 7. Implementation Plan

### Phase 1. Host Session Shell

- Create this work item and register it.
- Define the host-side document session state shape and compatibility rules.
- Introduce a host-owned notion of:
  - current snapshot
  - last-saved snapshot
  - dirty
  - history/index
  - reload conflict

Exit criteria:

- There is one documented host session state object that owns save and history truth.
- Save, revert, undo, and redo no longer depend on sidebar-local history or saved-snapshot authority.

### Phase 2. Save and Undo/Redo Intent Routing

- Change both webviews so save, undo, and redo enter the host as intents.
- Have the host commit and rebroadcast the resulting authoritative snapshot and status.
- Keep compatibility fanout into existing editor runtime only where required.

Exit criteria:

- Ctrl+S, undo, and redo from either webview converge through the same host session flow.
- Sidebar and canvas no longer compute independent saved-state truth.

### Phase 3. Sidebar Mutation Intents

- Move sidebar-originated `updateTreeMeta` and `updateNode` behind the new host session intent path.
- Preserve current validation and subtree rules.
- Treat the active editor runtime as an implementation helper only if a mutation reducer has not yet been ported.

Exit criteria:

- Sidebar never commits document state locally before the host session commits it.
- Sidebar pending/save state cannot diverge from the committed host session state.
- Sidebar `updateTreeMeta` and `updateNode` now satisfy this exit criteria; remaining mutation work is in canvas-originated structural commands.

### Phase 4. Canvas Mutation Intents

- Route canvas-originated structural commands through the same host intent path.
- Allow `mutateDocument` from the active editor webview, not only from external/sidebar views.
- Retire "local mutation first, then push host content" as the normal edit model.

Exit criteria:

- Every persisted-tree mutation first appears as a host-session intent before it becomes committed state.
- Canvas `performDrop`, `pasteNode`, `insertNode`, `replaceNode`, `deleteNode`, and `saveSelectedAsSubtree` now satisfy this rule through host-side reducer execution.

### Phase 5. Reducer Port and Cleanup

- Move mutation reducers into a shared pure domain layer that the host can run directly.
- Replace split content/session fanout with one host document snapshot event.
- Feed mutation follow-up selection into the host-owned shared `selection` snapshot before fanout.
- Remove or demote compatibility protocol paths that depended on the active editor webview as the executor.
- Stop relying on `treeSelected` as the host's post-commit var refresh trigger.
- Shrink webview document stores to projection-only responsibilities.

Exit criteria:

- The host can commit document mutations without requiring the active editor webview to be the executor.
- Dirty, save, and undo/redo ownership no longer live in webview-local document state.
- Host-driven document sync no longer depends on separate content/session message pairs for committed snapshots.
- Host var-decl refresh for committed main-document changes no longer waits for the webview to echo the tree back.

## 8. Testing Plan

- Manual regression for:
  - edit in sidebar, save in sidebar, dirty clears in both views
  - edit in canvas, save in editor, sidebar immediately reflects saved state
  - undo and redo triggered from both editor and sidebar
  - external file change while clean
  - external file change while dirty
  - subtree-linked node edits and override behavior
- Manual regression for:
  - structural mutation from editor updates sidebar selection without waiting for a second editor-origin selection echo
  - committed mutation/save/undo/reload fanout reaches editor and sidebar through a single host document snapshot path
- Add reducer or session-state tests for host history, dirty, save, and reload-conflict transitions as host ownership moves.
- Add protocol-level checks for new host intent and snapshot message shapes.
- Add coverage that committed mutation follow-up selection reaches non-initiating webviews through host snapshot `selection`.
- Re-run the acceptance scenarios that touch:
  - save/revert/reload
  - inspector sidebar proxy editing
  - selection sync
  - subtree refresh

## 9. Acceptance Criteria

- A host-side document session exists as the documented and implemented source of truth for current snapshot, last-saved snapshot, dirty, history/index, and reload-conflict state.
- Save, undo, and redo from both canvas and sidebar enter the host through the same authoritative intent flow.
- Sidebar and canvas cannot disagree about whether the main document is dirty or saved after the same committed command sequence.
- Any document mutation that changes persisted-tree content first passes through a host-session intent boundary before becoming committed state.
- By the end of the migration, the host can commit document mutations without requiring the active editor webview to remain the primary executor.
- Committed host document fanout no longer requires separate content and session notifications to describe one state transition.
- Mutation follow-up selection for committed host-side reducers is observable from the authoritative host snapshot fanout, not only from local editor-side repair logic.
- Host var refresh after committed main-document changes no longer depends on a webview `treeSelected` echo.
- Numbered baseline specs are updated only when the implemented code has actually crossed the relevant ownership boundary.

## 10. Risks and Rollback

- Risk: protocol churn breaks save, selection sync, or external reload handling.
- Mitigation: migrate in phases and keep compatibility protocol paths explicit and temporary.
- Risk: moving state authority before reducer logic causes duplicated commit paths.
- Mitigation: require each phase to nominate one commit point in the host session and treat all other paths as projections or helpers only.
- Risk: selection, subtree refresh, and validation flows regress because they currently piggyback on webview-local mutation timing.
- Mitigation: include those flows in phase exit criteria and regression checks, not only save-state checks.
- Rollback: revert the latest host-session migration slice at the host/session boundary if a phase regresses, instead of restoring a second live executor path.
