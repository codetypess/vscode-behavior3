# Embedded Inspector Focus Regression

Status: Done
Date: 2026-05-29
Scope: embedded inspector host bridge / inspector snapshot fallback / same-node blur commits

## 1. Context

In `inspectorMode="embedded"`, Node Inspector fields commit through the same host-first mutation flow as
sidebar mode. A field-to-field click blurs the current input, sends `updateNode`, and then waits for
the committed `documentSnapshotChanged` round-trip. During that round-trip, the host selection can
temporarily hold `selectedNodeRef` while `selectedNodeSnapshot` is still pending.

The Inspector already has a per-file snapshot cache so node selection can stay on the node channel
while the fresh snapshot is rebuilding. Sidebar mode writes into that cache on init and document
updates, but the embedded editor app currently does not. That makes embedded mode fall through to the
`node-pending` skeleton during same-node blur commits, which remounts the pane, resets scroll
position, and prevents the next clicked input from receiving focus.

## 2. Goals

- Keep embedded Node Inspector mounted while a same-logical-node committed snapshot is pending.
- Preserve field-to-field focus handoff and scroll position during blur-triggered node commits.
- Reuse the existing inspector snapshot cache instead of inventing a second embedded-only fallback.

## 3. Non-Goals

- Redesign inspector submit timing or remove blur-based commits.
- Change host selection authority or introduce local optimistic document writes.
- Rework unrelated sidebar activation or graph selection flows.

## 4. Current Behavior

- Embedded inspector uses `useInspectorPaneState()` and can read a cached node snapshot when
  `selectedNodeSnapshot` is temporarily unavailable.
- The cache is populated by the sidebar host bridge, but not by the embedded app host bridge.
- After an embedded field blur triggers `updateNode`, the next committed snapshot round-trip can leave
  `selectedNodeRef` present with no live snapshot.
- `InspectorPane` then enters `node-pending`, renders the loading skeleton, and remounts the form.

## 5. Proposed Behavior

- The embedded app host bridge stores the current selected node snapshot into the shared inspector
  snapshot cache after `init` and `documentSnapshotChanged`, mirroring sidebar behavior.
- When the host reasserts the same logical node selection during a blur commit, `useInspectorPaneState()`
  resolves the cached snapshot and keeps the pane in `node` mode instead of dropping to
  `node-pending`.
- The committed snapshot still overwrites the cached fallback once it is restored.

## 6. Design

- Add a small helper in `inspector-node-snapshot-cache.ts` that stores the current selection snapshot
  when a file path, `selectedNodeRef`, and `selectedNodeSnapshot` are all present.
- Call that helper from both the embedded app host bridge and the sidebar host bridge so the cache
  contract is shared.
- Add a regression test that proves the helper stores a snapshot which can later be rebound to the
  same logical node identity.

## 7. Implementation Plan

1. Share the “remember current selection snapshot” helper across inspector entrypoints.
   Exit criteria: embedded and sidebar bridges both call the same helper after host-driven init and
   document snapshot application.
2. Add regression coverage for the cache write path.
   Exit criteria: shared tests confirm the helper stores a selection snapshot that can be reused for a
   later ref with the same logical identity.

## 8. Testing Plan

- Extend shared editor-state tests around inspector snapshot caching.
- Run the shared test suite or the narrow repository command that covers shared tests.

## 9. Acceptance Criteria

- In embedded mode, blurring one node field and clicking the next field does not force Inspector into
  the loading skeleton when the host keeps the same logical node selected.
- The inspector snapshot cache is populated by both sidebar and embedded host bridges.
- A regression test covers the shared helper that writes the cached selection snapshot.

## 10. Risks and Rollback

- Risk: caching the wrong selection state could show stale node data for a different logical node.
  Mitigation: reuse the existing same-logical-node identity checks when resolving cached snapshots.
- Rollback: remove the embedded cache write path and fall back to the previous `node-pending`
  behavior.
