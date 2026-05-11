import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hostProtocolSharedTests } from "./shared-tests/host-protocol-shared-tests";
import { hostRequestSpecSharedTests } from "./shared-tests/host-request-spec-shared-tests";
import { inspectorSharedTests } from "./shared-tests/inspector-shared-tests";
import { nodeDefinitionSlotUtilsSharedTests } from "./shared-tests/node-definition-slot-utils-shared-tests";
import { runtimeI18nSharedTests } from "./shared-tests/runtime-i18n-shared-tests";
import { sessionFileVersionSharedTests } from "./shared-tests/session-file-version-shared-tests";
import { defineSharedTests, registerSharedTestSuites } from "./shared-test-types";
import { createAppHooksStore } from "../webview/shared/antd";
import { createEditorController } from "../webview/commands/create-editor-controller";
import { createDocumentStore, showDocumentReloadConflict } from "../webview/stores/document-store";
import { createGraphUiStore } from "../webview/stores/graph-ui-store";
import { createSelectionStore } from "../webview/stores/selection-store";
import { createWorkspaceStore } from "../webview/stores/workspace-store";
import {
    batchProcessBehaviorProject,
    buildBehaviorProject,
    resolveBehaviorBuildPaths,
} from "../src/build/build-cli";
import { DocumentSessionState } from "../src/editor-session/document-session-state";
import { applySharedSelectionState } from "../src/editor-session/session-selection";
import {
    getVisibleChildKeys,
    expandCollapsedAncestorsForNode,
    pruneCollapsedNodeRefs,
    toggleCollapsedNodeRefs,
} from "../webview/adapters/graph/graph-collapse-state";
import { eventHasShapeClass } from "../webview/adapters/graph/graph-event-shape";
import { handleNativeWheelZoom } from "../webview/adapters/graph/g6-wheel-zoom";
import { buildResolvedGraphModel } from "../webview/domain/graph-selectors";
import { resolveDocumentGraph } from "../webview/domain/resolve-graph";
import { canOpenSubtreeTarget } from "../webview/domain/subtree-navigation";
import { collectResolvedNodeDiagnostics, validateNodeArgValue } from "../webview/shared/validation";
import {
    cloneInspectorNodeSnapshotForRef,
    resolveCachedInspectorNodeSnapshot,
} from "../webview/features/inspector/inspector-node-snapshot-cache";
import { getInspectorPaneMode } from "../webview/features/inspector/inspector-pane-mode";
import { createNodeDefMap } from "../webview/shared/node-utils";
import { buildTreeInspectorVariableUsageCount } from "../webview/features/inspector/inspector-variable-options";
import {
    preparePersistedTreeForMainDocumentSave,
    serializePersistedTreeForMainDocumentSave,
} from "../webview/domain/main-document-save";
import { reduceDocumentMutation } from "../webview/shared/document";
import { parseNodeDefsContent, parseWorkspaceModelContent } from "../webview/shared/schema";
import { materializePersistedTree } from "../webview/shared/tree-materializer";
import {
    collectTransitivePaths,
    loadSubtreeSourceCache,
    parsePersistedTreeContent,
    pruneStaleSubtreeOverrides,
    serializePersistedTree,
} from "../webview/shared/tree";
import { parseWorkdirRelativeJsonPath } from "../webview/shared/protocol";
import { loadRuntimeModule } from "../webview/shared/b3build";
import type { GraphAdapter } from "../webview/shared/graph-contracts";
import type {
    DocumentMutation,
    GraphHighlightState,
    HostAdapter,
    NodeDef,
    NodeInstanceRef,
    PersistedTreeModel,
} from "../webview/shared/contracts";

const createTestTree = (): PersistedTreeModel => ({
    version: "2.0.0",
    name: "main",
    prefix: "",
    export: true,
    group: [],
    variables: {
        imports: [],
        locals: [],
    },
    custom: {},
    overrides: {},
    root: {
        uuid: "root",
        id: "1",
        name: "Sequence",
        children: [],
    },
});

const tests = registerSharedTestSuites(
    inspectorSharedTests,
    hostProtocolSharedTests,
    hostRequestSpecSharedTests,
    nodeDefinitionSlotUtilsSharedTests,
    runtimeI18nSharedTests,
    sessionFileVersionSharedTests,
    defineSharedTests([
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
        {
            name: "replays host document session undo and redo from snapshot history",
            run() {
                const session = new DocumentSessionState({ initialContent: "A" });

                assert.equal(session.applyCommittedSnapshot("B"), true);
                assert.equal(session.applyCommittedSnapshot("C"), true);
                assert.equal(session.canUndo(), true);
                assert.equal(session.canRedo(), false);
                assert.equal(session.undo(), "B");
                assert.deepEqual(session.getSnapshot(), {
                    dirty: true,
                    historyIndex: 1,
                    historyLength: 3,
                    lastSavedSnapshot: "A",
                    alertReload: false,
                    pendingExternalContent: null,
                });
                assert.equal(session.canRedo(), true);
                assert.equal(session.redo(), "C");
                assert.equal(session.getCurrentSnapshot(), "C");
            },
        },
        {
            name: "clears host document dirty when undo returns to the saved snapshot",
            run() {
                const session = new DocumentSessionState({ initialContent: "A" });

                session.applyCommittedSnapshot("B");
                session.markSaved("B");
                session.applyCommittedSnapshot("C");
                session.showReloadConflict("disk");

                assert.equal(session.undo(), "B");
                assert.deepEqual(session.getSnapshot(), {
                    dirty: false,
                    historyIndex: 1,
                    historyLength: 3,
                    lastSavedSnapshot: "B",
                    alertReload: false,
                    pendingExternalContent: null,
                });
            },
        },
        {
            name: "replaces current host history snapshot when save normalizes content",
            run() {
                const session = new DocumentSessionState({ initialContent: "A" });

                session.applyCommittedSnapshot("B");
                session.markSaved("B*");

                assert.equal(session.undo(), "A");
                assert.equal(session.redo(), "B*");
                assert.deepEqual(session.getSnapshot(), {
                    dirty: false,
                    historyIndex: 1,
                    historyLength: 2,
                    lastSavedSnapshot: "B*",
                    alertReload: false,
                    pendingExternalContent: null,
                });
            },
        },
        {
            name: "prunes stale subtree overrides when reachable subtree graph is complete",
            run() {
                const linkedPath = parseWorkdirRelativeJsonPath("sub/tree.json");
                assert.ok(linkedPath);

                const tree = createTestTree();
                tree.root.children = [
                    {
                        uuid: "link-root",
                        id: "2",
                        name: "LinkNode",
                        path: linkedPath,
                    },
                ];
                tree.overrides = {
                    "sub-child": { desc: "keep" },
                    stale: { desc: "drop" },
                };

                const subtree: PersistedTreeModel = {
                    version: "2.0.0",
                    name: "tree",
                    prefix: "",
                    export: true,
                    group: [],
                    variables: {
                        imports: [],
                        locals: [],
                    },
                    custom: {},
                    overrides: {},
                    root: {
                        uuid: "sub-root",
                        id: "1",
                        name: "Sequence",
                        children: [
                            {
                                uuid: "sub-child",
                                id: "2",
                                name: "Action",
                            },
                        ],
                    },
                };

                const changed = pruneStaleSubtreeOverrides({
                    tree,
                    subtreeSources: {
                        [linkedPath]: subtree,
                    } as any,
                });

                assert.equal(changed, true);
                assert.deepEqual(tree.overrides, {
                    "sub-child": { desc: "keep" },
                });
            },
        },
        {
            name: "keeps subtree overrides when reachable subtree graph is incomplete",
            run() {
                const linkedPath = parseWorkdirRelativeJsonPath("sub/tree.json");
                assert.ok(linkedPath);

                const tree = createTestTree();
                tree.root.children = [
                    {
                        uuid: "link-root",
                        id: "2",
                        name: "LinkNode",
                        path: linkedPath,
                    },
                ];
                tree.overrides = {
                    "sub-child": { desc: "keep" },
                    stale: { desc: "keep-too" },
                };

                const changed = pruneStaleSubtreeOverrides({
                    tree,
                    subtreeSources: {
                        [linkedPath]: null,
                    } as any,
                });

                assert.equal(changed, false);
                assert.deepEqual(tree.overrides, {
                    "sub-child": { desc: "keep" },
                    stale: { desc: "keep-too" },
                });
            },
        },
        {
            name: "writes current main-tree display ids during main-document save serialization",
            async run() {
                const linkedPath = parseWorkdirRelativeJsonPath("sub/tree.json");
                assert.ok(linkedPath);
                const tree: PersistedTreeModel = {
                    version: "2.0.0",
                    name: "main",
                    prefix: "",
                    export: true,
                    group: [],
                    variables: {
                        imports: [],
                        locals: [],
                    },
                    custom: {},
                    overrides: {},
                    root: {
                        uuid: "root",
                        id: "1",
                        name: "Sequence",
                        children: [
                            {
                                uuid: "child-1",
                                id: "",
                                name: "ActionA",
                                children: [],
                            },
                            {
                                uuid: "child-2",
                                id: "",
                                name: "LinkNode",
                                path: linkedPath,
                                children: [],
                            },
                        ],
                    },
                };

                const subtree = serializePersistedTree({
                    version: "2.0.0",
                    name: "tree",
                    prefix: "",
                    export: true,
                    group: [],
                    variables: {
                        imports: [],
                        locals: [],
                    },
                    custom: {},
                    overrides: {},
                    root: {
                        uuid: "sub-root",
                        id: "1",
                        name: "SubSequence",
                        children: [
                            {
                                uuid: "sub-child",
                                id: "2",
                                name: "SubAction",
                            },
                        ],
                    },
                });

                const content = await serializePersistedTreeForMainDocumentSave({
                    tree,
                    nodeDefs: [
                        {
                            name: "Sequence",
                            type: "Composite",
                            desc: "",
                            status: ["success"],
                        },
                        {
                            name: "ActionA",
                            type: "Action",
                            desc: "",
                        },
                        {
                            name: "LinkNode",
                            type: "Action",
                            desc: "",
                        },
                        {
                            name: "SubSequence",
                            type: "Composite",
                            desc: "",
                            status: ["success"],
                        },
                        {
                            name: "SubAction",
                            type: "Action",
                            desc: "",
                        },
                    ],
                    readSubtreeContent: async (path) => {
                        assert.equal(path, "sub/tree.json");
                        return subtree;
                    },
                });
                const savedJson = JSON.parse(content) as {
                    root: {
                        children?: Array<{
                            children?: unknown[];
                        }>;
                    };
                };

                const savedTree = parsePersistedTreeContent(content, "/tmp/main.json");
                assert.equal(savedTree.root.children?.[0]?.id, "2");
                assert.equal(savedTree.root.children?.[1]?.id, "3");
                assert.equal(savedJson.root.children?.[0]?.children, undefined);
                assert.equal(savedTree.root.children?.[1]?.children, undefined);
            },
        },
        {
            name: "prunes stale subtree overrides during main-document save serialization",
            async run() {
                const tree = createTestTree();
                tree.overrides = {
                    orphaned: {
                        desc: "stale",
                    },
                };

                const content = await serializePersistedTreeForMainDocumentSave({
                    tree,
                    nodeDefs: [],
                    readSubtreeContent: async () => {
                        throw new Error("save should not read subtree content when no subtree links exist");
                    },
                });

                const savedTree = parsePersistedTreeContent(content, "/tmp/main.json");
                assert.deepEqual(savedTree.overrides, {});
            },
        },
        {
            name: "omits empty children arrays during persisted tree serialization",
            run() {
                const tree = createTestTree();
                tree.root.children = [
                    {
                        uuid: "leaf",
                        id: "2",
                        name: "LeafAction",
                        children: [],
                    },
                    {
                        uuid: "branch",
                        id: "3",
                        name: "Sequence",
                        children: [
                            {
                                uuid: "grandchild",
                                id: "4",
                                name: "NestedAction",
                                children: [],
                            },
                        ],
                    },
                ];

                const serializedTree = JSON.parse(serializePersistedTree(tree)) as {
                    root: {
                        children?: Array<{
                            children?: unknown[];
                        }>;
                    };
                };
                const branchChildren = serializedTree.root.children?.[1]?.children as
                    | Array<{ children?: unknown[] }>
                    | undefined;

                assert.equal(Array.isArray(serializedTree.root.children), true);
                assert.equal(serializedTree.root.children?.[0]?.children, undefined);
                assert.equal(Array.isArray(serializedTree.root.children?.[1]?.children), true);
                assert.equal(branchChildren?.[0]?.children, undefined);
            },
        },
        {
            name: "stages legacy subtree normalization for main document save",
            async run() {
                const linkedPath = parseWorkdirRelativeJsonPath("sub/tree.json");
                assert.ok(linkedPath);
                const tree: PersistedTreeModel = {
                    version: "2.0.0",
                    name: "main",
                    prefix: "",
                    export: true,
                    group: [],
                    variables: {
                        imports: [],
                        locals: [],
                    },
                    custom: {},
                    overrides: {},
                    root: {
                        uuid: "root",
                        id: "1",
                        name: "Sequence",
                        children: [
                            {
                                uuid: "child",
                                id: "2",
                                name: "LinkNode",
                                path: linkedPath,
                            },
                        ],
                    },
                };
                const legacySubtree = JSON.stringify({
                    version: "2.0.0",
                    name: "tree",
                    prefix: "",
                    export: true,
                    group: [],
                    variables: {
                        imports: [],
                        locals: [],
                    },
                    custom: {},
                    overrides: {},
                    root: {
                        id: "1",
                        name: "SubSequence",
                        children: [
                            {
                                id: "2",
                                name: "SubAction",
                            },
                        ],
                    },
                });

                const buildPlan = () =>
                    preparePersistedTreeForMainDocumentSave({
                        tree,
                        nodeDefs: [
                            {
                                name: "Sequence",
                                type: "Composite",
                                desc: "",
                                status: ["success"],
                            },
                            {
                                name: "LinkNode",
                                type: "Action",
                                desc: "",
                            },
                            {
                                name: "SubSequence",
                                type: "Composite",
                                desc: "",
                                status: ["success"],
                            },
                            {
                                name: "SubAction",
                                type: "Action",
                                desc: "",
                            },
                        ],
                        readSubtreeContent: async (path) => {
                            assert.equal(path, linkedPath);
                            return legacySubtree;
                        },
                    });

                const firstPlan = await buildPlan();
                const secondPlan = await buildPlan();

                assert.equal(firstPlan.subtreeWritebacks.length, 1);
                assert.equal(firstPlan.subtreeWritebacks[0]?.path, linkedPath);
                assert.equal(
                    firstPlan.subtreeWritebacks[0]?.content,
                    secondPlan.subtreeWritebacks[0]?.content
                );

                const normalizedSubtree = parsePersistedTreeContent(
                    firstPlan.subtreeWritebacks[0]!.content,
                    linkedPath
                );
                assert.ok(normalizedSubtree.root.uuid);
                assert.ok(normalizedSubtree.root.children?.[0]?.uuid);
            },
        },
        {
            name: "reduces tree meta mutations in shared host reducer",
            run() {
                const tree = createTestTree();
                const result = reduceDocumentMutation(
                    {
                        type: "updateTreeMeta",
                        payload: {
                            desc: "updated",
                            prefix: "BT",
                            export: true,
                            group: ["combat"],
                            variables: {
                                imports: ["vars/b.json", "vars/a.json"],
                                locals: [
                                    { name: "zeta", desc: "Z" },
                                    { name: "alpha", desc: "A" },
                                ],
                            },
                        },
                    },
                    {
                        tree,
                        nodeDefs: [],
                    }
                );

                assert.equal(result.status, "changed");
                if (result.status !== "changed") {
                    return;
                }

                assert.equal(result.rebuildGraph, true);
                assert.deepEqual(result.tree.variables.imports, ["vars/a.json", "vars/b.json"]);
                assert.deepEqual(
                    result.tree.variables.locals.map((entry) => entry.name),
                    ["alpha", "zeta"]
                );
            },
        },
        {
            name: "reduces tree custom metadata mutations without rebuilding graph",
            run() {
                const tree = createTestTree();
                tree.custom = {
                    legacy: "keep",
                };

                const result = reduceDocumentMutation(
                    {
                        type: "updateTreeMeta",
                        payload: {
                            desc: tree.desc,
                            prefix: tree.prefix,
                            export: tree.export,
                            group: [...tree.group],
                            custom: {
                                label: "hero",
                                enabled: true,
                                threshold: 3,
                            },
                            variables: {
                                imports: [...tree.variables.imports],
                                locals: tree.variables.locals.map((entry) => ({ ...entry })),
                            },
                        },
                    },
                    {
                        tree,
                        nodeDefs: [],
                    }
                );

                assert.equal(result.status, "changed");
                if (result.status !== "changed") {
                    return;
                }

                assert.equal(result.rebuildGraph, false);
                assert.deepEqual(result.tree.custom, {
                    label: "hero",
                    enabled: true,
                    threshold: 3,
                });
            },
        },
        {
            name: "reduces subtree override node mutations in shared host reducer",
            run() {
                const tree = createTestTree();
                const nodeDefs: NodeDef[] = [
                    {
                        name: "Wait",
                        type: "Action",
                        desc: "",
                        args: [{ name: "time", type: "int", desc: "" }],
                    },
                ];

                const result = reduceDocumentMutation(
                    {
                        type: "updateNode",
                        payload: {
                            target: {
                                instanceKey: "node-1",
                                displayId: "2",
                                structuralStableId: "sub-node",
                                sourceStableId: "sub-node",
                                sourceTreePath: "subtree/child.json" as any,
                                subtreeStack: [],
                            },
                            data: {
                                name: "Wait",
                                args: { time: 2 },
                            },
                            currentNodeSnapshot: {
                                data: {
                                    uuid: "sub-node",
                                    id: "2",
                                    name: "Wait",
                                    args: { time: 1 },
                                },
                                subtreeNode: true,
                                subtreeOriginal: {
                                    uuid: "sub-node",
                                    id: "2",
                                    name: "Wait",
                                    args: { time: 1 },
                                },
                            },
                        },
                    },
                    {
                        tree,
                        nodeDefs,
                    }
                );

                assert.equal(result.status, "changed");
                if (result.status !== "changed") {
                    return;
                }

                assert.deepEqual(result.tree.overrides["sub-node"], {
                    args: { time: 2 },
                });
            },
        },
        {
            name: "does not persist default-only subtree args into overrides",
            run() {
                const tree = createTestTree();
                const nodeDefs: NodeDef[] = [
                    {
                        name: "TryLaunchSkill",
                        type: "Action",
                        desc: "",
                        args: [
                            {
                                name: "skip_cd",
                                type: "bool?",
                                desc: "",
                                default: false,
                            },
                        ],
                    },
                ];

                const result = reduceDocumentMutation(
                    {
                        type: "updateNode",
                        payload: {
                            target: {
                                instanceKey: "node-1",
                                displayId: "2",
                                structuralStableId: "sub-node",
                                sourceStableId: "sub-node",
                                sourceTreePath: "subtree/child.json" as any,
                                subtreeStack: [],
                            },
                            data: {
                                name: "TryLaunchSkill",
                                desc: "updated",
                                args: { skip_cd: false },
                            },
                            currentNodeSnapshot: {
                                data: {
                                    uuid: "sub-node",
                                    id: "2",
                                    name: "TryLaunchSkill",
                                    desc: "",
                                    args: { skip_cd: false },
                                },
                                subtreeNode: true,
                                subtreeOriginal: {
                                    uuid: "sub-node",
                                    id: "2",
                                    name: "TryLaunchSkill",
                                    desc: "",
                                    args: { skip_cd: false },
                                },
                            },
                        },
                    },
                    {
                        tree,
                        nodeDefs,
                    }
                );

                assert.equal(result.status, "changed");
                if (result.status !== "changed") {
                    return;
                }

                assert.deepEqual(result.tree.overrides["sub-node"], {
                    desc: "updated",
                });
            },
        },
        {
            name: "reduces subtree detach mutations in shared host reducer",
            run() {
                const tree = createTestTree();
                tree.root.children = [
                    {
                        uuid: "sub-root",
                        id: "2",
                        name: "SubtreeRef",
                        path: "subtree/child.json" as any,
                    },
                ];

                const result = reduceDocumentMutation(
                    {
                        type: "updateNode",
                        payload: {
                            target: {
                                instanceKey: "node-1",
                                displayId: "2",
                                structuralStableId: "sub-root",
                                sourceStableId: "sub-root",
                                sourceTreePath: null,
                                subtreeStack: [],
                            },
                            data: {
                                name: "Sequence",
                            },
                            currentNodeSnapshot: {
                                data: {
                                    uuid: "sub-root",
                                    id: "2",
                                    name: "SubtreeRef",
                                    path: "subtree/child.json" as any,
                                },
                                subtreeNode: false,
                            },
                            detachedSubtreeRoot: {
                                uuid: "sub-root",
                                id: "2",
                                name: "Sequence",
                                children: [
                                    {
                                        uuid: "leaf-1",
                                        id: "3",
                                        name: "ActionA",
                                    },
                                ],
                            },
                        },
                    },
                    {
                        tree,
                        nodeDefs: [],
                    }
                );

                assert.equal(result.status, "changed");
                if (result.status !== "changed") {
                    return;
                }

                const detached = result.tree.root.children?.[0];
                assert.equal(detached?.name, "Sequence");
                assert.equal(detached?.path, undefined);
                assert.equal(detached?.children?.[0]?.uuid, "leaf-1");
            },
        },
        {
            name: "reduces canvas insert and delete mutations in shared host reducer",
            run() {
                const tree = createTestTree();
                tree.root.children = [
                    {
                        uuid: "child-a",
                        id: "2",
                        name: "ActionA",
                    },
                ];

                const insertResult = reduceDocumentMutation(
                    {
                        type: "insertNode",
                        payload: {
                            target: {
                                instanceKey: "1",
                                displayId: "1",
                                structuralStableId: "root",
                                sourceStableId: "root",
                                sourceTreePath: null,
                                subtreeStack: [],
                            },
                        },
                    },
                    {
                        tree,
                        nodeDefs: [],
                    }
                );

                assert.equal(insertResult.status, "changed");
                if (insertResult.status !== "changed") {
                    return;
                }

                const inserted = insertResult.tree.root.children?.[1];
                assert.equal(inserted?.name, "unknown");
                assert.deepEqual(insertResult.nextSelection, {
                    kind: "node",
                    structuralStableId: inserted?.uuid,
                });

                const deleteResult = reduceDocumentMutation(
                    {
                        type: "deleteNode",
                        payload: {
                            target: {
                                instanceKey: "2",
                                displayId: "2",
                                structuralStableId: "child-a",
                                sourceStableId: "child-a",
                                sourceTreePath: null,
                                subtreeStack: [],
                            },
                        },
                    },
                    {
                        tree: insertResult.tree,
                        nodeDefs: [],
                    }
                );

                assert.equal(deleteResult.status, "changed");
                if (deleteResult.status !== "changed") {
                    return;
                }

                assert.equal(
                    deleteResult.tree.root.children?.some((node) => node.uuid === "child-a"),
                    false
                );
                assert.deepEqual(deleteResult.nextSelection, {
                    kind: "node",
                    structuralStableId: "root",
                });
            },
        },
        {
            name: "reduces canvas drop and paste mutations in shared host reducer",
            run() {
                const tree = createTestTree();
                tree.root.children = [
                    {
                        uuid: "child-a",
                        id: "2",
                        name: "ActionA",
                    },
                    {
                        uuid: "child-b",
                        id: "3",
                        name: "ActionB",
                    },
                ];

                const dropResult = reduceDocumentMutation(
                    {
                        type: "performDrop",
                        payload: {
                            source: {
                                instanceKey: "2",
                                displayId: "2",
                                structuralStableId: "child-a",
                                sourceStableId: "child-a",
                                sourceTreePath: null,
                                subtreeStack: [],
                            },
                            target: {
                                instanceKey: "3",
                                displayId: "3",
                                structuralStableId: "child-b",
                                sourceStableId: "child-b",
                                sourceTreePath: null,
                                subtreeStack: [],
                            },
                            position: "after",
                        },
                    },
                    {
                        tree,
                        nodeDefs: [],
                    }
                );

                assert.equal(dropResult.status, "changed");
                if (dropResult.status !== "changed") {
                    return;
                }

                assert.deepEqual(
                    dropResult.tree.root.children?.map((node) => node.uuid),
                    ["child-b", "child-a"]
                );
                assert.deepEqual(dropResult.nextSelection, {
                    kind: "node",
                    structuralStableId: "child-a",
                });

                const pasteResult = reduceDocumentMutation(
                    {
                        type: "pasteNode",
                        payload: {
                            target: {
                                instanceKey: "1",
                                displayId: "1",
                                structuralStableId: "root",
                                sourceStableId: "root",
                                sourceTreePath: null,
                                subtreeStack: [],
                            },
                            snapshot: {
                                uuid: "clip-root",
                                id: "9",
                                name: "ClipboardAction",
                                children: [
                                    {
                                        uuid: "clip-leaf",
                                        id: "10",
                                        name: "ClipboardLeaf",
                                    },
                                ],
                            },
                        },
                    },
                    {
                        tree: dropResult.tree,
                        nodeDefs: [],
                    }
                );

                assert.equal(pasteResult.status, "changed");
                if (pasteResult.status !== "changed") {
                    return;
                }

                const pasted = pasteResult.tree.root.children?.[2];
                assert.equal(pasted?.name, "ClipboardAction");
                assert.notEqual(pasted?.uuid, "clip-root");
                assert.notEqual(pasted?.children?.[0]?.uuid, "clip-leaf");
                assert.deepEqual(pasteResult.nextSelection, {
                    kind: "node",
                    structuralStableId: pasted?.uuid,
                });
            },
        },
        {
            name: "dispatches native wheel zoom callbacks",
            run() {
                const zoomCalls: Array<{ ratio: number; origin: [number, number] | undefined }> =
                    [];
                let prevented = 0;
                let stopped = 0;

                handleNativeWheelZoom({
                    event: {
                        deltaX: 0,
                        deltaY: -20,
                        preventDefault() {
                            prevented += 1;
                        },
                        stopPropagation() {
                            stopped += 1;
                        },
                    },
                    isEnabled: () => true,
                    getOrigin: () => [12, 24],
                    async zoomTo(ratio, origin) {
                        zoomCalls.push({ ratio, origin });
                    },
                });

                assert.equal(prevented, 1);
                assert.equal(stopped, 1);
                assert.equal(zoomCalls.length, 1);
                assert.equal(zoomCalls[0]?.ratio, 1.2);
                assert.deepEqual(zoomCalls[0]?.origin, [12, 24]);
            },
        },
        {
            name: "rejects unsafe tree import and subtree paths",
            run() {
                assert.throws(
                    () =>
                        parsePersistedTreeContent(
                            JSON.stringify({
                                version: "2.0.0",
                                name: "main",
                                prefix: "",
                                group: [],
                                variables: {
                                    imports: ["../vars.json"],
                                    locals: [],
                                },
                                custom: {},
                                overrides: {},
                                root: {
                                    uuid: "root",
                                    id: "1",
                                    name: "Sequence",
                                    children: [],
                                },
                            }),
                            "main.json"
                        ),
                    /workdir-relative .*json path/i
                );

                assert.throws(
                    () =>
                        parsePersistedTreeContent(
                            JSON.stringify({
                                version: "2.0.0",
                                name: "main",
                                prefix: "",
                                group: [],
                                variables: {
                                    imports: [],
                                    locals: [],
                                },
                                custom: {},
                                overrides: {},
                                root: {
                                    uuid: "root",
                                    id: "1",
                                    name: "Sequence",
                                    path: "/tmp/sub.json",
                                },
                            }),
                            "main.json"
                        ),
                    /workdir-relative .*json path/i
                );
            },
        },
        {
            name: "parses sample node config",
            run() {
                const defs = parseNodeDefsContent(
                    fs.readFileSync(
                        path.join(process.cwd(), "sample/node-config.b3-setting"),
                        "utf-8"
                    )
                );

                assert.equal(
                    defs.some((def) => def.name === "Attack"),
                    true
                );
                assert.equal(
                    defs
                        .find((def) => def.name === "TestB3")
                        ?.args?.find((arg) => arg.name === "open")?.type,
                    "bool"
                );
            },
        },
        {
            name: "parses workspace settings with node colors",
            run() {
                const workspace = parseWorkspaceModelContent(
                    JSON.stringify({
                        settings: {
                            checkExpr: true,
                            buildScript: "scripts/build.ts",
                            checkScripts: ["scripts/checkers/**/*.ts"],
                            nodeColors: {
                                Action: "#123456",
                            },
                        },
                    })
                );

                assert.equal(workspace.settings.checkExpr, true);
                assert.equal(workspace.settings.buildScript, "scripts/build.ts");
                assert.deepEqual(workspace.settings.checkScripts, ["scripts/checkers/**/*.ts"]);
                assert.equal(workspace.settings.nodeColors?.Action, "#123456");
            },
        },
        {
            name: "rejects invalid workspace check script patterns",
            run() {
                assert.throws(
                    () =>
                        parseWorkspaceModelContent(
                            JSON.stringify({
                                settings: {
                                    checkScripts: ["scripts/checkers/**/*.ts", ""],
                                },
                            })
                        ),
                    /workspace settings\.checkScripts\[1\] must be a non-empty string/
                );
            },
        },
        {
            name: "skips variable declaration checks when none are declared",
            run() {
                const graphModel = buildResolvedGraphModel(
                    {
                        rootKey: "1",
                        nodeOrder: ["1"],
                        nodesByInstanceKey: {
                            "1": {
                                ref: {
                                    instanceKey: "1",
                                    displayId: "1",
                                    structuralStableId: "root",
                                    sourceStableId: "root",
                                    sourceTreePath: null,
                                    subtreeStack: [],
                                },
                                parentKey: null,
                                childKeys: [],
                                depth: 0,
                                renderedIdLabel: "1",
                                name: "Clear",
                                output: ["context"],
                                subtreeNode: false,
                                subtreeEditable: true,
                            },
                        },
                    },
                    [{ name: "Clear", type: "Action", desc: "", output: ["variable"] }],
                    undefined,
                    {
                        usingVars: {},
                        usingGroups: null,
                        checkExpr: true,
                    }
                );

                assert.equal(graphModel.nodes[0]?.nodeStyleKind, "Action");

                const strictGraphModel = buildResolvedGraphModel(
                    {
                        rootKey: "1",
                        nodeOrder: ["1"],
                        nodesByInstanceKey: {
                            "1": {
                                ref: {
                                    instanceKey: "1",
                                    displayId: "1",
                                    structuralStableId: "root",
                                    sourceStableId: "root",
                                    sourceTreePath: null,
                                    subtreeStack: [],
                                },
                                parentKey: null,
                                childKeys: [],
                                depth: 0,
                                renderedIdLabel: "1",
                                name: "Clear",
                                output: ["context"],
                                subtreeNode: false,
                                subtreeEditable: true,
                            },
                        },
                    },
                    [{ name: "Clear", type: "Action", desc: "", output: ["variable"] }],
                    undefined,
                    {
                        usingVars: {
                            target: { name: "target", desc: "" },
                        },
                        usingGroups: null,
                        checkExpr: true,
                    }
                );

                assert.equal(strictGraphModel.nodes[0]?.nodeStyleKind, "Error");
            },
        },
        {
            name: "marks graph nodes with custom checker diagnostics as errors",
            run() {
                const graphModel = buildResolvedGraphModel(
                    {
                        rootKey: "1",
                        nodeOrder: ["1"],
                        nodesByInstanceKey: {
                            "1": {
                                ref: {
                                    instanceKey: "1",
                                    displayId: "1",
                                    structuralStableId: "root",
                                    sourceStableId: "root",
                                    sourceTreePath: null,
                                    subtreeStack: [],
                                },
                                parentKey: null,
                                childKeys: [],
                                depth: 0,
                                renderedIdLabel: "1",
                                name: "Wait",
                                args: { time: 0 },
                                subtreeNode: false,
                                subtreeEditable: true,
                            },
                        },
                    },
                    [
                        {
                            name: "Wait",
                            type: "Action",
                            desc: "",
                            args: [{ name: "time", type: "float", desc: "", checker: "positive" }],
                        },
                    ],
                    undefined,
                    {
                        usingVars: null,
                        usingGroups: null,
                        checkExpr: true,
                        nodeCheckDiagnostics: {
                            "1": [
                                {
                                    instanceKey: "1",
                                    argName: "time",
                                    checker: "positive",
                                    message: "must be greater than 0",
                                },
                            ],
                        },
                    }
                );

                assert.equal(graphModel.nodes[0]?.nodeStyleKind, "Error");
            },
        },
        {
            name: "marks graph nodes with missing required args as errors",
            run() {
                const graphModel = buildResolvedGraphModel(
                    {
                        rootKey: "1",
                        nodeOrder: ["1"],
                        nodesByInstanceKey: {
                            "1": {
                                ref: {
                                    instanceKey: "1",
                                    displayId: "1",
                                    structuralStableId: "root",
                                    sourceStableId: "root",
                                    sourceTreePath: null,
                                    subtreeStack: [],
                                },
                                parentKey: null,
                                childKeys: [],
                                depth: 0,
                                renderedIdLabel: "1",
                                name: "Wait",
                                args: {},
                                subtreeNode: false,
                                subtreeEditable: true,
                            },
                        },
                    },
                    [
                        {
                            name: "Wait",
                            type: "Action",
                            desc: "",
                            args: [{ name: "time", type: "float", desc: "时间" }],
                        },
                    ],
                    undefined,
                    {
                        usingVars: null,
                        usingGroups: null,
                        checkExpr: true,
                    }
                );

                assert.equal(graphModel.nodes[0]?.nodeStyleKind, "Error");
            },
        },
        {
            name: "collects shared validation diagnostics for graph nodes",
            run() {
                const diagnostics = collectResolvedNodeDiagnostics({
                    node: {
                        ref: {
                            instanceKey: "1",
                            displayId: "1",
                            structuralStableId: "root",
                            sourceStableId: "root",
                            sourceTreePath: null,
                            subtreeStack: [],
                        },
                        parentKey: null,
                        childKeys: [],
                        depth: 0,
                        renderedIdLabel: "1",
                        name: "Check",
                        input: ["missing"],
                        args: { expr: "missing > 0" },
                        subtreeNode: false,
                        subtreeEditable: true,
                    },
                    def: {
                        name: "Check",
                        type: "Condition",
                        desc: "",
                        input: ["target"],
                        args: [{ name: "expr", type: "expr", desc: "" }],
                    },
                    usingVars: {
                        target: { name: "target", desc: "" },
                    },
                    usingGroups: null,
                    checkExpr: false,
                });

                assert.equal(
                    diagnostics.some(
                        (entry) =>
                            entry.code === "undefined-variable" && entry.variable === "missing"
                    ),
                    true
                );
            },
        },
        {
            name: "collects required node arg diagnostics for missing values",
            run() {
                const diagnostics = collectResolvedNodeDiagnostics({
                    node: {
                        ref: {
                            instanceKey: "1",
                            displayId: "1",
                            structuralStableId: "root",
                            sourceStableId: "root",
                            sourceTreePath: null,
                            subtreeStack: [],
                        },
                        parentKey: null,
                        childKeys: [],
                        depth: 0,
                        renderedIdLabel: "1",
                        name: "Wait",
                        args: {},
                        subtreeNode: false,
                        subtreeEditable: true,
                    },
                    def: {
                        name: "Wait",
                        type: "Action",
                        desc: "",
                        args: [{ name: "time", type: "float", desc: "时间" }],
                    },
                    usingVars: null,
                    usingGroups: null,
                    checkExpr: true,
                });

                assert.equal(
                    diagnostics.some(
                        (entry) => entry.code === "required-arg" && entry.argName === "time"
                    ),
                    true
                );
            },
        },
        {
            name: "validates node arg scalar entries through shared validation",
            run() {
                const diagnostics = validateNodeArgValue({
                    arg: { name: "weights", type: "float[]?", desc: "Weights" },
                    value: [1, "bad"],
                    validateOptions: false,
                });

                assert.equal(diagnostics[0]?.code, "invalid-arg-value");
                assert.equal(
                    diagnostics[0]?.code === "invalid-arg-value"
                        ? diagnostics[0].expected
                        : undefined,
                    "number"
                );
            },
        },
        {
            name: "validates node arg options through shared validation",
            run() {
                const diagnostics = validateNodeArgValue({
                    arg: {
                        name: "mode",
                        type: "string",
                        desc: "Mode",
                        options: [{ source: [{ name: "A", value: "a" }] }],
                    },
                    value: "b",
                    args: { mode: "b" },
                });

                assert.equal(diagnostics[0]?.code, "invalid-arg-option");
            },
        },
        {
            name: "does not treat required bool false as missing",
            run() {
                const diagnostics = collectResolvedNodeDiagnostics({
                    node: {
                        ref: {
                            instanceKey: "1",
                            displayId: "1",
                            structuralStableId: "root",
                            sourceStableId: "root",
                            sourceTreePath: null,
                            subtreeStack: [],
                        },
                        parentKey: null,
                        childKeys: [],
                        depth: 0,
                        renderedIdLabel: "1",
                        name: "Flag",
                        args: { enabled: false },
                        subtreeNode: false,
                        subtreeEditable: true,
                    },
                    def: {
                        name: "Flag",
                        type: "Action",
                        desc: "",
                        args: [{ name: "enabled", type: "bool", desc: "启用" }],
                    },
                    usingVars: null,
                    usingGroups: null,
                    checkExpr: true,
                });

                assert.equal(
                    diagnostics.some((entry) => entry.code === "required-arg"),
                    false
                );
            },
        },
        {
            name: "normalizes legacy node $id and $override on open",
            run() {
                const tree = parsePersistedTreeContent(
                    JSON.stringify({
                        version: "2.0.0",
                        name: "legacy",
                        prefix: "",
                        group: [],
                        import: ["vars/legacy.json"],
                        vars: [{ name: "legacyVar", desc: "legacy variable" }],
                        custom: {},
                        $override: {
                            "legacy-leaf": {
                                desc: "from-legacy",
                            },
                        },
                        root: {
                            $id: "legacy-root",
                            id: "1",
                            name: "Sequence",
                            children: [
                                {
                                    $id: "legacy-leaf",
                                    id: "2",
                                    name: "Log",
                                },
                            ],
                        },
                    }),
                    "legacy.json"
                );

                assert.equal(tree.root.uuid, "legacy-root");
                assert.equal(tree.root.children?.[0]?.uuid, "legacy-leaf");
                assert.equal(tree.overrides["legacy-leaf"]?.desc, "from-legacy");
                assert.deepEqual(tree.variables.imports, ["vars/legacy.json"]);
                assert.deepEqual(tree.variables.locals, [
                    { name: "legacyVar", desc: "legacy variable" },
                ]);

                const serialized = serializePersistedTree(tree);
                const serializedTree = JSON.parse(serialized) as Record<string, unknown>;
                assert.match(serialized, /"uuid": "legacy-root"/);
                assert.match(serialized, /"overrides"/);
                assert.deepEqual(serializedTree.variables, {
                    imports: ["vars/legacy.json"],
                    locals: [{ name: "legacyVar", desc: "legacy variable" }],
                });
                assert.equal(serializedTree.import, undefined);
                assert.equal(serializedTree.vars, undefined);
                assert.doesNotMatch(serialized, /"\$id"/);
                assert.doesNotMatch(serialized, /"\$override"/);
            },
        },
        {
            name: "generates deterministic stable ids for legacy tree files",
            run() {
                const legacyContent = JSON.stringify({
                    version: "2.0.0",
                    name: "legacy",
                    prefix: "",
                    group: [],
                    variables: {
                        imports: [],
                        locals: [],
                    },
                    custom: {},
                    overrides: {},
                    root: {
                        id: "1",
                        name: "Sequence",
                        children: [
                            {
                                id: "2",
                                name: "Log",
                            },
                        ],
                    },
                });

                const first = parsePersistedTreeContent(legacyContent, "subtree/c.json");
                const second = parsePersistedTreeContent(legacyContent, "subtree/c.json");
                const differentFile = parsePersistedTreeContent(legacyContent, "subtree/d.json");

                assert.equal(first.root.uuid, second.root.uuid);
                assert.equal(first.root.children?.[0]?.uuid, second.root.children?.[0]?.uuid);
                assert.notEqual(first.root.uuid, differentFile.root.uuid);
                assert.notEqual(
                    first.root.children?.[0]?.uuid,
                    differentFile.root.children?.[0]?.uuid
                );
            },
        },
        {
            name: "parses migrated sample tree files with variables",
            run() {
                const sampleTreeFiles = [
                    "sample/vars/declare-core.json",
                    "sample/vars/declare-vars.json",
                    "sample/vars/subtree.json",
                    "sample/vars/test-subtree.json",
                    "sample/vars/test-vars.json",
                    "sample/workdir/hero.json",
                    "sample/workdir/monster.json",
                    "sample/workdir/sub/subtree1.json",
                    "sample/workdir/sub/subtree2.json",
                    "sample/workdir/subtree1.json",
                    "sample/workdir/subtree2.json",
                ];

                for (const relativePath of sampleTreeFiles) {
                    const tree = parsePersistedTreeContent(
                        fs.readFileSync(path.join(process.cwd(), relativePath), "utf-8"),
                        relativePath
                    );

                    assert.ok(Array.isArray(tree.variables.imports), relativePath);
                    assert.ok(Array.isArray(tree.variables.locals), relativePath);

                    const serializedTree = JSON.parse(serializePersistedTree(tree)) as Record<
                        string,
                        unknown
                    >;
                    assert.equal(serializedTree.import, undefined, relativePath);
                    assert.equal(serializedTree.vars, undefined, relativePath);
                }
            },
        },
        {
            name: "loads subtree sources and applies override precedence in materialization",
            async run() {
                const mainTree = parsePersistedTreeContent(
                    JSON.stringify({
                        version: "2.0.0",
                        name: "main",
                        prefix: "M",
                        group: [],
                        variables: {
                            imports: [],
                            locals: [],
                        },
                        custom: {},
                        overrides: {
                            leaf: {
                                desc: "from-main",
                            },
                        },
                        root: {
                            uuid: "root",
                            id: "1",
                            name: "Wrapper",
                            children: [
                                {
                                    uuid: "subref",
                                    id: "2",
                                    name: "SubtreeRef",
                                    path: "sub.json",
                                },
                            ],
                        },
                    }),
                    "main.json"
                );

                const subtreeSources = await loadSubtreeSourceCache({
                    root: mainTree.root,
                    readContent: async (relativePath) => {
                        if (relativePath !== "sub.json") {
                            return null;
                        }

                        return JSON.stringify({
                            version: "2.0.0",
                            name: "sub",
                            prefix: "",
                            group: [],
                            variables: {
                                imports: [],
                                locals: [],
                            },
                            custom: {},
                            overrides: {
                                leaf: {
                                    desc: "from-subtree",
                                },
                            },
                            root: {
                                uuid: "sub-root",
                                id: "1",
                                name: "SubtreeRoot",
                                children: [
                                    {
                                        uuid: "leaf",
                                        id: "2",
                                        name: "Leaf",
                                    },
                                ],
                            },
                        });
                    },
                });

                const root = materializePersistedTree({
                    persistedTree: mainTree,
                    subtreeSources,
                    nodeDefs: [
                        {
                            name: "Wrapper",
                            type: "Composite",
                            desc: "",
                            status: ["|success"],
                        },
                        {
                            name: "SubtreeRef",
                            type: "Action",
                            desc: "",
                        },
                        {
                            name: "SubtreeRoot",
                            type: "Composite",
                            desc: "",
                            status: ["|success"],
                        },
                        {
                            name: "Leaf",
                            type: "Action",
                            desc: "",
                            status: ["success"],
                        },
                    ],
                    subtreeEditable: false,
                });

                assert.equal(root.children.length, 1);
                assert.equal(root.children[0]?.data.name, "SubtreeRoot");
                assert.equal(root.children[0]?.data.path, "sub.json");
                assert.equal(root.children[0]?.children[0]?.subtreeEditable, false);
                assert.equal(root.children[0]?.children[0]?.data.desc, "from-main");
                assert.equal(root.children[0]?.children[0]?.data.$status, 1 << 2);
                assert.equal(root.data.$status, 1 << 2);
            },
        },
        {
            name: "counts tree inspector variable usages inside materialized subtrees",
            run() {
                const mainTree = parsePersistedTreeContent(
                    JSON.stringify({
                        version: "2.0.0",
                        name: "main",
                        prefix: "",
                        group: [],
                        variables: {
                            imports: ["vars.json"],
                            locals: [{ name: "mainTarget", desc: "main target" }],
                        },
                        custom: {},
                        overrides: {},
                        root: {
                            uuid: "root",
                            id: "1",
                            name: "Sequence",
                            children: [
                                {
                                    uuid: "subref",
                                    id: "2",
                                    name: "SubtreeRef",
                                    path: "sub.json",
                                },
                                {
                                    uuid: "main-use",
                                    id: "3",
                                    name: "UseVars",
                                    input: ["mainTarget"],
                                    args: {
                                        expr: "importedVar + mainTarget",
                                    },
                                },
                            ],
                        },
                    }),
                    "main.json"
                );

                const subtreeTree = parsePersistedTreeContent(
                    JSON.stringify({
                        version: "2.0.0",
                        name: "sub",
                        prefix: "",
                        group: [],
                        variables: {
                            imports: [],
                            locals: [{ name: "subTarget", desc: "sub target" }],
                        },
                        custom: {},
                        overrides: {},
                        root: {
                            uuid: "sub-root",
                            id: "1",
                            name: "SubtreeRoot",
                            children: [
                                {
                                    uuid: "sub-use",
                                    id: "2",
                                    name: "UseVars",
                                    input: ["subTarget"],
                                    output: ["importedVar"],
                                    args: {
                                        expr: "subTarget + importedVar",
                                    },
                                },
                            ],
                        },
                    }),
                    "sub.json"
                );

                const nodeDefs: NodeDef[] = [
                    {
                        name: "Sequence",
                        type: "Composite",
                        desc: "",
                        status: ["|success"],
                    },
                    {
                        name: "SubtreeRef",
                        type: "Action",
                        desc: "",
                    },
                    {
                        name: "SubtreeRoot",
                        type: "Composite",
                        desc: "",
                        status: ["|success"],
                    },
                    {
                        name: "UseVars",
                        type: "Action",
                        desc: "",
                        input: ["target"],
                        output: ["result"],
                        args: [{ name: "expr", type: "expr", desc: "" }],
                    },
                ];

                const usageCount = buildTreeInspectorVariableUsageCount({
                    document: mainTree,
                    subtreeSources: {
                        "sub.json": subtreeTree,
                    },
                    nodeDefs,
                    nodeDefMap: createNodeDefMap(nodeDefs),
                    subtreeEditable: true,
                });

                assert.equal(usageCount.mainTarget, 2);
                assert.equal(usageCount.subTarget, 2);
                assert.equal(usageCount.importedVar, 3);
            },
        },
        {
            name: "counts repeated subtree instances separately in tree inspector variable usages",
            run() {
                const mainTree = parsePersistedTreeContent(
                    JSON.stringify({
                        version: "2.0.0",
                        name: "main",
                        prefix: "",
                        group: [],
                        variables: {
                            imports: [],
                            locals: [],
                        },
                        custom: {},
                        overrides: {},
                        root: {
                            uuid: "root",
                            id: "1",
                            name: "Sequence",
                            children: [
                                {
                                    uuid: "subref-a",
                                    id: "2",
                                    name: "SubtreeRef",
                                    path: "sub.json",
                                },
                                {
                                    uuid: "subref-b",
                                    id: "3",
                                    name: "SubtreeRef",
                                    path: "sub.json",
                                },
                            ],
                        },
                    }),
                    "main.json"
                );

                const subtreeTree = parsePersistedTreeContent(
                    JSON.stringify({
                        version: "2.0.0",
                        name: "sub",
                        prefix: "",
                        group: [],
                        variables: {
                            imports: [],
                            locals: [{ name: "sharedTarget", desc: "shared target" }],
                        },
                        custom: {},
                        overrides: {},
                        root: {
                            uuid: "sub-root",
                            id: "1",
                            name: "SubtreeRoot",
                            children: [
                                {
                                    uuid: "sub-use",
                                    id: "2",
                                    name: "UseVars",
                                    input: ["sharedTarget"],
                                },
                            ],
                        },
                    }),
                    "sub.json"
                );

                const nodeDefs: NodeDef[] = [
                    {
                        name: "Sequence",
                        type: "Composite",
                        desc: "",
                        status: ["|success"],
                    },
                    {
                        name: "SubtreeRef",
                        type: "Action",
                        desc: "",
                    },
                    {
                        name: "SubtreeRoot",
                        type: "Composite",
                        desc: "",
                        status: ["|success"],
                    },
                    {
                        name: "UseVars",
                        type: "Action",
                        desc: "",
                        input: ["target"],
                    },
                ];

                const usageCount = buildTreeInspectorVariableUsageCount({
                    document: mainTree,
                    subtreeSources: {
                        "sub.json": subtreeTree,
                    },
                    nodeDefs,
                    nodeDefMap: createNodeDefMap(nodeDefs),
                    subtreeEditable: true,
                });

                assert.equal(usageCount.sharedTarget, 2);
            },
        },
        {
            name: "normalizes subtree original args with resolved defaults",
            async run() {
                const mainTree = parsePersistedTreeContent(
                    JSON.stringify({
                        version: "2.0.0",
                        name: "main",
                        prefix: "",
                        group: [],
                        variables: {
                            imports: [],
                            locals: [],
                        },
                        custom: {},
                        overrides: {},
                        root: {
                            uuid: "root",
                            id: "1",
                            name: "SubtreeRef",
                            path: "sub.json",
                        },
                    }),
                    "main.json"
                );

                const subtreeSources = await loadSubtreeSourceCache({
                    root: mainTree.root,
                    readContent: async () =>
                        JSON.stringify({
                            version: "2.0.0",
                            name: "sub",
                            prefix: "",
                            group: [],
                            variables: {
                                imports: [],
                                locals: [],
                            },
                            custom: {},
                            overrides: {},
                            root: {
                                uuid: "sub-root",
                                id: "1",
                                name: "Sequence",
                                children: [
                                    {
                                        uuid: "sub-node",
                                        id: "2",
                                        name: "TryLaunchSkill",
                                    },
                                ],
                            },
                        }),
                });

                const root = materializePersistedTree({
                    persistedTree: mainTree,
                    subtreeSources,
                    nodeDefs: [
                        {
                            name: "SubtreeRef",
                            type: "Action",
                            desc: "",
                        },
                        {
                            name: "Sequence",
                            type: "Composite",
                            desc: "",
                        },
                        {
                            name: "TryLaunchSkill",
                            type: "Action",
                            desc: "",
                            args: [
                                {
                                    name: "skip_cd",
                                    type: "bool?",
                                    desc: "",
                                    default: false,
                                },
                            ],
                        },
                    ],
                    subtreeEditable: false,
                });

                const subtreeNode = root.children[0];
                assert.ok(subtreeNode);
                assert.equal(subtreeNode?.data.args?.skip_cd, false);
                assert.equal(subtreeNode?.subtreeOriginal?.args?.skip_cd, false);
            },
        },
        {
            name: "marks missing subtree references without crashing materialization",
            async run() {
                const mainTree = parsePersistedTreeContent(
                    JSON.stringify({
                        version: "2.0.0",
                        name: "main",
                        prefix: "",
                        group: [],
                        variables: {
                            imports: [],
                            locals: [],
                        },
                        custom: {},
                        overrides: {},
                        root: {
                            uuid: "root",
                            id: "1",
                            name: "Missing",
                            path: "missing.json",
                        },
                    }),
                    "main.json"
                );

                const subtreeSources = await loadSubtreeSourceCache({
                    root: mainTree.root,
                    readContent: async () => null,
                });

                const root = materializePersistedTree({
                    persistedTree: mainTree,
                    subtreeSources,
                    nodeDefs: [{ name: "Missing", type: "Action", desc: "" }],
                    subtreeEditable: true,
                });

                assert.equal(root.resolutionError, "missing-subtree");
                assert.equal(root.children.length, 0);
            },
        },
        {
            name: "requires explicit tree file version",
            run() {
                assert.throws(
                    () =>
                        parsePersistedTreeContent(
                            JSON.stringify({
                                name: "main",
                                prefix: "",
                                group: [],
                                variables: {
                                    imports: [],
                                    locals: [],
                                },
                                custom: {},
                                overrides: {},
                                root: {
                                    uuid: "root",
                                    id: "1",
                                    name: "Sequence",
                                    children: [],
                                },
                            }),
                            "main.json"
                        ),
                    /tree file version/i
                );
            },
        },
        {
            name: "collects transitive paths breadth-first without duplicates",
            async run() {
                const graph: Record<string, string[]> = {
                    "root-a": ["child-a", "child-b"],
                    "root-b": ["child-b", "child-c"],
                    "child-a": ["leaf-a"],
                    "child-b": ["leaf-a"],
                    "child-c": [],
                    "leaf-a": [],
                };

                const ordered = await collectTransitivePaths(["root-a", "root-b"], async (path) => {
                    return graph[path] ?? [];
                });

                assert.deepEqual(ordered, [
                    "root-a",
                    "root-b",
                    "child-a",
                    "child-b",
                    "child-c",
                    "leaf-a",
                ]);
            },
        },
        {
            name: "binds and guards app hooks explicitly",
            run() {
                const hooks = createAppHooksStore();
                assert.throws(() => hooks.getMessage(), /not available/i);

                const fakeHooks = {
                    message: { success() {}, error() {} } as any,
                    notification: {} as any,
                    modal: {} as any,
                };

                hooks.bind(fakeHooks);
                assert.equal(hooks.getMessage(), fakeHooks.message);
                assert.equal(hooks.getNotification(), fakeHooks.notification);
                assert.equal(hooks.getModal(), fakeHooks.modal);

                hooks.reset();
                assert.throws(() => hooks.getMessage(), /not available/i);
            },
        },
        {
            name: "routes boundary-only actions through controller commands",
            async run() {
                const documentStore = createDocumentStore();
                const workspaceStore = createWorkspaceStore();
                const selectionStore = createSelectionStore();
                const graphUiStore = createGraphUiStore();
                const appHooks = createAppHooksStore();
                const errors: string[] = [];
                appHooks.bind({
                    message: {
                        success() {},
                        error(value: string) {
                            errors.push(value);
                        },
                    } as any,
                    notification: {} as any,
                    modal: {} as any,
                });

                let readPath: string | null = null;
                const hostAdapter: HostAdapter = {
                    connect: () => () => {},
                    sendReady() {},
                    undo() {},
                    redo() {},
                    async mutateDocument() {
                        return { success: true };
                    },
                    selectTree() {},
                    selectNode() {},
                    requestFocusVariable() {},
                    sendRequestSetting() {},
                    sendBuild() {},
                    async validateNodeChecks() {
                        return { diagnostics: [] };
                    },
                    async saveDocument() {
                        return { success: true };
                    },
                    async revertDocument() {
                        return { success: true };
                    },
                    async readFile(path) {
                        readPath = path;
                        return { content: "{}" };
                    },
                    async saveSubtree() {
                        return { success: true };
                    },
                    async saveSubtreeAs() {
                        return { savedPath: null };
                    },
                    log() {},
                };
                const graphAdapter: GraphAdapter = {
                    async mount() {},
                    unmount() {},
                    async render() {},
                    async applySelection() {},
                    async applyHighlights() {},
                    async applySearch() {},
                    async focusNode() {},
                    async restoreViewport() {},
                    getViewport: () => ({ zoom: 1, x: 0, y: 0 }),
                };
                const controller = createEditorController({
                    documentStore,
                    workspaceStore,
                    selectionStore,
                    graphUiStore,
                    hostAdapter,
                    graphAdapter,
                    appHooks,
                });

                showDocumentReloadConflict(documentStore, "{}");
                await controller.dismissReloadConflict();
                assert.equal(documentStore.getState().alertReload, false);

                await controller.openSubtreePath("../escape.json");
                assert.equal(readPath, null);
                assert.equal(errors.length > 0, true);

                await controller.openSubtreePath("sub\\tree.json");
                assert.equal(readPath, "sub/tree.json");
            },
        },
        {
            name: "opens subtree from the explicit graph target and forwards subtree-local selection",
            async run() {
                const documentStore = createDocumentStore();
                const workspaceStore = createWorkspaceStore();
                const selectionStore = createSelectionStore();
                const graphUiStore = createGraphUiStore();
                const appHooks = createAppHooksStore();
                const readCalls: Array<{
                    path: string;
                    opts?: { openIfSubtree?: boolean; openSelection?: NodeInstanceRef };
                }> = [];

                appHooks.bind({
                    message: {
                        success() {},
                        error() {},
                    } as any,
                    notification: {} as any,
                    modal: {} as any,
                });

                const hostAdapter: HostAdapter = {
                    connect: () => () => {},
                    sendReady() {},
                    undo() {},
                    redo() {},
                    async mutateDocument() {
                        return { success: true };
                    },
                    selectTree() {},
                    selectNode() {},
                    requestFocusVariable() {},
                    sendRequestSetting() {},
                    sendBuild() {},
                    async validateNodeChecks() {
                        return { diagnostics: [] };
                    },
                    async saveDocument() {
                        return { success: true };
                    },
                    async revertDocument() {
                        return { success: true };
                    },
                    async readFile(path, opts) {
                        readCalls.push({ path, opts });
                        if (path !== "sub/tree.json") {
                            return { content: null };
                        }
                        return {
                            content: JSON.stringify({
                                version: "2.0.0",
                                name: "subtree",
                                prefix: "",
                                group: [],
                                variables: {
                                    imports: [],
                                    locals: [],
                                },
                                custom: {},
                                overrides: {},
                                root: {
                                    uuid: "sub-root",
                                    id: "1",
                                    name: "SubtreeRoot",
                                    children: [],
                                },
                            }),
                        };
                    },
                    async saveSubtree() {
                        return { success: true };
                    },
                    async saveSubtreeAs() {
                        return { savedPath: null };
                    },
                    log() {},
                };
                const graphAdapter: GraphAdapter = {
                    async mount() {},
                    unmount() {},
                    async render() {},
                    async applySelection() {},
                    async applyHighlights() {},
                    async applySearch() {},
                    async focusNode() {},
                    async restoreViewport() {},
                    getViewport: () => ({ zoom: 1, x: 0, y: 0 }),
                };

                const controller = createEditorController({
                    documentStore,
                    workspaceStore,
                    selectionStore,
                    graphUiStore,
                    hostAdapter,
                    graphAdapter,
                    appHooks,
                });

                const tree = createTestTree();
                tree.root.children = [
                    {
                        uuid: "sub-link",
                        id: "2",
                        name: "SubtreeRef",
                        path: "sub/tree.json" as any,
                    },
                ];
                const content = serializePersistedTree(tree);

                await controller.initFromHost({
                    filePath: "/tmp/main.json",
                    workdir: "/tmp",
                    content,
                    nodeDefs: [
                        {
                            name: "Sequence",
                            type: "Composite",
                            desc: "",
                            status: ["success"],
                        },
                        {
                            name: "SubtreeRef",
                            type: "Action",
                            desc: "",
                        },
                        {
                            name: "SubtreeRoot",
                            type: "Composite",
                            desc: "",
                            status: ["success"],
                        },
                    ],
                    allFiles: ["sub/tree.json" as any],
                    settings: {
                        checkExpr: true,
                        subtreeEditable: true,
                        language: "en",
                        theme: "light",
                    },
                    documentSession: {
                        dirty: false,
                        historyIndex: 0,
                        historyLength: 1,
                        lastSavedSnapshot: content,
                        alertReload: false,
                        pendingExternalContent: null,
                    },
                    selection: { kind: "tree" },
                });

                readCalls.length = 0;
                assert.equal(selectionStore.getState().selectedNodeRef, null);

                await controller.openSelectedSubtree({
                    instanceKey: "2",
                    displayId: "2",
                    structuralStableId: "sub-link",
                    sourceStableId: "sub-root",
                    sourceTreePath: "sub/tree.json" as any,
                    subtreeStack: ["sub/tree.json" as any],
                });

                assert.equal(readCalls.length, 1);
                assert.equal(readCalls[0]?.path, "sub/tree.json");
                assert.equal(readCalls[0]?.opts?.openIfSubtree, true);
                assert.deepEqual(readCalls[0]?.opts?.openSelection, {
                    instanceKey: "sub-root",
                    displayId: "",
                    structuralStableId: "sub-root",
                    sourceStableId: "sub-root",
                    sourceTreePath: null,
                    subtreeStack: [],
                });
            },
        },
        {
            name: "opens subtree from inspector-selected subtree-internal nodes via subtree stack fallback",
            async run() {
                const documentStore = createDocumentStore();
                const workspaceStore = createWorkspaceStore();
                const selectionStore = createSelectionStore();
                const graphUiStore = createGraphUiStore();
                const appHooks = createAppHooksStore();
                const readCalls: Array<{
                    path: string;
                    opts?: { openIfSubtree?: boolean; openSelection?: NodeInstanceRef };
                }> = [];

                appHooks.bind({
                    message: {
                        success() {},
                        error() {},
                    } as any,
                    notification: {} as any,
                    modal: {} as any,
                });

                const hostAdapter: HostAdapter = {
                    connect: () => () => {},
                    sendReady() {},
                    undo() {},
                    redo() {},
                    async mutateDocument() {
                        return { success: true };
                    },
                    selectTree() {},
                    selectNode() {},
                    requestFocusVariable() {},
                    sendRequestSetting() {},
                    sendBuild() {},
                    async validateNodeChecks() {
                        return { diagnostics: [] };
                    },
                    async saveDocument() {
                        return { success: true };
                    },
                    async revertDocument() {
                        return { success: true };
                    },
                    async readFile(path, opts) {
                        readCalls.push({ path, opts });
                        return { content: null };
                    },
                    async saveSubtree() {
                        return { success: true };
                    },
                    async saveSubtreeAs() {
                        return { savedPath: null };
                    },
                    log() {},
                };
                const graphAdapter: GraphAdapter = {
                    async mount() {},
                    unmount() {},
                    async render() {},
                    async applySelection() {},
                    async applyHighlights() {},
                    async applySearch() {},
                    async focusNode() {},
                    async restoreViewport() {},
                    getViewport: () => ({ zoom: 1, x: 0, y: 0 }),
                };

                const controller = createEditorController({
                    documentStore,
                    workspaceStore,
                    selectionStore,
                    graphUiStore,
                    hostAdapter,
                    graphAdapter,
                    appHooks,
                });

                const tree = createTestTree();
                tree.root.children = [
                    {
                        uuid: "sub-link",
                        id: "2",
                        name: "SubtreeRef",
                        path: "sub/tree.json" as any,
                    },
                ];
                const content = serializePersistedTree(tree);

                await controller.initFromHost({
                    filePath: "/tmp/main.json",
                    workdir: "/tmp",
                    content,
                    nodeDefs: [
                        {
                            name: "Sequence",
                            type: "Composite",
                            desc: "",
                            status: ["success"],
                        },
                        {
                            name: "SubtreeRef",
                            type: "Action",
                            desc: "",
                        },
                    ],
                    allFiles: ["sub/tree.json" as any],
                    settings: {
                        checkExpr: true,
                        subtreeEditable: true,
                        language: "en",
                        theme: "light",
                    },
                    documentSession: {
                        dirty: false,
                        historyIndex: 0,
                        historyLength: 1,
                        lastSavedSnapshot: content,
                        alertReload: false,
                        pendingExternalContent: null,
                    },
                    selection: { kind: "tree" },
                });

                readCalls.length = 0;

                await controller.openSelectedSubtree({
                    instanceKey: "sub-child",
                    displayId: "",
                    structuralStableId: "sub-child",
                    sourceStableId: "sub-child",
                    sourceTreePath: "sub/tree.json" as any,
                    subtreeStack: ["sub/tree.json" as any],
                });

                assert.equal(readCalls.length, 1);
                assert.equal(readCalls[0]?.path, "sub/tree.json");
                assert.equal(readCalls[0]?.opts?.openIfSubtree, true);
                assert.deepEqual(readCalls[0]?.opts?.openSelection, {
                    instanceKey: "sub-child",
                    displayId: "",
                    structuralStableId: "sub-child",
                    sourceStableId: "sub-child",
                    sourceTreePath: null,
                    subtreeStack: [],
                });
            },
        },
        {
            name: "does not write subtree files during subtree cache sync",
            async run() {
                const documentStore = createDocumentStore();
                const workspaceStore = createWorkspaceStore();
                const selectionStore = createSelectionStore();
                const graphUiStore = createGraphUiStore();
                const appHooks = createAppHooksStore();
                appHooks.bind({
                    message: {
                        success() {},
                        error() {},
                    } as any,
                    notification: {} as any,
                    modal: {} as any,
                });

                const saveSubtreeCalls: Array<{ path: string; content: string }> = [];
                const hostAdapter: HostAdapter = {
                    connect: () => () => {},
                    sendReady() {},
                    undo() {},
                    redo() {},
                    async mutateDocument() {
                        return { success: true };
                    },
                    selectTree() {},
                    selectNode() {},
                    requestFocusVariable() {},
                    sendRequestSetting() {},
                    sendBuild() {},
                    async validateNodeChecks() {
                        return { diagnostics: [] };
                    },
                    async saveDocument() {
                        return { success: true };
                    },
                    async revertDocument() {
                        return { success: true };
                    },
                    async readFile(path) {
                        if (path !== "sub/tree.json") {
                            return { content: null };
                        }
                        return {
                            content: JSON.stringify({
                                version: "2.0.0",
                                name: "tree",
                                prefix: "",
                                group: [],
                                variables: {
                                    imports: [],
                                    locals: [],
                                },
                                custom: {},
                                overrides: {},
                                root: {
                                    id: "1",
                                    name: "SubSequence",
                                    children: [
                                        {
                                            id: "2",
                                            name: "SubAction",
                                        },
                                    ],
                                },
                            }),
                        };
                    },
                    async saveSubtree(path, content) {
                        saveSubtreeCalls.push({ path, content });
                        return { success: true };
                    },
                    async saveSubtreeAs() {
                        return { savedPath: null };
                    },
                    log() {},
                };
                const graphAdapter: GraphAdapter = {
                    async mount() {},
                    unmount() {},
                    async render() {},
                    async applySelection() {},
                    async applyHighlights() {},
                    async applySearch() {},
                    async focusNode() {},
                    async restoreViewport() {},
                    getViewport: () => ({ zoom: 1, x: 0, y: 0 }),
                };
                const controller = createEditorController({
                    documentStore,
                    workspaceStore,
                    selectionStore,
                    graphUiStore,
                    hostAdapter,
                    graphAdapter,
                    appHooks,
                });

                await controller.initFromHost({
                    filePath: "/tmp/main.json",
                    workdir: "/tmp",
                    content: JSON.stringify({
                        version: "2.0.0",
                        name: "main",
                        prefix: "",
                        group: [],
                        variables: {
                            imports: [],
                            locals: [],
                        },
                        custom: {},
                        overrides: {},
                        root: {
                            uuid: "root",
                            id: "1",
                            name: "Sequence",
                            children: [
                                {
                                    uuid: "child",
                                    id: "2",
                                    name: "SubSequence",
                                    path: "sub/tree.json",
                                },
                            ],
                        },
                    }),
                    nodeDefs: [
                        { name: "Sequence", type: "Composite", desc: "", status: ["success"] },
                        { name: "SubSequence", type: "Composite", desc: "", status: ["success"] },
                        { name: "SubAction", type: "Action", desc: "" },
                    ],
                    allFiles: ["sub/tree.json" as any],
                    settings: {
                        checkExpr: true,
                        subtreeEditable: true,
                        language: "en",
                        theme: "light",
                    },
                    documentSession: {
                        dirty: false,
                        historyIndex: 0,
                        historyLength: 1,
                        lastSavedSnapshot: null,
                        alertReload: false,
                        pendingExternalContent: null,
                    },
                    selection: { kind: "tree" },
                });

                assert.equal(saveSubtreeCalls.length, 0);
                assert.ok(workspaceStore.getState().subtreeSources["sub/tree.json"]);
            },
        },
        {
            name: "routes selection gestures through host selection intents",
            async run() {
                const documentStore = createDocumentStore();
                const workspaceStore = createWorkspaceStore();
                const selectionStore = createSelectionStore();
                const graphUiStore = createGraphUiStore();
                const appHooks = createAppHooksStore();
                let appliedSelectionKey: string | null = null;
                let treeSelectionCount = 0;
                const selectedNodeTargets: NodeInstanceRef[] = [];

                appHooks.bind({
                    message: {
                        success() {},
                        error() {},
                    } as any,
                    notification: {} as any,
                    modal: {} as any,
                });

                const hostAdapter: HostAdapter = {
                    connect: () => () => {},
                    sendReady() {},
                    undo() {},
                    redo() {},
                    async mutateDocument() {
                        return { success: true };
                    },
                    selectTree() {
                        treeSelectionCount += 1;
                    },
                    selectNode(target) {
                        selectedNodeTargets.push(target);
                    },
                    requestFocusVariable() {},
                    sendRequestSetting() {},
                    sendBuild() {},
                    async validateNodeChecks() {
                        return { diagnostics: [] };
                    },
                    async saveDocument() {
                        return { success: true };
                    },
                    async revertDocument() {
                        return { success: true };
                    },
                    async readFile() {
                        return { content: "{}" };
                    },
                    async saveSubtree() {
                        return { success: true };
                    },
                    async saveSubtreeAs() {
                        return { savedPath: null };
                    },
                    log() {},
                };
                const graphAdapter: GraphAdapter = {
                    async mount() {},
                    unmount() {},
                    async render() {},
                    async applySelection(payload) {
                        appliedSelectionKey = payload.selectedNodeKey;
                    },
                    async applyHighlights() {},
                    async applySearch() {},
                    async focusNode() {},
                    async restoreViewport() {},
                    getViewport: () => ({ zoom: 1, x: 0, y: 0 }),
                };
                const controller = createEditorController({
                    documentStore,
                    workspaceStore,
                    selectionStore,
                    graphUiStore,
                    hostAdapter,
                    graphAdapter,
                    appHooks,
                });

                const content = serializePersistedTree(createTestTree());
                await controller.initFromHost({
                    filePath: "/tmp/main.json",
                    workdir: "/tmp",
                    content,
                    nodeDefs: [
                        {
                            name: "Sequence",
                            type: "Composite",
                            desc: "",
                            status: ["success"],
                        },
                    ],
                    allFiles: [],
                    settings: {
                        checkExpr: true,
                        subtreeEditable: true,
                        language: "en",
                        theme: "light",
                    },
                    documentSession: {
                        dirty: false,
                        historyIndex: 0,
                        historyLength: 1,
                        lastSavedSnapshot: content,
                        alertReload: false,
                        pendingExternalContent: null,
                    },
                    selection: { kind: "tree" },
                });

                await controller.selectNode("1");
                assert.equal(selectedNodeTargets.length, 1);
                assert.equal(selectedNodeTargets[0]?.structuralStableId, "root");
                assert.equal(selectionStore.getState().selectedNodeRef, null);
                assert.equal(selectionStore.getState().selectedTree?.filePath, "/tmp/main.json");
                assert.equal(appliedSelectionKey, "1");

                await controller.applyDocumentSnapshot({
                    content,
                    documentSession: {
                        dirty: false,
                        historyIndex: 0,
                        historyLength: 1,
                        lastSavedSnapshot: content,
                        alertReload: false,
                        pendingExternalContent: null,
                    },
                    selection: {
                        kind: "node",
                        ref: selectedNodeTargets[0]!,
                    },
                    syncKind: "update",
                });
                assert.equal(selectionStore.getState().selectedNodeSnapshot?.data.uuid, "root");

                await controller.focusVariable(["hp"]);
                await controller.selectTree();
                assert.equal(treeSelectionCount, 1);
                assert.deepEqual(graphUiStore.getState().activeVariableNames, []);
                assert.equal(selectionStore.getState().selectedNodeSnapshot?.data.uuid, "root");
                assert.equal(appliedSelectionKey, null);

                await controller.applyDocumentSnapshot({
                    content,
                    documentSession: {
                        dirty: false,
                        historyIndex: 0,
                        historyLength: 1,
                        lastSavedSnapshot: content,
                        alertReload: false,
                        pendingExternalContent: null,
                    },
                    selection: { kind: "tree" },
                    syncKind: "update",
                });
                assert.equal(selectionStore.getState().selectedNodeRef, null);
                assert.equal(selectionStore.getState().selectedTree?.filePath, "/tmp/main.json");
            },
        },
        {
            name: "sidebar variable-focus requests still update editor-local graph UI state",
            async run() {
                const documentStore = createDocumentStore();
                const workspaceStore = createWorkspaceStore();
                const selectionStore = createSelectionStore();
                const graphUiStore = createGraphUiStore();
                const appHooks = createAppHooksStore();
                let requestedVariableNames: string[] | null = null;
                let lastHighlights: GraphHighlightState | null = null;

                appHooks.bind({
                    message: {
                        success() {},
                        error() {},
                    } as any,
                    notification: {} as any,
                    modal: {} as any,
                });

                const hostAdapter: HostAdapter = {
                    connect: () => () => {},
                    sendReady() {},
                    undo() {},
                    redo() {},
                    async mutateDocument() {
                        return { success: true };
                    },
                    selectTree() {},
                    selectNode() {},
                    requestFocusVariable(names) {
                        requestedVariableNames = [...names];
                    },
                    sendRequestSetting() {},
                    sendBuild() {},
                    async validateNodeChecks() {
                        return { diagnostics: [] };
                    },
                    async saveDocument() {
                        return { success: true };
                    },
                    async revertDocument() {
                        return { success: true };
                    },
                    async readFile() {
                        return { content: "{}" };
                    },
                    async saveSubtree() {
                        return { success: true };
                    },
                    async saveSubtreeAs() {
                        return { savedPath: null };
                    },
                    log() {},
                };
                const graphAdapter: GraphAdapter = {
                    async mount() {},
                    unmount() {},
                    async render() {},
                    async applySelection() {},
                    async applyHighlights(payload) {
                        lastHighlights = payload;
                    },
                    async applySearch() {},
                    async focusNode() {},
                    async restoreViewport() {},
                    getViewport: () => ({ zoom: 1, x: 0, y: 0 }),
                };
                const controller = createEditorController({
                    documentStore,
                    workspaceStore,
                    selectionStore,
                    graphUiStore,
                    hostAdapter,
                    graphAdapter,
                    appHooks,
                });

                const tree = createTestTree();
                tree.root.input = ["hp"];
                const content = serializePersistedTree(tree);
                await controller.initFromHost({
                    filePath: "/tmp/main.json",
                    workdir: "/tmp",
                    content,
                    nodeDefs: [
                        {
                            name: "Sequence",
                            type: "Composite",
                            desc: "",
                            status: ["success"],
                        },
                    ],
                    allFiles: [],
                    settings: {
                        checkExpr: true,
                        subtreeEditable: true,
                        language: "en",
                        theme: "light",
                    },
                    documentSession: {
                        dirty: false,
                        historyIndex: 0,
                        historyLength: 1,
                        lastSavedSnapshot: content,
                        alertReload: false,
                        pendingExternalContent: null,
                    },
                    selection: { kind: "tree" },
                });

                hostAdapter.requestFocusVariable(["hp"]);
                assert.deepEqual(requestedVariableNames, ["hp"]);
                assert.ok(requestedVariableNames);

                await controller.focusVariable(requestedVariableNames);

                assert.deepEqual(graphUiStore.getState().activeVariableNames, ["hp"]);
                assert.equal(selectionStore.getState().selectedNodeRef, null);
                assert.deepEqual(lastHighlights?.activeVariableNames, ["hp"]);
                assert.deepEqual(lastHighlights?.variableHits["1"], ["input"]);
            },
        },
        {
            name: "search jumps keep graph feedback local until host selection snapshot converges",
            async run() {
                const documentStore = createDocumentStore();
                const workspaceStore = createWorkspaceStore();
                const selectionStore = createSelectionStore();
                const graphUiStore = createGraphUiStore();
                const appHooks = createAppHooksStore();
                let appliedSelectionKey: string | null = null;
                let focusedNodeKey: string | null = null;
                const selectedNodeTargets: NodeInstanceRef[] = [];

                appHooks.bind({
                    message: {
                        success() {},
                        error() {},
                    } as any,
                    notification: {} as any,
                    modal: {} as any,
                });

                const hostAdapter: HostAdapter = {
                    connect: () => () => {},
                    sendReady() {},
                    undo() {},
                    redo() {},
                    async mutateDocument() {
                        return { success: true };
                    },
                    selectTree() {},
                    selectNode(target) {
                        selectedNodeTargets.push(target);
                    },
                    requestFocusVariable() {},
                    sendRequestSetting() {},
                    sendBuild() {},
                    async validateNodeChecks() {
                        return { diagnostics: [] };
                    },
                    async saveDocument() {
                        return { success: true };
                    },
                    async revertDocument() {
                        return { success: true };
                    },
                    async readFile() {
                        return { content: "{}" };
                    },
                    async saveSubtree() {
                        return { success: true };
                    },
                    async saveSubtreeAs() {
                        return { savedPath: null };
                    },
                    log() {},
                };
                const graphAdapter: GraphAdapter = {
                    async mount() {},
                    unmount() {},
                    async render() {},
                    async applySelection(payload) {
                        appliedSelectionKey = payload.selectedNodeKey;
                    },
                    async applyHighlights() {},
                    async applySearch() {},
                    async focusNode(nodeKey) {
                        focusedNodeKey = nodeKey;
                    },
                    async restoreViewport() {},
                    getViewport: () => ({ zoom: 1, x: 0, y: 0 }),
                };
                const controller = createEditorController({
                    documentStore,
                    workspaceStore,
                    selectionStore,
                    graphUiStore,
                    hostAdapter,
                    graphAdapter,
                    appHooks,
                });

                const tree = createTestTree();
                tree.root.children = [
                    {
                        uuid: "child-a",
                        id: "2",
                        name: "ActionA",
                    },
                    {
                        uuid: "child-b",
                        id: "3",
                        name: "ActionB",
                    },
                ];
                const content = serializePersistedTree(tree);
                await controller.initFromHost({
                    filePath: "/tmp/main.json",
                    workdir: "/tmp",
                    content,
                    nodeDefs: [
                        {
                            name: "Sequence",
                            type: "Composite",
                            desc: "",
                            status: ["success"],
                        },
                        {
                            name: "ActionA",
                            type: "Action",
                            desc: "",
                        },
                        {
                            name: "ActionB",
                            type: "Action",
                            desc: "",
                        },
                    ],
                    allFiles: [],
                    settings: {
                        checkExpr: true,
                        subtreeEditable: true,
                        language: "en",
                        theme: "light",
                    },
                    documentSession: {
                        dirty: false,
                        historyIndex: 0,
                        historyLength: 1,
                        lastSavedSnapshot: content,
                        alertReload: false,
                        pendingExternalContent: null,
                    },
                    selection: { kind: "tree" },
                });

                await controller.openSearch("id");
                await controller.updateSearch("3");

                assert.equal(selectedNodeTargets.length, 1);
                assert.equal(selectedNodeTargets[0]?.structuralStableId, "child-b");
                assert.equal(selectionStore.getState().selectedNodeRef, null);
                assert.equal(graphUiStore.getState().search.results[0], "3");
                assert.equal(appliedSelectionKey, "3");
                assert.equal(focusedNodeKey, "3");

                await controller.applyDocumentSnapshot({
                    content,
                    documentSession: {
                        dirty: false,
                        historyIndex: 0,
                        historyLength: 1,
                        lastSavedSnapshot: content,
                        alertReload: false,
                        pendingExternalContent: null,
                    },
                    selection: {
                        kind: "node",
                        ref: selectedNodeTargets[0]!,
                    },
                    syncKind: "update",
                });

                assert.equal(
                    selectionStore.getState().selectedNodeRef?.structuralStableId,
                    "child-b"
                );
                assert.equal(selectionStore.getState().selectedNodeSnapshot?.data.uuid, "child-b");
            },
        },
        {
            name: "variable-hotspot-style selection preserves local variable focus until host snapshot converges",
            async run() {
                const documentStore = createDocumentStore();
                const workspaceStore = createWorkspaceStore();
                const selectionStore = createSelectionStore();
                const graphUiStore = createGraphUiStore();
                const appHooks = createAppHooksStore();
                let appliedSelectionKey: string | null = null;
                const selectedNodeTargets: NodeInstanceRef[] = [];

                appHooks.bind({
                    message: {
                        success() {},
                        error() {},
                    } as any,
                    notification: {} as any,
                    modal: {} as any,
                });

                const hostAdapter: HostAdapter = {
                    connect: () => () => {},
                    sendReady() {},
                    undo() {},
                    redo() {},
                    async mutateDocument() {
                        return { success: true };
                    },
                    selectTree() {},
                    selectNode(target) {
                        selectedNodeTargets.push(target);
                    },
                    requestFocusVariable() {},
                    sendRequestSetting() {},
                    sendBuild() {},
                    async validateNodeChecks() {
                        return { diagnostics: [] };
                    },
                    async saveDocument() {
                        return { success: true };
                    },
                    async revertDocument() {
                        return { success: true };
                    },
                    async readFile() {
                        return { content: "{}" };
                    },
                    async saveSubtree() {
                        return { success: true };
                    },
                    async saveSubtreeAs() {
                        return { savedPath: null };
                    },
                    log() {},
                };
                const graphAdapter: GraphAdapter = {
                    async mount() {},
                    unmount() {},
                    async render() {},
                    async applySelection(payload) {
                        appliedSelectionKey = payload.selectedNodeKey;
                    },
                    async applyHighlights() {},
                    async applySearch() {},
                    async focusNode() {},
                    async restoreViewport() {},
                    getViewport: () => ({ zoom: 1, x: 0, y: 0 }),
                };
                const controller = createEditorController({
                    documentStore,
                    workspaceStore,
                    selectionStore,
                    graphUiStore,
                    hostAdapter,
                    graphAdapter,
                    appHooks,
                });

                const content = serializePersistedTree(createTestTree());
                await controller.initFromHost({
                    filePath: "/tmp/main.json",
                    workdir: "/tmp",
                    content,
                    nodeDefs: [
                        {
                            name: "Sequence",
                            type: "Composite",
                            desc: "",
                            status: ["success"],
                        },
                    ],
                    allFiles: [],
                    settings: {
                        checkExpr: true,
                        subtreeEditable: true,
                        language: "en",
                        theme: "light",
                    },
                    documentSession: {
                        dirty: false,
                        historyIndex: 0,
                        historyLength: 1,
                        lastSavedSnapshot: content,
                        alertReload: false,
                        pendingExternalContent: null,
                    },
                    selection: { kind: "tree" },
                });

                await controller.focusVariable(["hp"]);
                await controller.selectNode("1", { clearVariableFocus: false });

                assert.deepEqual(graphUiStore.getState().activeVariableNames, ["hp"]);
                assert.equal(selectionStore.getState().selectedNodeRef, null);
                assert.equal(appliedSelectionKey, "1");
                assert.equal(selectedNodeTargets.length, 1);

                await controller.applyDocumentSnapshot({
                    content,
                    documentSession: {
                        dirty: false,
                        historyIndex: 0,
                        historyLength: 1,
                        lastSavedSnapshot: content,
                        alertReload: false,
                        pendingExternalContent: null,
                    },
                    selection: {
                        kind: "node",
                        ref: selectedNodeTargets[0]!,
                    },
                    syncKind: "update",
                });

                assert.deepEqual(graphUiStore.getState().activeVariableNames, ["hp"]);
                assert.equal(selectionStore.getState().selectedNodeSnapshot?.data.uuid, "root");
            },
        },
        {
            name: "reload snapshots clear stale local selection hints and remain authoritative",
            async run() {
                const documentStore = createDocumentStore();
                const workspaceStore = createWorkspaceStore();
                const selectionStore = createSelectionStore();
                const graphUiStore = createGraphUiStore();
                const appHooks = createAppHooksStore();
                let appliedSelectionKey: string | null = null;
                const selectedNodeTargets: NodeInstanceRef[] = [];

                appHooks.bind({
                    message: {
                        success() {},
                        error() {},
                    } as any,
                    notification: {} as any,
                    modal: {} as any,
                });

                const hostAdapter: HostAdapter = {
                    connect: () => () => {},
                    sendReady() {},
                    undo() {},
                    redo() {},
                    async mutateDocument() {
                        return { success: true };
                    },
                    selectTree() {},
                    selectNode(target) {
                        selectedNodeTargets.push(target);
                    },
                    requestFocusVariable() {},
                    sendRequestSetting() {},
                    sendBuild() {},
                    async validateNodeChecks() {
                        return { diagnostics: [] };
                    },
                    async saveDocument() {
                        return { success: true };
                    },
                    async revertDocument() {
                        return { success: true };
                    },
                    async readFile() {
                        return { content: "{}" };
                    },
                    async saveSubtree() {
                        return { success: true };
                    },
                    async saveSubtreeAs() {
                        return { savedPath: null };
                    },
                    log() {},
                };
                const graphAdapter: GraphAdapter = {
                    async mount() {},
                    unmount() {},
                    async render() {},
                    async applySelection(payload) {
                        appliedSelectionKey = payload.selectedNodeKey;
                    },
                    async applyHighlights() {},
                    async applySearch() {},
                    async focusNode() {},
                    async restoreViewport() {},
                    getViewport: () => ({ zoom: 1, x: 0, y: 0 }),
                };
                const controller = createEditorController({
                    documentStore,
                    workspaceStore,
                    selectionStore,
                    graphUiStore,
                    hostAdapter,
                    graphAdapter,
                    appHooks,
                });

                const content = serializePersistedTree(createTestTree());
                await controller.initFromHost({
                    filePath: "/tmp/main.json",
                    workdir: "/tmp",
                    content,
                    nodeDefs: [
                        {
                            name: "Sequence",
                            type: "Composite",
                            desc: "",
                            status: ["success"],
                        },
                    ],
                    allFiles: [],
                    settings: {
                        checkExpr: true,
                        subtreeEditable: true,
                        language: "en",
                        theme: "light",
                    },
                    documentSession: {
                        dirty: false,
                        historyIndex: 0,
                        historyLength: 1,
                        lastSavedSnapshot: content,
                        alertReload: false,
                        pendingExternalContent: null,
                    },
                    selection: { kind: "tree" },
                });

                await controller.focusVariable(["hp"]);
                await controller.openSearch("id");
                await controller.updateSearch("missing");
                await controller.selectNode("1");
                assert.equal(selectedNodeTargets.length, 1);
                assert.equal(selectionStore.getState().selectedNodeRef, null);
                assert.equal(appliedSelectionKey, "1");
                assert.deepEqual(graphUiStore.getState().activeVariableNames, ["hp"]);
                assert.equal(graphUiStore.getState().search.open, true);
                assert.equal(graphUiStore.getState().search.query, "missing");

                const reloadedTree = createTestTree();
                reloadedTree.desc = "reloaded";
                const reloadedContent = serializePersistedTree(reloadedTree);

                await controller.applyDocumentSnapshot({
                    content: reloadedContent,
                    documentSession: {
                        dirty: false,
                        historyIndex: 0,
                        historyLength: 1,
                        lastSavedSnapshot: reloadedContent,
                        alertReload: false,
                        pendingExternalContent: null,
                    },
                    selection: { kind: "tree" },
                    syncKind: "reload",
                });

                assert.equal(selectionStore.getState().selectedNodeRef, null);
                assert.equal(selectionStore.getState().selectedTree?.filePath, "/tmp/main.json");
                assert.equal(appliedSelectionKey, null);
                assert.deepEqual(graphUiStore.getState().activeVariableNames, []);
                assert.equal(graphUiStore.getState().search.open, false);
                assert.equal(graphUiStore.getState().search.query, "");

                await controller.applyDocumentSnapshot({
                    content: reloadedContent,
                    documentSession: {
                        dirty: false,
                        historyIndex: 0,
                        historyLength: 1,
                        lastSavedSnapshot: reloadedContent,
                        alertReload: false,
                        pendingExternalContent: null,
                    },
                    selection: { kind: "tree" },
                    syncKind: "update",
                });

                assert.deepEqual(graphUiStore.getState().activeVariableNames, []);
            },
        },
        {
            name: "routes canvas structural commands through host mutation intents",
            async run() {
                const documentStore = createDocumentStore();
                const workspaceStore = createWorkspaceStore();
                const selectionStore = createSelectionStore();
                const graphUiStore = createGraphUiStore();
                const appHooks = createAppHooksStore();
                appHooks.bind({
                    message: {
                        success() {},
                        error() {},
                    } as any,
                    notification: {} as any,
                    modal: {} as any,
                });

                const mutations: DocumentMutation[] = [];
                let selectedNodeTarget: NodeInstanceRef | null = null;
                const hostAdapter: HostAdapter = {
                    connect: () => () => {},
                    sendReady() {},
                    undo() {},
                    redo() {},
                    async mutateDocument(mutation) {
                        mutations.push(mutation);
                        return { success: true };
                    },
                    selectTree() {},
                    selectNode(target) {
                        selectedNodeTarget = target;
                    },
                    requestFocusVariable() {},
                    sendRequestSetting() {},
                    sendBuild() {},
                    async validateNodeChecks() {
                        return { diagnostics: [] };
                    },
                    async saveDocument() {
                        return { success: true };
                    },
                    async revertDocument() {
                        return { success: true };
                    },
                    async readFile() {
                        return { content: "{}" };
                    },
                    async saveSubtree() {
                        return { success: true };
                    },
                    async saveSubtreeAs() {
                        return { savedPath: null };
                    },
                    log() {},
                };
                const graphAdapter: GraphAdapter = {
                    async mount() {},
                    unmount() {},
                    async render() {},
                    async applySelection() {},
                    async applyHighlights() {},
                    async applySearch() {},
                    async focusNode() {},
                    async restoreViewport() {},
                    getViewport: () => ({ zoom: 1, x: 0, y: 0 }),
                };
                const controller = createEditorController({
                    documentStore,
                    workspaceStore,
                    selectionStore,
                    graphUiStore,
                    hostAdapter,
                    graphAdapter,
                    appHooks,
                });

                const tree = createTestTree();
                tree.root.children = [
                    {
                        uuid: "child-a",
                        id: "2",
                        name: "ActionA",
                    },
                    {
                        uuid: "child-b",
                        id: "3",
                        name: "ActionB",
                    },
                ];
                const content = serializePersistedTree(tree);
                await controller.initFromHost({
                    filePath: "/tmp/main.json",
                    workdir: "/tmp",
                    content,
                    nodeDefs: [
                        {
                            name: "Sequence",
                            type: "Composite",
                            desc: "",
                            status: ["success"],
                        },
                        {
                            name: "ActionA",
                            type: "Action",
                            desc: "",
                        },
                        {
                            name: "ActionB",
                            type: "Action",
                            desc: "",
                        },
                    ],
                    allFiles: [],
                    settings: {
                        checkExpr: true,
                        subtreeEditable: true,
                        language: "en",
                        theme: "light",
                    },
                    documentSession: {
                        dirty: false,
                        historyIndex: 0,
                        historyLength: 1,
                        lastSavedSnapshot: content,
                        alertReload: false,
                        pendingExternalContent: null,
                    },
                    selection: { kind: "tree" },
                });

                const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
                Object.defineProperty(globalThis, "navigator", {
                    configurable: true,
                    value: {
                        clipboard: {
                            async readText() {
                                return JSON.stringify({
                                    uuid: "clip-root",
                                    id: "9",
                                    name: "ClipboardAction",
                                });
                            },
                            async writeText() {},
                        },
                    },
                });

                try {
                    await controller.selectNode("1");
                    assert.ok(selectedNodeTarget);
                    await controller.applyDocumentSnapshot({
                        content,
                        documentSession: {
                            dirty: false,
                            historyIndex: 0,
                            historyLength: 1,
                            lastSavedSnapshot: content,
                            alertReload: false,
                            pendingExternalContent: null,
                        },
                        selection: {
                            kind: "node",
                            ref: selectedNodeTarget,
                        },
                        syncKind: "update",
                    });
                    await controller.insertNode();
                    await controller.pasteNode();

                    await controller.selectNode("2");
                    assert.ok(selectedNodeTarget);
                    await controller.applyDocumentSnapshot({
                        content,
                        documentSession: {
                            dirty: false,
                            historyIndex: 0,
                            historyLength: 1,
                            lastSavedSnapshot: content,
                            alertReload: false,
                            pendingExternalContent: null,
                        },
                        selection: {
                            kind: "node",
                            ref: selectedNodeTarget,
                        },
                        syncKind: "update",
                    });
                    await controller.replaceNode();
                    await controller.deleteNode();

                    await controller.performDrop({
                        source: {
                            instanceKey: "2",
                            displayId: "2",
                            structuralStableId: "child-a",
                            sourceStableId: "child-a",
                            sourceTreePath: null,
                            subtreeStack: [],
                        },
                        target: {
                            instanceKey: "3",
                            displayId: "3",
                            structuralStableId: "child-b",
                            sourceStableId: "child-b",
                            sourceTreePath: null,
                            subtreeStack: [],
                        },
                        position: "after",
                    });

                    await controller.selectNode("3");
                    assert.ok(selectedNodeTarget);
                    await controller.applyDocumentSnapshot({
                        content,
                        documentSession: {
                            dirty: false,
                            historyIndex: 0,
                            historyLength: 1,
                            lastSavedSnapshot: content,
                            alertReload: false,
                            pendingExternalContent: null,
                        },
                        selection: {
                            kind: "node",
                            ref: selectedNodeTarget,
                        },
                        syncKind: "update",
                    });
                    await controller.saveSelectedAsSubtree();
                } finally {
                    if (previousNavigator) {
                        Object.defineProperty(globalThis, "navigator", previousNavigator);
                    } else {
                        Reflect.deleteProperty(globalThis, "navigator");
                    }
                }

                assert.deepEqual(
                    mutations.map((mutation) => mutation.type),
                    [
                        "insertNode",
                        "pasteNode",
                        "replaceNode",
                        "deleteNode",
                        "performDrop",
                        "saveSelectedAsSubtree",
                    ]
                );
                assert.deepEqual(
                    documentStore
                        .getState()
                        .persistedTree?.root.children?.map((child) => child.uuid),
                    ["child-a", "child-b"]
                );
            },
        },
        {
            name: "anchors structural mutation rebuilds on local target context nodes",
            async run() {
                const createDocumentSession = (content: string) => ({
                    dirty: false,
                    historyIndex: 0,
                    historyLength: 1,
                    lastSavedSnapshot: content,
                    alertReload: false,
                    pendingExternalContent: null,
                });
                const createTreeWithChildren = () => {
                    const tree = createTestTree();
                    tree.root.children = [
                        {
                            uuid: "child-a",
                            id: "2",
                            name: "ActionA",
                        },
                        {
                            uuid: "child-b",
                            id: "3",
                            name: "ActionB",
                        },
                    ];
                    return tree;
                };
                const createNodeDefs = (): NodeDef[] => [
                    {
                        name: "Sequence",
                        type: "Composite",
                        desc: "",
                        status: ["success"],
                    },
                    {
                        name: "ActionA",
                        type: "Action",
                        desc: "",
                    },
                    {
                        name: "ActionB",
                        type: "Action",
                        desc: "",
                    },
                ];
                const createRef = (
                    instanceKey: string,
                    structuralStableId: string
                ): NodeInstanceRef => ({
                    instanceKey,
                    displayId: instanceKey,
                    structuralStableId,
                    sourceStableId: structuralStableId,
                    sourceTreePath: null,
                    subtreeStack: [],
                });

                const setupController = async (nearestAnchorResult: string | null = null) => {
                    const documentStore = createDocumentStore();
                    const workspaceStore = createWorkspaceStore();
                    const selectionStore = createSelectionStore();
                    const graphUiStore = createGraphUiStore();
                    const appHooks = createAppHooksStore();
                    appHooks.bind({
                        message: {
                            success() {},
                            error() {},
                        } as any,
                        notification: {} as any,
                        modal: {} as any,
                    });

                    const mutations: DocumentMutation[] = [];
                    const selectedNodeTargets: NodeInstanceRef[] = [];
                    const renderAnchors: Array<string | null> = [];
                    const nearestAnchorCalls: Array<{
                        sourceNodeKey: string;
                        candidateNodeKeys: string[];
                    }> = [];
                    const hostAdapter: HostAdapter = {
                        connect: () => () => {},
                        sendReady() {},
                        undo() {},
                        redo() {},
                        async mutateDocument(mutation) {
                            mutations.push(mutation);
                            return { success: true };
                        },
                        selectTree() {},
                        selectNode(target) {
                            selectedNodeTargets.push(target);
                        },
                        requestFocusVariable() {},
                        sendRequestSetting() {},
                        sendBuild() {},
                        async validateNodeChecks() {
                            return { diagnostics: [] };
                        },
                        async saveDocument() {
                            return { success: true };
                        },
                        async revertDocument() {
                            return { success: true };
                        },
                        async readFile() {
                            return { content: "{}" };
                        },
                        async saveSubtree() {
                            return { success: true };
                        },
                        async saveSubtreeAs() {
                            return { savedPath: null };
                        },
                        log() {},
                    };
                    const graphAdapter: GraphAdapter = {
                        async mount() {},
                        unmount() {},
                        async render(_model, opts) {
                            renderAnchors.push(opts?.anchorNodeKey ?? null);
                        },
                        pickNearestNodeAnchor(sourceNodeKey, candidateNodeKeys) {
                            nearestAnchorCalls.push({
                                sourceNodeKey,
                                candidateNodeKeys: [...candidateNodeKeys],
                            });
                            return nearestAnchorResult;
                        },
                        async applySelection() {},
                        async applyHighlights() {},
                        async applySearch() {},
                        async focusNode() {},
                        async restoreViewport() {},
                        getViewport: () => ({ zoom: 1, x: 0, y: 0 }),
                    };
                    const controller = createEditorController({
                        documentStore,
                        workspaceStore,
                        selectionStore,
                        graphUiStore,
                        hostAdapter,
                        graphAdapter,
                        appHooks,
                    });

                    const tree = createTreeWithChildren();
                    const content = serializePersistedTree(tree);
                    await controller.initFromHost({
                        filePath: "/tmp/main.json",
                        workdir: "/tmp",
                        content,
                        nodeDefs: createNodeDefs(),
                        allFiles: [],
                        settings: {
                            checkExpr: true,
                            subtreeEditable: true,
                            language: "en",
                            theme: "light",
                        },
                        documentSession: createDocumentSession(content),
                        selection: { kind: "tree" },
                    });

                    return {
                        controller,
                        tree,
                        content,
                        mutations,
                        renderAnchors,
                        nearestAnchorCalls,
                        selectedNodeTargets,
                    };
                };

                const dropSetup = await setupController();
                const sourceRef = createRef("2", "child-a");
                const targetRef = createRef("3", "child-b");
                await dropSetup.controller.performDrop({
                    source: sourceRef,
                    target: targetRef,
                    position: "child",
                });
                const dropMutation = dropSetup.mutations[0];
                assert.equal(dropMutation?.type, "performDrop");
                if (dropMutation?.type !== "performDrop") {
                    return;
                }
                const dropResult = reduceDocumentMutation(dropMutation, {
                    tree: dropSetup.tree,
                    nodeDefs: createNodeDefs(),
                });
                assert.equal(dropResult.status, "changed");
                if (dropResult.status !== "changed") {
                    return;
                }
                const dropContent = serializePersistedTree(dropResult.tree);
                await dropSetup.controller.applyDocumentSnapshot({
                    content: dropContent,
                    documentSession: createDocumentSession(dropContent),
                    selection: { kind: "node", ref: sourceRef },
                    syncKind: "update",
                });
                assert.equal(dropSetup.renderAnchors[dropSetup.renderAnchors.length - 1], "3");

                const insertSetup = await setupController();
                await insertSetup.controller.selectNode("3");
                const selectedTarget =
                    insertSetup.selectedNodeTargets[insertSetup.selectedNodeTargets.length - 1];
                assert.ok(selectedTarget);
                await insertSetup.controller.applyDocumentSnapshot({
                    content: insertSetup.content,
                    documentSession: createDocumentSession(insertSetup.content),
                    selection: { kind: "node", ref: selectedTarget },
                    syncKind: "update",
                });
                await insertSetup.controller.insertNode();
                const insertMutation = insertSetup.mutations[0];
                assert.equal(insertMutation?.type, "insertNode");
                if (insertMutation?.type !== "insertNode") {
                    return;
                }
                const insertResult = reduceDocumentMutation(insertMutation, {
                    tree: insertSetup.tree,
                    nodeDefs: createNodeDefs(),
                });
                assert.equal(insertResult.status, "changed");
                if (insertResult.status !== "changed") {
                    return;
                }
                const insertContent = serializePersistedTree(insertResult.tree);
                await insertSetup.controller.applyDocumentSnapshot({
                    content: insertContent,
                    documentSession: createDocumentSession(insertContent),
                    selection: { kind: "tree" },
                    syncKind: "update",
                });
                assert.equal(insertSetup.renderAnchors[insertSetup.renderAnchors.length - 1], "3");

                const deleteSetup = await setupController("2");
                await deleteSetup.controller.selectNode("3");
                const deletedTarget =
                    deleteSetup.selectedNodeTargets[deleteSetup.selectedNodeTargets.length - 1];
                assert.ok(deletedTarget);
                await deleteSetup.controller.applyDocumentSnapshot({
                    content: deleteSetup.content,
                    documentSession: createDocumentSession(deleteSetup.content),
                    selection: { kind: "node", ref: deletedTarget },
                    syncKind: "update",
                });
                await deleteSetup.controller.deleteNode();
                assert.deepEqual(deleteSetup.nearestAnchorCalls, [
                    {
                        sourceNodeKey: "3",
                        candidateNodeKeys: ["2", "1"],
                    },
                ]);
                const deleteMutation = deleteSetup.mutations[0];
                assert.equal(deleteMutation?.type, "deleteNode");
                if (deleteMutation?.type !== "deleteNode") {
                    return;
                }
                const deleteResult = reduceDocumentMutation(deleteMutation, {
                    tree: deleteSetup.tree,
                    nodeDefs: createNodeDefs(),
                });
                assert.equal(deleteResult.status, "changed");
                if (deleteResult.status !== "changed") {
                    return;
                }
                const deleteContent = serializePersistedTree(deleteResult.tree);
                await deleteSetup.controller.applyDocumentSnapshot({
                    content: deleteContent,
                    documentSession: createDocumentSession(deleteContent),
                    selection: { kind: "node", ref: createRef("1", "root") },
                    syncKind: "update",
                });
                assert.equal(deleteSetup.renderAnchors[deleteSetup.renderAnchors.length - 1], "2");

                await insertSetup.controller.refreshGraph({ preserveSelection: true });
                assert.equal(insertSetup.renderAnchors[insertSetup.renderAnchors.length - 1], null);
            },
        },
        {
            name: "routes editor metadata and node updates through host mutation intents",
            async run() {
                const documentStore = createDocumentStore();
                const workspaceStore = createWorkspaceStore();
                const selectionStore = createSelectionStore();
                const graphUiStore = createGraphUiStore();
                const appHooks = createAppHooksStore();
                appHooks.bind({
                    message: {
                        success() {},
                        error() {},
                    } as any,
                    notification: {} as any,
                    modal: {} as any,
                });

                const mutations: DocumentMutation[] = [];
                let selectedNodeTarget: NodeInstanceRef | null = null;
                const hostAdapter: HostAdapter = {
                    connect: () => () => {},
                    sendReady() {},
                    undo() {},
                    redo() {},
                    async mutateDocument(mutation) {
                        mutations.push(mutation);
                        return { success: true };
                    },
                    selectTree() {},
                    selectNode(target) {
                        selectedNodeTarget = target;
                    },
                    requestFocusVariable() {},
                    sendRequestSetting() {},
                    sendBuild() {},
                    async validateNodeChecks() {
                        return { diagnostics: [] };
                    },
                    async saveDocument() {
                        return { success: true };
                    },
                    async revertDocument() {
                        return { success: true };
                    },
                    async readFile() {
                        return { content: "{}" };
                    },
                    async saveSubtree() {
                        return { success: true };
                    },
                    async saveSubtreeAs() {
                        return { savedPath: null };
                    },
                    log() {},
                };
                const graphAdapter: GraphAdapter = {
                    async mount() {},
                    unmount() {},
                    async render() {},
                    async applySelection() {},
                    async applyHighlights() {},
                    async applySearch() {},
                    async focusNode() {},
                    async restoreViewport() {},
                    getViewport: () => ({ zoom: 1, x: 0, y: 0 }),
                };
                const controller = createEditorController({
                    documentStore,
                    workspaceStore,
                    selectionStore,
                    graphUiStore,
                    hostAdapter,
                    graphAdapter,
                    appHooks,
                });

                const tree = createTestTree();
                const content = serializePersistedTree(tree);
                await controller.initFromHost({
                    filePath: "/tmp/main.json",
                    workdir: "/tmp",
                    content,
                    nodeDefs: [
                        {
                            name: "Sequence",
                            type: "Composite",
                            desc: "",
                            status: ["success"],
                        },
                    ],
                    allFiles: [],
                    settings: {
                        checkExpr: true,
                        subtreeEditable: true,
                        language: "en",
                        theme: "light",
                    },
                    documentSession: {
                        dirty: false,
                        historyIndex: 0,
                        historyLength: 1,
                        lastSavedSnapshot: content,
                        alertReload: false,
                        pendingExternalContent: null,
                    },
                    selection: { kind: "tree" },
                });

                await controller.updateTreeMeta({
                    desc: "updated",
                    prefix: "",
                    export: true,
                    group: [],
                    variables: {
                        imports: [],
                        locals: [],
                    },
                });

                await controller.selectNode("1");
                assert.ok(selectedNodeTarget);
                await controller.applyDocumentSnapshot({
                    content,
                    documentSession: {
                        dirty: false,
                        historyIndex: 0,
                        historyLength: 1,
                        lastSavedSnapshot: content,
                        alertReload: false,
                        pendingExternalContent: null,
                    },
                    selection: {
                        kind: "node",
                        ref: selectedNodeTarget,
                    },
                    syncKind: "update",
                });
                const target = selectionStore.getState().selectedNodeRef;
                assert.ok(target);
                await controller.updateNode({
                    target,
                    data: {
                        name: "Sequence",
                        desc: "changed",
                    },
                });

                assert.deepEqual(
                    mutations.map((mutation) => mutation.type),
                    ["updateTreeMeta", "updateNode"]
                );
                assert.equal(documentStore.getState().persistedTree?.desc, undefined);
                const updateNodeMutation = mutations[1];
                assert.equal(updateNodeMutation?.type, "updateNode");
                if (updateNodeMutation?.type !== "updateNode") {
                    return;
                }
                assert.equal(updateNodeMutation.payload.currentNodeSnapshot?.data.uuid, "root");
                assert.equal(updateNodeMutation.payload.currentNodeSnapshot?.subtreeNode, false);
            },
        },
        {
            name: "forwards noop editor mutation intents to host without local reducer preflight",
            async run() {
                const documentStore = createDocumentStore();
                const workspaceStore = createWorkspaceStore();
                const selectionStore = createSelectionStore();
                const graphUiStore = createGraphUiStore();
                const appHooks = createAppHooksStore();
                appHooks.bind({
                    message: {
                        success() {},
                        error() {},
                    } as any,
                    notification: {} as any,
                    modal: {} as any,
                });

                const mutations: DocumentMutation[] = [];
                let selectedNodeTarget: NodeInstanceRef | null = null;
                const hostAdapter: HostAdapter = {
                    connect: () => () => {},
                    sendReady() {},
                    undo() {},
                    redo() {},
                    async mutateDocument(mutation) {
                        mutations.push(mutation);
                        return { success: true };
                    },
                    selectTree() {},
                    selectNode(target) {
                        selectedNodeTarget = target;
                    },
                    requestFocusVariable() {},
                    sendRequestSetting() {},
                    sendBuild() {},
                    async validateNodeChecks() {
                        return { diagnostics: [] };
                    },
                    async saveDocument() {
                        return { success: true };
                    },
                    async revertDocument() {
                        return { success: true };
                    },
                    async readFile() {
                        return { content: "{}" };
                    },
                    async saveSubtree() {
                        return { success: true };
                    },
                    async saveSubtreeAs() {
                        return { savedPath: null };
                    },
                    log() {},
                };
                const graphAdapter: GraphAdapter = {
                    async mount() {},
                    unmount() {},
                    async render() {},
                    async applySelection() {},
                    async applyHighlights() {},
                    async applySearch() {},
                    async focusNode() {},
                    async restoreViewport() {},
                    getViewport: () => ({ zoom: 1, x: 0, y: 0 }),
                };
                const controller = createEditorController({
                    documentStore,
                    workspaceStore,
                    selectionStore,
                    graphUiStore,
                    hostAdapter,
                    graphAdapter,
                    appHooks,
                });

                const tree = createTestTree();
                const content = serializePersistedTree(tree);
                await controller.initFromHost({
                    filePath: "/tmp/main.json",
                    workdir: "/tmp",
                    content,
                    nodeDefs: [
                        {
                            name: "Sequence",
                            type: "Composite",
                            desc: "",
                            status: ["success"],
                        },
                    ],
                    allFiles: [],
                    settings: {
                        checkExpr: true,
                        subtreeEditable: true,
                        language: "en",
                        theme: "light",
                    },
                    documentSession: {
                        dirty: false,
                        historyIndex: 0,
                        historyLength: 1,
                        lastSavedSnapshot: content,
                        alertReload: false,
                        pendingExternalContent: null,
                    },
                    selection: { kind: "tree" },
                });

                await controller.updateTreeMeta({
                    prefix: "",
                    export: true,
                    group: [],
                    variables: {
                        imports: [],
                        locals: [],
                    },
                });

                await controller.selectNode("1");
                assert.ok(selectedNodeTarget);
                await controller.applyDocumentSnapshot({
                    content,
                    documentSession: {
                        dirty: false,
                        historyIndex: 0,
                        historyLength: 1,
                        lastSavedSnapshot: content,
                        alertReload: false,
                        pendingExternalContent: null,
                    },
                    selection: {
                        kind: "node",
                        ref: selectedNodeTarget,
                    },
                    syncKind: "update",
                });

                const target = selectionStore.getState().selectedNodeRef;
                assert.ok(target);
                await controller.updateNode({
                    target,
                    data: {
                        name: "Sequence",
                    },
                });

                assert.deepEqual(
                    mutations.map((mutation) => mutation.type),
                    ["updateTreeMeta", "updateNode"]
                );
                const updateNodeMutation = mutations[1];
                assert.equal(updateNodeMutation?.type, "updateNode");
                if (updateNodeMutation?.type !== "updateNode") {
                    return;
                }
                assert.equal(updateNodeMutation.payload.currentNodeSnapshot?.data.uuid, "root");
                assert.equal(updateNodeMutation.payload.currentNodeSnapshot?.subtreeNode, false);
            },
        },
        {
            name: "applies host document snapshots and host selection through controller projection",
            async run() {
                const documentStore = createDocumentStore();
                const workspaceStore = createWorkspaceStore();
                const selectionStore = createSelectionStore();
                const graphUiStore = createGraphUiStore();
                const appHooks = createAppHooksStore();
                let appliedSelectionKey: string | null = null;

                appHooks.bind({
                    message: {
                        success() {},
                        error() {},
                    } as any,
                    notification: {} as any,
                    modal: {} as any,
                });

                const hostAdapter: HostAdapter = {
                    connect: () => () => {},
                    sendReady() {},
                    undo() {},
                    redo() {},
                    async mutateDocument() {
                        return { success: true };
                    },
                    selectTree() {},
                    selectNode() {},
                    requestFocusVariable() {},
                    sendRequestSetting() {},
                    sendBuild() {},
                    async validateNodeChecks() {
                        return { diagnostics: [] };
                    },
                    async saveDocument() {
                        return { success: true };
                    },
                    async revertDocument() {
                        return { success: true };
                    },
                    async readFile() {
                        return { content: "{}" };
                    },
                    async saveSubtree() {
                        return { success: true };
                    },
                    async saveSubtreeAs() {
                        return { savedPath: null };
                    },
                    log() {},
                };
                const graphAdapter: GraphAdapter = {
                    async mount() {},
                    unmount() {},
                    async render() {},
                    async applySelection(payload) {
                        appliedSelectionKey = payload.selectedNodeKey;
                    },
                    async applyHighlights() {},
                    async applySearch() {},
                    async focusNode() {},
                    async restoreViewport() {},
                    getViewport: () => ({ zoom: 1, x: 0, y: 0 }),
                };

                const controller = createEditorController({
                    documentStore,
                    workspaceStore,
                    selectionStore,
                    graphUiStore,
                    hostAdapter,
                    graphAdapter,
                    appHooks,
                });

                const initialTree = createTestTree();
                initialTree.root.children = [
                    {
                        uuid: "child-a",
                        id: "2",
                        name: "ActionA",
                    },
                    {
                        uuid: "child-b",
                        id: "3",
                        name: "ActionB",
                    },
                ];
                const initialContent = serializePersistedTree(initialTree);
                await controller.initFromHost({
                    filePath: "/tmp/main.json",
                    workdir: "/tmp",
                    content: initialContent,
                    nodeDefs: [
                        {
                            name: "Sequence",
                            type: "Composite",
                            desc: "",
                            status: ["success"],
                        },
                        {
                            name: "ActionA",
                            type: "Action",
                            desc: "",
                        },
                        {
                            name: "ActionB",
                            type: "Action",
                            desc: "",
                        },
                        {
                            name: "ActionC",
                            type: "Action",
                            desc: "",
                        },
                    ],
                    allFiles: [],
                    settings: {
                        checkExpr: true,
                        subtreeEditable: true,
                        language: "en",
                        theme: "light",
                    },
                    documentSession: {
                        dirty: false,
                        historyIndex: 0,
                        historyLength: 1,
                        lastSavedSnapshot: initialContent,
                        alertReload: false,
                        pendingExternalContent: null,
                    },
                    selection: { kind: "tree" },
                });

                const nextTree = createTestTree();
                nextTree.root.children = [
                    {
                        uuid: "child-a",
                        id: "2",
                        name: "ActionA",
                    },
                    {
                        uuid: "child-b",
                        id: "3",
                        name: "ActionB",
                    },
                    {
                        uuid: "child-c",
                        id: "4",
                        name: "ActionC",
                    },
                ];
                const nextContent = serializePersistedTree(nextTree);

                await controller.applyDocumentSnapshot({
                    content: nextContent,
                    documentSession: {
                        dirty: true,
                        historyIndex: 1,
                        historyLength: 2,
                        lastSavedSnapshot: initialContent,
                        alertReload: false,
                        pendingExternalContent: null,
                    },
                    selection: {
                        kind: "node",
                        ref: {
                            instanceKey: "child-c",
                            displayId: "",
                            structuralStableId: "child-c",
                            sourceStableId: "child-c",
                            sourceTreePath: null,
                            subtreeStack: [],
                        },
                    },
                    syncKind: "update",
                });

                assert.equal(documentStore.getState().dirty, true);
                assert.equal(
                    documentStore.getState().persistedTree?.root.children?.[2]?.uuid,
                    "child-c"
                );
                assert.equal(
                    selectionStore.getState().selectedNodeRef?.structuralStableId,
                    "child-c"
                );
                assert.equal(selectionStore.getState().selectedNodeSnapshot?.data.uuid, "child-c");
                assert.equal(
                    appliedSelectionKey,
                    selectionStore.getState().selectedNodeRef?.instanceKey ?? null
                );
            },
        },
        {
            name: "queues host node reveal until the graph is ready and then focuses the target node",
            async run() {
                const documentStore = createDocumentStore();
                const workspaceStore = createWorkspaceStore();
                const selectionStore = createSelectionStore();
                const graphUiStore = createGraphUiStore();
                const appHooks = createAppHooksStore();
                const focusedNodeKeys: string[] = [];
                let appliedSelectionKey: string | null = null;

                appHooks.bind({
                    message: {
                        success() {},
                        error() {},
                    } as any,
                    notification: {} as any,
                    modal: {} as any,
                });

                const hostAdapter: HostAdapter = {
                    connect: () => () => {},
                    sendReady() {},
                    undo() {},
                    redo() {},
                    async mutateDocument() {
                        return { success: true };
                    },
                    selectTree() {},
                    selectNode() {},
                    requestFocusVariable() {},
                    sendRequestSetting() {},
                    sendBuild() {},
                    async validateNodeChecks() {
                        return { diagnostics: [] };
                    },
                    async saveDocument() {
                        return { success: true };
                    },
                    async revertDocument() {
                        return { success: true };
                    },
                    async readFile() {
                        return { content: "{}" };
                    },
                    async saveSubtree() {
                        return { success: true };
                    },
                    async saveSubtreeAs() {
                        return { savedPath: null };
                    },
                    log() {},
                };
                const graphAdapter: GraphAdapter = {
                    async mount() {},
                    unmount() {},
                    async render() {},
                    async applySelection(payload) {
                        appliedSelectionKey = payload.selectedNodeKey;
                    },
                    async applyHighlights() {},
                    async applySearch() {},
                    async focusNode(nodeKey) {
                        focusedNodeKeys.push(nodeKey);
                    },
                    async restoreViewport() {},
                    getViewport: () => ({ zoom: 1, x: 0, y: 0 }),
                };

                const controller = createEditorController({
                    documentStore,
                    workspaceStore,
                    selectionStore,
                    graphUiStore,
                    hostAdapter,
                    graphAdapter,
                    appHooks,
                });

                await controller.revealNode({
                    instanceKey: "child-b",
                    displayId: "",
                    structuralStableId: "child-b",
                    sourceStableId: "child-b",
                    sourceTreePath: null,
                    subtreeStack: [],
                });
                assert.deepEqual(focusedNodeKeys, []);

                const tree = createTestTree();
                tree.root.children = [
                    {
                        uuid: "child-a",
                        id: "2",
                        name: "ActionA",
                    },
                    {
                        uuid: "child-b",
                        id: "3",
                        name: "ActionB",
                    },
                ];
                const content = serializePersistedTree(tree);

                await controller.initFromHost({
                    filePath: "/tmp/main.json",
                    workdir: "/tmp",
                    content,
                    nodeDefs: [
                        {
                            name: "Sequence",
                            type: "Composite",
                            desc: "",
                            status: ["success"],
                        },
                        {
                            name: "ActionA",
                            type: "Action",
                            desc: "",
                        },
                        {
                            name: "ActionB",
                            type: "Action",
                            desc: "",
                        },
                    ],
                    allFiles: [],
                    settings: {
                        checkExpr: true,
                        subtreeEditable: true,
                        language: "en",
                        theme: "light",
                    },
                    documentSession: {
                        dirty: false,
                        historyIndex: 0,
                        historyLength: 1,
                        lastSavedSnapshot: content,
                        alertReload: false,
                        pendingExternalContent: null,
                    },
                    selection: {
                        kind: "node",
                        ref: {
                            instanceKey: "child-b",
                            displayId: "",
                            structuralStableId: "child-b",
                            sourceStableId: "child-b",
                            sourceTreePath: null,
                            subtreeStack: [],
                        },
                    },
                });

                assert.deepEqual(focusedNodeKeys, ["3"]);
                assert.equal(
                    selectionStore.getState().selectedNodeRef?.structuralStableId,
                    "child-b"
                );
                assert.equal(selectionStore.getState().selectedNodeSnapshot?.data.uuid, "child-b");
                assert.equal(appliedSelectionKey, "3");
            },
        },
        {
            name: "full host init restores subtree selections against the rebuilt document graph",
            async run() {
                const documentStore = createDocumentStore();
                const workspaceStore = createWorkspaceStore();
                const selectionStore = createSelectionStore();
                const graphUiStore = createGraphUiStore();
                const appHooks = createAppHooksStore();
                let appliedSelectionKey: string | null = null;

                appHooks.bind({
                    message: {
                        success() {},
                        error() {},
                    } as any,
                    notification: {} as any,
                    modal: {} as any,
                });

                const mainTree = createTestTree();
                mainTree.root.children = [
                    {
                        uuid: "main-link",
                        id: "2",
                        name: "SubtreeRef",
                        path: "sub/outer.json" as any,
                    },
                ];
                const outerTree = createTestTree();
                outerTree.root.uuid = "outer-root";
                outerTree.root.id = "1";
                outerTree.root.name = "OuterRoot";
                outerTree.root.children = [
                    {
                        uuid: "outer-link",
                        id: "2",
                        name: "SubtreeRef",
                        path: "sub/deep.json" as any,
                    },
                ];
                const deepTree = createTestTree();
                deepTree.root.uuid = "deep-root";
                deepTree.root.id = "1";
                deepTree.root.name = "DeepRoot";
                deepTree.root.children = [
                    {
                        uuid: "deep-leaf",
                        id: "2",
                        name: "DeepLeaf",
                    },
                ];

                const mainContent = serializePersistedTree(mainTree);
                const outerContent = serializePersistedTree(outerTree);
                const deepContent = serializePersistedTree(deepTree);

                const hostAdapter: HostAdapter = {
                    connect: () => () => {},
                    sendReady() {},
                    undo() {},
                    redo() {},
                    async mutateDocument() {
                        return { success: true };
                    },
                    selectTree() {},
                    selectNode() {},
                    requestFocusVariable() {},
                    sendRequestSetting() {},
                    sendBuild() {},
                    async validateNodeChecks() {
                        return { diagnostics: [] };
                    },
                    async saveDocument() {
                        return { success: true };
                    },
                    async revertDocument() {
                        return { success: true };
                    },
                    async readFile(path) {
                        if (path === "sub/outer.json") {
                            return { content: outerContent };
                        }
                        if (path === "sub/deep.json") {
                            return { content: deepContent };
                        }
                        return { content: null };
                    },
                    async saveSubtree() {
                        return { success: true };
                    },
                    async saveSubtreeAs() {
                        return { savedPath: null };
                    },
                    log() {},
                };
                const graphAdapter: GraphAdapter = {
                    async mount() {},
                    unmount() {},
                    async render() {},
                    async applySelection(payload) {
                        appliedSelectionKey = payload.selectedNodeKey;
                    },
                    async applyHighlights() {},
                    async applySearch() {},
                    async focusNode() {},
                    async restoreViewport() {},
                    getViewport: () => ({ zoom: 1, x: 0, y: 0 }),
                };
                const controller = createEditorController({
                    documentStore,
                    workspaceStore,
                    selectionStore,
                    graphUiStore,
                    hostAdapter,
                    graphAdapter,
                    appHooks,
                });

                const nodeDefs: NodeDef[] = [
                    {
                        name: "Sequence",
                        type: "Composite",
                        desc: "",
                        status: ["success"],
                    },
                    {
                        name: "SubtreeRef",
                        type: "Action",
                        desc: "",
                    },
                    {
                        name: "OuterRoot",
                        type: "Composite",
                        desc: "",
                        status: ["success"],
                    },
                    {
                        name: "DeepRoot",
                        type: "Composite",
                        desc: "",
                        status: ["success"],
                    },
                    {
                        name: "DeepLeaf",
                        type: "Action",
                        desc: "",
                    },
                ];

                await controller.initFromHost({
                    filePath: "/tmp/sub/outer.json",
                    workdir: "/tmp",
                    content: outerContent,
                    nodeDefs,
                    allFiles: ["sub/outer.json" as any, "sub/deep.json" as any],
                    settings: {
                        checkExpr: true,
                        subtreeEditable: true,
                        language: "en",
                        theme: "light",
                    },
                    documentSession: {
                        dirty: false,
                        historyIndex: 0,
                        historyLength: 1,
                        lastSavedSnapshot: outerContent,
                        alertReload: false,
                        pendingExternalContent: null,
                    },
                    selection: { kind: "tree" },
                });

                const mainGraph = resolveDocumentGraph({
                    persistedTree: mainTree,
                    subtreeSources: {
                        "sub/outer.json": parsePersistedTreeContent(
                            outerContent,
                            "/tmp/sub/outer.json"
                        ),
                        "sub/deep.json": parsePersistedTreeContent(
                            deepContent,
                            "/tmp/sub/deep.json"
                        ),
                    },
                    nodeDefs,
                    subtreeEditable: true,
                }).graph;

                const nestedSubtreeRoot =
                    Object.values(mainGraph.nodesByInstanceKey).find(
                        (node) =>
                            node.ref.sourceStableId === "deep-root" &&
                            node.ref.sourceTreePath === ("sub/deep.json" as any) &&
                            node.ref.subtreeStack.length === 2 &&
                            node.ref.subtreeStack[0] === ("sub/outer.json" as any) &&
                            node.ref.subtreeStack[1] === ("sub/deep.json" as any)
                    )?.ref ?? null;

                assert.ok(nestedSubtreeRoot);
                assert.equal(nestedSubtreeRoot.instanceKey, "3");

                await controller.initFromHost({
                    filePath: "/tmp/main.json",
                    workdir: "/tmp",
                    content: mainContent,
                    nodeDefs,
                    allFiles: ["sub/outer.json" as any, "sub/deep.json" as any],
                    settings: {
                        checkExpr: true,
                        subtreeEditable: true,
                        language: "en",
                        theme: "light",
                    },
                    documentSession: {
                        dirty: false,
                        historyIndex: 0,
                        historyLength: 1,
                        lastSavedSnapshot: mainContent,
                        alertReload: false,
                        pendingExternalContent: null,
                    },
                    selection: {
                        kind: "node",
                        ref: nestedSubtreeRoot,
                    },
                });

                assert.equal(
                    selectionStore.getState().selectedNodeRef?.sourceStableId,
                    "deep-root"
                );
                assert.equal(
                    selectionStore.getState().selectedNodeRef?.sourceTreePath,
                    "sub/deep.json"
                );
                assert.deepEqual(selectionStore.getState().selectedNodeRef?.subtreeStack, [
                    "sub/outer.json",
                    "sub/deep.json",
                ]);
                assert.equal(
                    selectionStore.getState().selectedNodeSnapshot?.data.uuid,
                    "deep-root"
                );
                assert.equal(
                    appliedSelectionKey,
                    selectionStore.getState().selectedNodeRef?.instanceKey ?? null
                );
            },
        },
        {
            name: "resolves project files and builds from the CLI API",
            async run() {
                const root = fs.mkdtempSync(path.join(os.tmpdir(), "behavior3-cli-"));
                const workspaceFile = path.join(root, "workspace.b3-workspace");
                const settingFile = path.join(root, "node-config.b3-setting");
                const treeFile = path.join(root, "main.json");
                const outputDir = path.join(root, "dist");

                try {
                    fs.writeFileSync(
                        workspaceFile,
                        JSON.stringify({
                            settings: {
                                checkExpr: true,
                            },
                        }),
                        "utf-8"
                    );
                    fs.writeFileSync(
                        settingFile,
                        JSON.stringify([
                            {
                                name: "Sequence",
                                type: "Composite",
                                desc: "",
                                children: -1,
                                status: ["|success"],
                            },
                            {
                                name: "Log",
                                type: "Action",
                                desc: "",
                            },
                        ]),
                        "utf-8"
                    );
                    fs.writeFileSync(
                        treeFile,
                        JSON.stringify({
                            version: "2.0.0",
                            name: "main",
                            prefix: "",
                            group: [],
                            variables: {
                                imports: [],
                                locals: [],
                            },
                            custom: {},
                            overrides: {},
                            root: {
                                uuid: "root",
                                id: "1",
                                name: "Sequence",
                                children: [
                                    {
                                        uuid: "leaf",
                                        id: "2",
                                        name: "Log",
                                    },
                                ],
                            },
                        }),
                        "utf-8"
                    );

                    const resolved = resolveBehaviorBuildPaths({
                        projectPath: treeFile,
                        outputDir,
                    });

                    assert.equal(resolved.workspaceFile, workspaceFile);
                    assert.equal(resolved.settingFile, settingFile);
                    assert.equal(resolved.workdir, root);
                    assert.equal(resolved.outputDir, outputDir);

                    const result = await buildBehaviorProject({
                        projectPath: treeFile,
                        outputDir,
                    });

                    assert.equal(result.hasError, false);
                    assert.equal(fs.existsSync(path.join(outputDir, "main.json")), true);
                } finally {
                    fs.rmSync(root, { recursive: true, force: true });
                }
            },
        },
        {
            name: "loads decorated TypeScript build scripts with local TypeScript imports",
            async run() {
                const root = fs.mkdtempSync(path.join(os.tmpdir(), "behavior3-build-ts-import-"));
                const scriptsDir = path.join(root, "scripts");
                const workspaceFile = path.join(root, "workspace.b3-workspace");
                const settingFile = path.join(root, "node-config.b3-setting");
                const treeFile = path.join(root, "main.json");
                const buildScriptFile = path.join(scriptsDir, "build.ts");
                const helperFile = path.join(scriptsDir, "helper.ts");
                const constantsFile = path.join(scriptsDir, "constants.ts");
                const outputDir = path.join(root, "dist");

                try {
                    fs.mkdirSync(scriptsDir, { recursive: true });
                    fs.writeFileSync(
                        workspaceFile,
                        JSON.stringify({
                            settings: {
                                buildScript: "scripts/build.ts",
                            },
                        })
                    );
                    fs.writeFileSync(
                        settingFile,
                        JSON.stringify([
                            {
                                name: "Root",
                                type: "Composite",
                                desc: "",
                                children: -1,
                            },
                        ])
                    );
                    fs.writeFileSync(
                        treeFile,
                        JSON.stringify({
                            version: "2.0.0",
                            name: "main",
                            prefix: "",
                            group: [],
                            variables: {
                                imports: [],
                                locals: [],
                            },
                            custom: {},
                            overrides: {},
                            root: {
                                uuid: "root",
                                id: "1",
                                name: "Root",
                                children: [],
                            },
                        })
                    );
                    fs.writeFileSync(
                        constantsFile,
                        [
                            'export const helperValue = "imported-helper";',
                            "export type HelperTree = { custom?: Record<string, unknown> };",
                            "",
                        ].join("\n")
                    );
                    fs.writeFileSync(
                        helperFile,
                        [
                            'import { helperValue, type HelperTree } from "./constants.ts";',
                            "",
                            "export function markTree(tree: HelperTree) {",
                            "  tree.custom = { ...(tree.custom ?? {}), helperValue };",
                            "}",
                            "",
                        ].join("\n")
                    );
                    fs.writeFileSync(
                        buildScriptFile,
                        [
                            'import { markTree } from "./helper.ts";',
                            "",
                            "@behavior3.build",
                            "export class CustomBuildScript {",
                            "  onProcessTree(tree) {",
                            "    markTree(tree);",
                            "    return tree;",
                            "  }",
                            "}",
                            "",
                        ].join("\n")
                    );
                    fs.writeFileSync(path.join(scriptsDir, "build.runtime.stale.0.mjs"), "");
                    fs.writeFileSync(path.join(scriptsDir, "helper.runtime.stale.1.mjs"), "");

                    const result = await buildBehaviorProject({
                        projectPath: treeFile,
                        outputDir,
                    });
                    const outputTree = JSON.parse(
                        fs.readFileSync(path.join(outputDir, "main.json"), "utf-8")
                    );
                    const runtimeFiles = fs
                        .readdirSync(scriptsDir)
                        .filter((file) => file.includes(".runtime.") && file.endsWith(".mjs"));

                    assert.equal(result.hasError, false);
                    assert.equal(outputTree.custom.helperValue, "imported-helper");
                    assert.deepEqual(runtimeFiles, []);
                } finally {
                    fs.rmSync(root, { recursive: true, force: true });
                }
            },
        },
        {
            name: "batch processes source trees with TypeScript imports and rewrites files in place",
            async run() {
                const root = fs.mkdtempSync(path.join(os.tmpdir(), "behavior3-batch-ts-import-"));
                const scriptsDir = path.join(root, "scripts");
                const workspaceFile = path.join(root, "workspace.b3-workspace");
                const settingFile = path.join(root, "node-config.b3-setting");
                const mainTreeFile = path.join(root, "main.json");
                const nestedTreeFile = path.join(root, "trees", "secondary.json");
                const buildScriptFile = path.join(scriptsDir, "batch.ts");
                const helperFile = path.join(scriptsDir, "helper.ts");
                const constantsFile = path.join(scriptsDir, "constants.ts");

                try {
                    fs.mkdirSync(path.dirname(nestedTreeFile), { recursive: true });
                    fs.mkdirSync(scriptsDir, { recursive: true });
                    fs.writeFileSync(workspaceFile, JSON.stringify({ settings: {} }));
                    fs.writeFileSync(
                        settingFile,
                        JSON.stringify([
                            {
                                name: "Sequence",
                                type: "Composite",
                                desc: "",
                                children: -1,
                            },
                        ])
                    );

                    const mainTree = createTestTree();
                    mainTree.name = "main";
                    const nestedTree = createTestTree();
                    nestedTree.name = "secondary";
                    fs.writeFileSync(mainTreeFile, JSON.stringify(mainTree));
                    fs.writeFileSync(nestedTreeFile, JSON.stringify(nestedTree));

                    fs.writeFileSync(
                        constantsFile,
                        ['export const migratedBy = "batch-import";', ""].join("\n")
                    );
                    fs.writeFileSync(
                        helperFile,
                        [
                            'import { migratedBy } from "./constants.ts";',
                            "",
                            "export function markTree(tree, treePath) {",
                            "  tree.custom = { ...(tree.custom ?? {}), migratedBy, treePath };",
                            "}",
                            "",
                        ].join("\n")
                    );
                    fs.writeFileSync(
                        buildScriptFile,
                        [
                            'import { markTree } from "./helper.ts";',
                            "",
                            "@behavior3.build",
                            "export class BatchProcessScript {",
                            "  onProcessTree(tree, treePath) {",
                            "    markTree(tree, treePath);",
                            "    return tree;",
                            "  }",
                            "}",
                            "",
                        ].join("\n")
                    );

                    const result = await batchProcessBehaviorProject({
                        workspaceFile,
                        settingFile,
                        scriptFile: buildScriptFile,
                    });
                    const mainTreeOutput = JSON.parse(fs.readFileSync(mainTreeFile, "utf-8"));
                    const nestedTreeOutput = JSON.parse(fs.readFileSync(nestedTreeFile, "utf-8"));
                    const runtimeFiles = fs
                        .readdirSync(scriptsDir)
                        .filter((file) => file.includes(".runtime.") && file.endsWith(".mjs"));

                    assert.equal(result.hasError, false);
                    assert.equal(result.summary.totalFiles, 2);
                    assert.equal(result.summary.writtenFiles, 2);
                    assert.equal(result.summary.stagedWriteFiles, 2);
                    assert.equal(result.summary.unchangedFiles, 0);
                    assert.equal(result.summary.skippedFiles, 0);
                    assert.equal(result.summary.failedFiles, 0);
                    assert.equal(mainTreeOutput.custom.migratedBy, "batch-import");
                    assert.equal(nestedTreeOutput.custom.migratedBy, "batch-import");
                    assert.equal(Array.isArray(runtimeFiles), true);
                    assert.deepEqual(runtimeFiles, []);
                } finally {
                    fs.rmSync(root, { recursive: true, force: true });
                }
            },
        },
        {
            name: "aborts batch source rewrites when any transformed tree fails validation",
            async run() {
                const root = fs.mkdtempSync(path.join(os.tmpdir(), "behavior3-batch-abort-"));
                const workspaceFile = path.join(root, "workspace.b3-workspace");
                const settingFile = path.join(root, "node-config.b3-setting");
                const goodTreeFile = path.join(root, "good.json");
                const badTreeFile = path.join(root, "bad.json");
                const buildScriptFile = path.join(root, "batch.ts");

                try {
                    fs.writeFileSync(workspaceFile, JSON.stringify({ settings: {} }));
                    fs.writeFileSync(
                        settingFile,
                        JSON.stringify([
                            {
                                name: "Sequence",
                                type: "Composite",
                                desc: "",
                                children: -1,
                            },
                        ])
                    );

                    const goodTree = createTestTree();
                    goodTree.name = "good";
                    const badTree = createTestTree();
                    badTree.name = "bad";
                    fs.writeFileSync(goodTreeFile, JSON.stringify(goodTree));
                    fs.writeFileSync(badTreeFile, JSON.stringify(badTree));

                    const goodBefore = fs.readFileSync(goodTreeFile, "utf-8");
                    const badBefore = fs.readFileSync(badTreeFile, "utf-8");
                    fs.writeFileSync(
                        buildScriptFile,
                        [
                            "@behavior3.build",
                            "export class InvalidBatchScript {",
                            "  onProcessTree(tree, treePath) {",
                            "    tree.custom = { ...(tree.custom ?? {}), touched: true };",
                            "    if (treePath.endsWith('/bad.json') || treePath.endsWith('\\\\bad.json')) {",
                            '      tree.root.name = "MissingNode";',
                            "    }",
                            "    return tree;",
                            "  }",
                            "}",
                            "",
                        ].join("\n")
                    );

                    const result = await batchProcessBehaviorProject({
                        workspaceFile,
                        settingFile,
                        scriptFile: buildScriptFile,
                    });
                    const goodAfter = fs.readFileSync(goodTreeFile, "utf-8");
                    const badAfter = fs.readFileSync(badTreeFile, "utf-8");
                    const parsedGood = JSON.parse(goodAfter);
                    const parsedBad = JSON.parse(badAfter);

                    assert.equal(result.hasError, true);
                    assert.equal(result.summary.totalFiles, 2);
                    assert.equal(result.summary.writtenFiles, 0);
                    assert.equal(result.summary.stagedWriteFiles, 1);
                    assert.equal(result.summary.failedFiles, 1);
                    assert.equal(goodAfter, goodBefore);
                    assert.equal(badAfter, badBefore);
                    assert.equal(parsedGood.custom.touched, undefined);
                    assert.equal(parsedBad.custom.touched, undefined);
                } finally {
                    fs.rmSync(root, { recursive: true, force: true });
                }
            },
        },
        {
            name: "loads TypeScript build scripts concurrently without deleting active runtime modules",
            async run() {
                const root = fs.mkdtempSync(path.join(os.tmpdir(), "behavior3-build-concurrent-"));
                const scriptsDir = path.join(root, "scripts");
                const buildScriptFile = path.join(scriptsDir, "build.ts");
                const helperFile = path.join(scriptsDir, "helper.ts");
                const constantsFile = path.join(scriptsDir, "constants.ts");

                try {
                    fs.mkdirSync(scriptsDir, { recursive: true });
                    fs.writeFileSync(
                        constantsFile,
                        ['export const helperValue = "concurrent-helper";', ""].join("\n")
                    );
                    fs.writeFileSync(
                        helperFile,
                        [
                            'import { helperValue } from "./constants.ts";',
                            "",
                            "export const value = helperValue;",
                            "",
                        ].join("\n")
                    );
                    fs.writeFileSync(
                        buildScriptFile,
                        [
                            'import { value } from "./helper.ts";',
                            "",
                            "@behavior3.build",
                            "export class ConcurrentBuildScript {",
                            "  static helperValue = value;",
                            "}",
                            "",
                        ].join("\n")
                    );

                    for (let round = 0; round < 5; round += 1) {
                        const modules = await Promise.all(
                            Array.from({ length: 8 }, () =>
                                loadRuntimeModule(buildScriptFile, { debug: false })
                            )
                        );

                        assert.equal(modules.every(Boolean), true);
                        for (const moduleExports of modules) {
                            const buildModule = moduleExports as {
                                ConcurrentBuildScript?: { helperValue?: string };
                            } | null;
                            assert.equal(
                                buildModule?.ConcurrentBuildScript?.helperValue,
                                "concurrent-helper"
                            );
                        }
                    }

                    const runtimeFiles = fs
                        .readdirSync(scriptsDir)
                        .filter((file) => file.includes(".runtime.") && file.endsWith(".mjs"));

                    assert.deepEqual(runtimeFiles, []);
                } finally {
                    fs.rmSync(root, { recursive: true, force: true });
                }
            },
        },
        {
            name: "keeps behavior3 decorator global alive across overlapping runtime imports",
            async run() {
                const root = fs.mkdtempSync(path.join(os.tmpdir(), "behavior3-decorator-global-"));
                const scriptsDir = path.join(root, "scripts");
                const fastScriptFile = path.join(scriptsDir, "fast.ts");
                const slowScriptFile = path.join(scriptsDir, "slow.ts");

                try {
                    fs.mkdirSync(scriptsDir, { recursive: true });
                    fs.writeFileSync(
                        fastScriptFile,
                        [
                            '@behavior3.check("fast")',
                            "export class FastChecker {",
                            "  validate() {}",
                            "}",
                            "",
                        ].join("\n")
                    );
                    fs.writeFileSync(
                        slowScriptFile,
                        [
                            "await new Promise((resolve) => setTimeout(resolve, 25));",
                            "",
                            '@behavior3.check("slow")',
                            "export class SlowChecker {",
                            "  validate() {}",
                            "}",
                            "",
                        ].join("\n")
                    );

                    const [fastModule, slowModule] = await Promise.all([
                        loadRuntimeModule(fastScriptFile, { debug: false }),
                        loadRuntimeModule(slowScriptFile, { debug: false }),
                    ]);

                    assert.equal(Boolean(fastModule), true);
                    assert.equal(Boolean(slowModule), true);
                    assert.equal(
                        typeof (fastModule as { FastChecker?: unknown } | null)?.FastChecker,
                        "function"
                    );
                    assert.equal(
                        typeof (slowModule as { SlowChecker?: unknown } | null)?.SlowChecker,
                        "function"
                    );
                } finally {
                    fs.rmSync(root, { recursive: true, force: true });
                }
            },
        },
        {
            name: "runs decorated node arg checkers during build",
            async run() {
                const root = fs.mkdtempSync(path.join(os.tmpdir(), "behavior3-build-checker-"));
                const scriptsDir = path.join(root, "scripts");
                const workspaceFile = path.join(root, "workspace.b3-workspace");
                const settingFile = path.join(root, "node-config.b3-setting");
                const treeFile = path.join(root, "main.json");
                const buildScriptFile = path.join(scriptsDir, "build.ts");
                const outputDir = path.join(root, "dist");

                try {
                    fs.mkdirSync(scriptsDir, { recursive: true });
                    fs.writeFileSync(
                        workspaceFile,
                        JSON.stringify({
                            settings: {
                                buildScript: "scripts/build.ts",
                            },
                        })
                    );
                    fs.writeFileSync(
                        settingFile,
                        JSON.stringify([
                            {
                                name: "Wait",
                                type: "Action",
                                desc: "",
                                args: [
                                    {
                                        name: "time",
                                        type: "float",
                                        desc: "",
                                        checker: "positive",
                                    },
                                ],
                            },
                        ])
                    );
                    fs.writeFileSync(
                        treeFile,
                        JSON.stringify({
                            version: "2.0.0",
                            name: "main",
                            prefix: "",
                            group: [],
                            variables: {
                                imports: [],
                                locals: [],
                            },
                            custom: {},
                            overrides: {},
                            root: {
                                uuid: "root",
                                id: "1",
                                name: "Wait",
                                args: {
                                    time: 0,
                                },
                            },
                        })
                    );
                    fs.writeFileSync(
                        buildScriptFile,
                        [
                            '@behavior3.check("positive")',
                            "export class PositiveChecker {",
                            "  validate(value) {",
                            "    if (typeof value !== 'number' || value <= 0) {",
                            "      return 'must be greater than 0';",
                            "    }",
                            "  }",
                            "}",
                            "",
                        ].join("\n")
                    );

                    const result = await buildBehaviorProject({
                        projectPath: treeFile,
                        outputDir,
                    });

                    assert.equal(result.hasError, true);
                    assert.equal(fs.existsSync(path.join(outputDir, "main.json")), true);
                } finally {
                    fs.rmSync(root, { recursive: true, force: true });
                }
            },
        },
        {
            name: "loads node arg checkers from workspace checkScripts",
            async run() {
                const root = fs.mkdtempSync(path.join(os.tmpdir(), "behavior3-check-scripts-"));
                const checkersDir = path.join(root, "scripts", "checkers");
                const workspaceFile = path.join(root, "workspace.b3-workspace");
                const settingFile = path.join(root, "node-config.b3-setting");
                const treeFile = path.join(root, "main.json");
                const checkerFile = path.join(checkersDir, "positive.ts");
                const outputDir = path.join(root, "dist");

                try {
                    fs.mkdirSync(checkersDir, { recursive: true });
                    fs.writeFileSync(
                        workspaceFile,
                        JSON.stringify({
                            settings: {
                                checkScripts: ["scripts/checkers/**/*.ts"],
                            },
                        })
                    );
                    fs.writeFileSync(
                        settingFile,
                        JSON.stringify([
                            {
                                name: "Wait",
                                type: "Action",
                                desc: "",
                                args: [
                                    {
                                        name: "time",
                                        type: "float",
                                        desc: "",
                                        checker: "positive",
                                    },
                                ],
                            },
                        ])
                    );
                    fs.writeFileSync(
                        treeFile,
                        JSON.stringify({
                            version: "2.0.0",
                            name: "main",
                            prefix: "",
                            group: [],
                            variables: {
                                imports: [],
                                locals: [],
                            },
                            custom: {},
                            overrides: {},
                            root: {
                                uuid: "root",
                                id: "1",
                                name: "Wait",
                                args: {
                                    time: 0,
                                },
                            },
                        })
                    );
                    fs.writeFileSync(
                        checkerFile,
                        [
                            '@behavior3.check("positive")',
                            "export class PositiveChecker {",
                            "  validate(value) {",
                            "    if (typeof value !== 'number' || value <= 0) {",
                            "      return 'must be greater than 0';",
                            "    }",
                            "  }",
                            "}",
                            "",
                        ].join("\n")
                    );

                    const result = await buildBehaviorProject({
                        projectPath: treeFile,
                        outputDir,
                    });

                    assert.equal(result.hasError, true);
                    assert.equal(fs.existsSync(path.join(outputDir, "main.json")), true);
                } finally {
                    fs.rmSync(root, { recursive: true, force: true });
                }
            },
        },
        {
            name: "cleans TypeScript build script runtime modules after debug builds",
            async run() {
                const root = fs.mkdtempSync(path.join(os.tmpdir(), "behavior3-build-debug-"));
                const scriptsDir = path.join(root, "scripts");
                const workspaceFile = path.join(root, "workspace.b3-workspace");
                const settingFile = path.join(root, "node-config.b3-setting");
                const treeFile = path.join(root, "main.json");
                const buildScriptFile = path.join(scriptsDir, "build.ts");
                const helperFile = path.join(scriptsDir, "helper.ts");
                const outputDir = path.join(root, "dist");
                const previousDebug = process.env.BEHAVIOR3_BUILD_DEBUG;

                try {
                    process.env.BEHAVIOR3_BUILD_DEBUG = "1";
                    fs.mkdirSync(scriptsDir, { recursive: true });
                    fs.writeFileSync(
                        workspaceFile,
                        JSON.stringify({
                            settings: {
                                buildScript: "scripts/build.ts",
                            },
                        })
                    );
                    fs.writeFileSync(
                        settingFile,
                        JSON.stringify([
                            {
                                name: "Root",
                                type: "Composite",
                                desc: "",
                                children: -1,
                            },
                        ])
                    );
                    fs.writeFileSync(
                        treeFile,
                        JSON.stringify({
                            version: "2.0.0",
                            name: "main",
                            prefix: "",
                            group: [],
                            variables: {
                                imports: [],
                                locals: [],
                            },
                            custom: {},
                            overrides: {},
                            root: {
                                uuid: "root",
                                id: "1",
                                name: "Root",
                                children: [],
                            },
                        })
                    );
                    fs.writeFileSync(
                        helperFile,
                        [
                            'export const debugValue = "debug-helper";',
                            "export function markTree(tree) {",
                            "  tree.custom = { ...(tree.custom ?? {}), debugValue };",
                            "}",
                            "",
                        ].join("\n")
                    );
                    fs.writeFileSync(
                        buildScriptFile,
                        [
                            'import { markTree } from "./helper.ts";',
                            "",
                            "export class Hook {",
                            "  onProcessTree(tree) {",
                            "    markTree(tree);",
                            "    return tree;",
                            "  }",
                            "}",
                            "",
                        ].join("\n")
                    );

                    const result = await buildBehaviorProject({
                        projectPath: treeFile,
                        outputDir,
                    });
                    const outputTree = JSON.parse(
                        fs.readFileSync(path.join(outputDir, "main.json"), "utf-8")
                    );
                    const runtimeFiles = fs
                        .readdirSync(scriptsDir)
                        .filter((file) => file.includes(".runtime.") && file.endsWith(".mjs"));

                    assert.equal(result.hasError, false);
                    assert.equal(outputTree.custom.debugValue, "debug-helper");
                    assert.deepEqual(runtimeFiles, []);
                } finally {
                    if (previousDebug === undefined) {
                        delete process.env.BEHAVIOR3_BUILD_DEBUG;
                    } else {
                        process.env.BEHAVIOR3_BUILD_DEBUG = previousDebug;
                    }
                    fs.rmSync(root, { recursive: true, force: true });
                }
            },
        },
        {
            name: "rejects legacy function-style build scripts",
            async run() {
                const root = fs.mkdtempSync(path.join(os.tmpdir(), "behavior3-build-hook-"));
                const workspaceFile = path.join(root, "workspace.b3-workspace");
                const settingFile = path.join(root, "node-config.b3-setting");
                const treeFile = path.join(root, "main.json");
                const buildScriptFile = path.join(root, "legacy-build.js");
                const outputDir = path.join(root, "dist");

                try {
                    fs.writeFileSync(
                        workspaceFile,
                        JSON.stringify({
                            settings: {
                                buildScript: "legacy-build.js",
                            },
                        })
                    );
                    fs.writeFileSync(
                        settingFile,
                        JSON.stringify([
                            {
                                name: "Root",
                                type: "Composite",
                                desc: "",
                                children: -1,
                            },
                        ])
                    );
                    fs.writeFileSync(
                        treeFile,
                        JSON.stringify({
                            version: "2.0.0",
                            name: "main",
                            prefix: "",
                            group: [],
                            variables: {
                                imports: [],
                                locals: [],
                            },
                            custom: {},
                            overrides: {},
                            root: {
                                uuid: "root",
                                id: "1",
                                name: "Root",
                                children: [],
                            },
                        })
                    );
                    fs.writeFileSync(
                        buildScriptFile,
                        ["export function onProcessTree(tree) {", "  return tree;", "}", ""].join(
                            "\n"
                        )
                    );

                    const result = await buildBehaviorProject({
                        projectPath: treeFile,
                        outputDir,
                    });

                    assert.equal(result.hasError, true);
                    assert.equal(fs.existsSync(path.join(outputDir, "main.json")), true);
                } finally {
                    fs.rmSync(root, { recursive: true, force: true });
                }
            },
        },
    ])
);

async function main() {
    for (const test of tests) {
        await test.run();
        console.log(`ok - ${test.name}`);
    }

    console.log(`${tests.length} shared tests passed`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
