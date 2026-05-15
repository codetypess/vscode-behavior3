import assert from "node:assert/strict";
import { applySharedSelectionState } from "../../src/editor-session/session/selection-state";
import {
    expandCollapsedAncestorsForNode,
    getVisibleChildKeys,
    pruneCollapsedNodeRefs,
    toggleCollapsedNodeRefs,
} from "../../webview/adapters/graph/graph-collapse-state";
import { eventHasShapeClass } from "../../webview/adapters/graph/graph-event-shape";
import { canOpenSubtreeTarget } from "../../webview/domain/subtree-navigation";
import {
    cloneInspectorNodeSnapshotForRef,
    resolveCachedInspectorNodeSnapshot,
} from "../../webview/features/inspector/inspector-node-snapshot-cache";
import { getInspectorPaneMode } from "../../webview/features/inspector/inspector-pane-mode";
import type { NodeInstanceRef } from "../../webview/shared/contracts";
import { parseWorkdirRelativeJsonPath } from "../../webview/shared/protocol";
import { defineSharedTests } from "../shared-test-types";

export const editorStateSharedTests = defineSharedTests([
        {
            name: "detects whether a node can open its subtree target",
            run() {
                assert.equal(canOpenSubtreeTarget("sub/tree.json", null), true);
                assert.equal(
                    canOpenSubtreeTarget(undefined, {
                        subtreeStack: [parseWorkdirRelativeJsonPath("sub/tree.json")!],
                    }),
                    true
                );
                assert.equal(canOpenSubtreeTarget(undefined, { subtreeStack: [] }), false);
                assert.equal(canOpenSubtreeTarget(undefined, null), false);
            },
        },
        {
            name: "keeps inspector in node mode while a host-selected node snapshot is still pending",
            run() {
                const pendingNodeRef: NodeInstanceRef = {
                    instanceKey: "2",
                    displayId: "2",
                    structuralStableId: "child",
                    sourceStableId: "child",
                    sourceTreePath: null,
                    subtreeStack: [],
                };

                assert.equal(
                    getInspectorPaneMode({
                        documentPresent: false,
                        selectedNodeRef: null,
                        selectedNode: null,
                    }),
                    "skeleton"
                );
                assert.equal(
                    getInspectorPaneMode({
                        documentPresent: true,
                        selectedNodeRef: null,
                        selectedNode: null,
                    }),
                    "tree"
                );
                assert.equal(
                    getInspectorPaneMode({
                        documentPresent: true,
                        selectedNodeRef: pendingNodeRef,
                        selectedNode: null,
                    }),
                    "node-pending"
                );
                assert.equal(
                    getInspectorPaneMode({
                        documentPresent: true,
                        selectedNodeRef: pendingNodeRef,
                        selectedNode: {
                            ref: pendingNodeRef,
                            data: {
                                uuid: "child",
                                id: "2",
                                name: "Action",
                            },
                            prefix: "",
                            activeChildCount: 0,
                            disabled: false,
                            subtreeNode: false,
                            subtreeEditable: true,
                        },
                    }),
                    "node"
                );
            },
        },
        {
            name: "reuses cached inspector node snapshots only for the same logical node identity",
            run() {
                const cachedRef: NodeInstanceRef = {
                    instanceKey: "5",
                    displayId: "5",
                    structuralStableId: "child",
                    sourceStableId: "child",
                    sourceTreePath: null,
                    subtreeStack: [],
                };
                const nextRef: NodeInstanceRef = {
                    ...cachedRef,
                    instanceKey: "12",
                    displayId: "12",
                };
                const cachedSnapshot = {
                    ref: cachedRef,
                    data: {
                        uuid: "child",
                        id: "5",
                        name: "Action",
                    },
                    prefix: "",
                    activeChildCount: 0,
                    disabled: false,
                    subtreeNode: false,
                    subtreeEditable: true,
                };

                assert.deepEqual(
                    resolveCachedInspectorNodeSnapshot(
                        {
                            ref: cachedRef,
                            snapshot: cachedSnapshot,
                        },
                        nextRef
                    ),
                    cloneInspectorNodeSnapshotForRef(cachedSnapshot, nextRef)
                );
                assert.equal(
                    resolveCachedInspectorNodeSnapshot(
                        {
                            ref: cachedRef,
                            snapshot: cachedSnapshot,
                        },
                        {
                            ...nextRef,
                            structuralStableId: "other-child",
                        }
                    ),
                    null
                );
            },
        },
        {
            name: "keeps graph-local collapsed refs by stable identity and hides collapsed children",
            run() {
                const rootRef: NodeInstanceRef = {
                    instanceKey: "root-v1",
                    displayId: "1",
                    structuralStableId: "root",
                    sourceStableId: "root",
                    sourceTreePath: null,
                    subtreeStack: [],
                };
                const childRef: NodeInstanceRef = {
                    instanceKey: "child-v1",
                    displayId: "2",
                    structuralStableId: "child",
                    sourceStableId: "child",
                    sourceTreePath: null,
                    subtreeStack: [],
                };
                const removedRef: NodeInstanceRef = {
                    instanceKey: "gone-v1",
                    displayId: "3",
                    structuralStableId: "gone",
                    sourceStableId: "gone",
                    sourceTreePath: null,
                    subtreeStack: [],
                };

                const collapsed = toggleCollapsedNodeRefs([removedRef], rootRef);
                assert.deepEqual(
                    getVisibleChildKeys(
                        {
                            ref: rootRef,
                            childKeys: [childRef.instanceKey],
                        } as any,
                        collapsed
                    ),
                    []
                );

                const reboundModel = {
                    rootKey: "root-v2",
                    nodes: [
                        {
                            ref: {
                                ...rootRef,
                                instanceKey: "root-v2",
                            },
                        },
                        {
                            ref: {
                                ...childRef,
                                instanceKey: "child-v2",
                            },
                        },
                    ],
                    edges: [],
                } as any;

                assert.deepEqual(pruneCollapsedNodeRefs(collapsed, reboundModel), [rootRef]);
                assert.deepEqual(toggleCollapsedNodeRefs(collapsed, rootRef), [removedRef]);
            },
        },
        {
            name: "matches graph shape classes through composite badge ancestry",
            run() {
                const badgeText = {
                    className: "text",
                    parentElement: {
                        className: "label",
                        parentElement: {
                            className: "collapse",
                            parentElement: null,
                        },
                    },
                };

                assert.equal(eventHasShapeClass({ originalTarget: badgeText }, "collapse"), true);
                assert.equal(
                    eventHasShapeClass({ originalTarget: badgeText }, "input-text"),
                    false
                );
                assert.equal(
                    eventHasShapeClass(
                        {
                            originalTarget: {
                                className: "input-text",
                                parentElement: null,
                            },
                        },
                        "input-text"
                    ),
                    true
                );
            },
        },
        {
            name: "expands collapsed ancestors for hidden search targets",
            run() {
                const rootRef: NodeInstanceRef = {
                    instanceKey: "root-v1",
                    displayId: "1",
                    structuralStableId: "root",
                    sourceStableId: "root",
                    sourceTreePath: null,
                    subtreeStack: [],
                };
                const branchRef: NodeInstanceRef = {
                    instanceKey: "branch-v1",
                    displayId: "2",
                    structuralStableId: "branch",
                    sourceStableId: "branch",
                    sourceTreePath: null,
                    subtreeStack: [],
                };
                const targetRef: NodeInstanceRef = {
                    instanceKey: "target-v1",
                    displayId: "3",
                    structuralStableId: "target",
                    sourceStableId: "target",
                    sourceTreePath: null,
                    subtreeStack: [],
                };
                const unrelatedRef: NodeInstanceRef = {
                    instanceKey: "other-v1",
                    displayId: "9",
                    structuralStableId: "other",
                    sourceStableId: "other",
                    sourceTreePath: null,
                    subtreeStack: [],
                };

                const model = {
                    nodes: [
                        { ref: rootRef, parentKey: null },
                        { ref: branchRef, parentKey: rootRef.instanceKey },
                        { ref: targetRef, parentKey: branchRef.instanceKey },
                        { ref: unrelatedRef, parentKey: null },
                    ],
                } as any;

                assert.deepEqual(
                    expandCollapsedAncestorsForNode(
                        [rootRef, branchRef, unrelatedRef],
                        model,
                        targetRef.instanceKey
                    ),
                    [unrelatedRef]
                );
            },
        },
        {
            name: "reasserts equal shared node selection without changing selection payload",
            run() {
                const currentSelection: NodeInstanceRef = {
                    instanceKey: "child",
                    displayId: "2",
                    structuralStableId: "child",
                    sourceStableId: "child",
                    sourceTreePath: null,
                    subtreeStack: [],
                };

                const changed = applySharedSelectionState(
                    { kind: "tree" },
                    { kind: "node", ref: currentSelection }
                );
                assert.equal(changed.result, "changed");
                assert.deepEqual(changed.selection, {
                    kind: "node",
                    ref: currentSelection,
                });

                const reasserted = applySharedSelectionState(
                    changed.selection,
                    { kind: "node", ref: currentSelection },
                    { reassertIfEqual: true }
                );
                assert.equal(reasserted.result, "reasserted");
                assert.deepEqual(reasserted.selection, changed.selection);

                const noop = applySharedSelectionState(changed.selection, {
                    kind: "node",
                    ref: currentSelection,
                });
                assert.equal(noop.result, "noop");
                assert.deepEqual(noop.selection, changed.selection);
            },
        },
        {
            name: "reasserts equal shared tree selection without changing selection payload",
            run() {
                const reasserted = applySharedSelectionState(
                    { kind: "tree" },
                    { kind: "tree" },
                    { reassertIfEqual: true }
                );
                assert.equal(reasserted.result, "reasserted");
                assert.deepEqual(reasserted.selection, { kind: "tree" });
            },
        },
]);
