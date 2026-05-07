# Graph Resize Viewport Stability

Status: Verifying
Date: 2026-05-07
Scope: Keep graph viewport stable while resizing the inspector sidebar

## Context

When the inspector sidebar width changes, the graph canvas also resizes. If the graph is already zoomed or panned, the current resize path can make the visible nodes jump.

## Goals

- Preserve the current graph viewport during sidebar resize.
- Keep the visible content anchored instead of drifting when zoom is active.

## Non-Goals

- Changing graph layout or zoom semantics.
- Adding new user controls for resize anchoring.

## Current Behavior

- `ResizeObserver` captures the last viewport and reapplies it after `graph.resize()`.
- With a non-default zoom, that restoration can move the graph unexpectedly.

## Proposed Behavior

- On resize, preserve both the current viewport and a stable visual anchor.
- Reapply the stored viewport after resize, then compensate so the anchor stays at the same screen position.

## Design

- Reuse the graph adapter's existing viewport-anchor model instead of introducing a separate resize-only coordinate system.
- Capture the center-nearest visible node anchor before `graph.resize()`.
- After resize, restore the requested viewport first, then apply anchor compensation so the same content stays visually stable.

## Implementation Plan

- Update the resize restore path in `g6-graph-adapter.ts` to carry a `ViewportAnchor`.
- Reuse `applyAnchorViewportCompensation()` after resize viewport restoration.
- Keep the rest of the graph render, focus, and wheel-zoom paths unchanged.

## Testing Plan

- Run `npm run build`.
- Run `npm run test:shared`.
- Manually verify in VS Code that resizing the inspector while zoomed no longer makes nodes jump.

## Acceptance Criteria

- Dragging the inspector width while the graph is zoomed does not cause the nodes to jump.
- The graph keeps its visible center stable across resize.

## Risks and Rollback

- Resize events can fire rapidly while the user drags the split handle, so the restore path must stay cancellable and lightweight.
- If the anchor compensation introduces new drift, rollback should revert only the resize restore path and keep the spec baseline update for follow-up debugging.
