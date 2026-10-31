import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DocumentSessionState } from "../../src/editor-session/document/document-session-state";
import { handleNativeWheelZoom } from "../../webview/adapters/graph/g6-wheel-zoom";
import {
    preparePersistedTreeForMainDocumentSave,
    serializePersistedTreeForMainDocumentSave,
} from "../../webview/domain/main-document-save";
import {
    buildConditionFileLocation,
    buildConditionFilePath,
    buildConditionFileTree,
    parseConditionFileLocation,
    readConditionFileWriteBack,
} from "../../webview/shared/condition-file";
import { DOCUMENT_VERSION } from "../../webview/shared/b3type";
import { ConditionBranchSaveError } from "../../webview/shared/condition-branch";
import type {
    NodeDef,
    PersistedConditionData,
    PersistedNodeModel,
    PersistedTreeModel,
} from "../../webview/shared/contracts";
import { reduceDocumentMutation } from "../../webview/shared/document";
import { parseWorkdirRelativeJsonPath } from "../../webview/shared/protocol";
import { parseNodeDefsContent, parseWorkspaceModelContent } from "../../webview/shared/schema";
import { materializePersistedTree } from "../../webview/shared/tree-materializer";
import { resolveDocumentGraph } from "../../webview/domain/resolve-graph";
import {
    applyMainTreeDisplayIds,
    collectReachableSubtreePaths,
    parsePersistedTreeContent,
    pruneStaleSubtreeOverrides,
    serializePersistedTree,
} from "../../webview/shared/tree";
import { createTestTree } from "../shared-test-fixtures";
import { defineSharedTests } from "../shared-test-types";

const attachedCondition = (
    root: PersistedNodeModel,
    enterPriority = 0,
    maintainPriority = 0
): PersistedConditionData => ({
    abort: "self",
    custom: { enterPriority, maintainPriority },
    root,
});

const conditionList = (
    root: PersistedNodeModel,
    enterPriority = 0,
    maintainPriority = 0
): PersistedConditionData[] => [attachedCondition(root, enterPriority, maintainPriority)];

export const documentDomainSharedTests = defineSharedTests([
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
                    throw new Error(
                        "save should not read subtree content when no subtree links exist"
                    );
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
        name: "stages legacy subtree normalization for missing version and stable ids",
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
            assert.equal(normalizedSubtree.version, DOCUMENT_VERSION);
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
        name: "prunes stale schema fields from normal node updates in shared host reducer",
        run() {
            const tree = createTestTree();
            tree.root.children = [
                {
                    uuid: "child-a",
                    id: "2",
                    name: "TestVisibleAndChecker",
                    args: {
                        health: 3,
                        type: 1,
                        类型: 1,
                        血量: 1,
                    },
                },
            ];

            const nodeDefs: NodeDef[] = [
                {
                    name: "TestVisibleAndChecker",
                    type: "Action",
                    desc: "",
                    args: [
                        { name: "health", type: "int", desc: "" },
                        { name: "type", type: "int", desc: "" },
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
                            structuralStableId: "child-a",
                            sourceStableId: "child-a",
                            sourceTreePath: null,
                            subtreeStack: [],
                        },
                        data: {
                            name: "TestVisibleAndChecker",
                            args: {
                                health: 4,
                                type: 2,
                                类型: 1,
                                血量: 1,
                            },
                        },
                        currentNodeSnapshot: {
                            data: {
                                uuid: "child-a",
                                id: "2",
                                name: "TestVisibleAndChecker",
                                args: {
                                    health: 3,
                                    type: 1,
                                    类型: 1,
                                    血量: 1,
                                },
                            },
                            subtreeNode: false,
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

            assert.deepEqual(result.tree.root.children?.[0]?.args, {
                health: 4,
                type: 2,
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
        name: "does not persist default-only subtree args when original omits defaults",
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
        name: "persists subtree debug override when turning true off",
        run() {
            const tree = createTestTree();
            const nodeDefs: NodeDef[] = [
                {
                    name: "Wait",
                    type: "Action",
                    desc: "",
                },
            ];

            const result = reduceDocumentMutation(
                {
                    type: "updateNode",
                    payload: {
                        target: {
                            instanceKey: "node-debug",
                            displayId: "2",
                            structuralStableId: "sub-node",
                            sourceStableId: "sub-node",
                            sourceTreePath: "subtree/child.json" as any,
                            subtreeStack: [],
                        },
                        data: {
                            name: "Wait",
                            debug: false,
                            disabled: false,
                        },
                        currentNodeSnapshot: {
                            data: {
                                uuid: "sub-node",
                                id: "2",
                                name: "Wait",
                                debug: true,
                            },
                            subtreeNode: true,
                            subtreeOriginal: {
                                uuid: "sub-node",
                                id: "2",
                                name: "Wait",
                                debug: true,
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
                debug: false,
            });
        },
    },
    {
        name: "persists subtree disabled override when turning true off",
        run() {
            const tree = createTestTree();
            const nodeDefs: NodeDef[] = [
                {
                    name: "Wait",
                    type: "Action",
                    desc: "",
                },
            ];

            const result = reduceDocumentMutation(
                {
                    type: "updateNode",
                    payload: {
                        target: {
                            instanceKey: "node-disabled",
                            displayId: "2",
                            structuralStableId: "sub-node",
                            sourceStableId: "sub-node",
                            sourceTreePath: "subtree/child.json" as any,
                            subtreeStack: [],
                        },
                        data: {
                            name: "Wait",
                            debug: false,
                            disabled: false,
                        },
                        currentNodeSnapshot: {
                            data: {
                                uuid: "sub-node",
                                id: "2",
                                name: "Wait",
                                disabled: true,
                            },
                            subtreeNode: true,
                            subtreeOriginal: {
                                uuid: "sub-node",
                                id: "2",
                                name: "Wait",
                                disabled: true,
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
                disabled: false,
            });
        },
    },
    {
        name: "keeps explicit false subtree boolean overrides when editing another field",
        run() {
            const tree = createTestTree();
            const nodeDefs: NodeDef[] = [
                {
                    name: "Wait",
                    type: "Action",
                    desc: "",
                },
            ];

            const result = reduceDocumentMutation(
                {
                    type: "updateNode",
                    payload: {
                        target: {
                            instanceKey: "node-bool-desc",
                            displayId: "2",
                            structuralStableId: "sub-node",
                            sourceStableId: "sub-node",
                            sourceTreePath: "subtree/child.json" as any,
                            subtreeStack: [],
                        },
                        data: {
                            name: "Wait",
                            desc: "updated",
                            debug: false,
                            disabled: false,
                        },
                        currentNodeSnapshot: {
                            data: {
                                uuid: "sub-node",
                                id: "2",
                                name: "Wait",
                                desc: "",
                                debug: false,
                                disabled: false,
                            },
                            subtreeNode: true,
                            subtreeOriginal: {
                                uuid: "sub-node",
                                id: "2",
                                name: "Wait",
                                desc: "",
                                debug: true,
                                disabled: true,
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
                debug: false,
                disabled: false,
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
            const zoomCalls: Array<{ ratio: number; origin: [number, number] | undefined }> = [];
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
                fs.readFileSync(path.join(process.cwd(), "sample/node-config.b3-setting"), "utf-8")
            );

            assert.equal(
                defs.some((def) => def.name === "Attack"),
                true
            );
            assert.equal(
                defs.find((def) => def.name === "TestB3")?.args?.find((arg) => arg.name === "open")
                    ?.type,
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
                        allowNewFunction: true,
                        checkExpr: true,
                        buildScript: "scripts/build.ts",
                        checkScripts: ["scripts/checkers/**/*.ts"],
                        nodeColors: {
                            Action: "#123456",
                        },
                    },
                })
            );

            assert.equal(workspace.settings.allowNewFunction, true);
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
        name: "keeps preemptive on node definitions only when it is true",
        run() {
            const defs = parseNodeDefsContent(
                JSON.stringify([
                    { name: "Plain", type: "Composite", desc: "" },
                    { name: "Off", type: "Composite", desc: "", preemptive: false },
                    { name: "Selector", type: "Composite", desc: "", preemptive: true },
                    { name: "Bad", type: "Composite", desc: "", preemptive: "yes" },
                ])
            );

            assert.equal(defs[0].preemptive, undefined);
            assert.equal(defs[1].preemptive, undefined);
            assert.equal(defs[2].preemptive, true);
            assert.equal(defs[3].preemptive, undefined);
            assert.equal(JSON.stringify(defs[2]).includes('"preemptive":true'), true);
        },
    },
    {
        name: "round-trips node conditions outside node children",
        run() {
            const content = JSON.stringify({
                version: "2.7.0",
                name: "main",
                prefix: "",
                export: true,
                group: [],
                variables: { imports: [], locals: [] },
                custom: {},
                overrides: {},
                root: {
                    uuid: "root",
                    id: "1",
                    name: "Attack",
                    children: [{ uuid: "child", id: "2", name: "Wait" }],
                    conditions: [
                        {
                            abort: "both",
                            custom: { enterPriority: 4, maintainPriority: 7, note: "keep" },
                            root: {
                                uuid: "guard",
                                id: "9",
                                name: "Guard",
                                args: { limit: 1 },
                                children: [{ uuid: "guard-child", id: "10", name: "Check" }],
                            },
                        },
                        { root: { uuid: "second", id: "11", name: "HasEnemy" } },
                    ],
                },
            });

            const tree = parsePersistedTreeContent(content, "/tmp/main.json");
            const [first, second] = tree.root.conditions ?? [];
            assert.equal(first?.abort, "both");
            // Condition custom data is kept as written; the editor does not manage any key.
            assert.deepEqual(first?.custom, {
                enterPriority: 4,
                maintainPriority: 7,
                note: "keep",
            });
            assert.equal(first?.root.name, "Guard");
            assert.equal(first?.root.args?.limit, 1);
            assert.equal(first?.root.children?.[0].name, "Check");
            assert.equal(second?.abort, "none");
            assert.equal(second?.root.name, "HasEnemy");
            assert.deepEqual(
                tree.root.children?.map((child) => child.name),
                ["Wait"]
            );

            const saved = parsePersistedTreeContent(serializePersistedTree(tree), "/tmp/main.json");
            assert.deepEqual(saved.root.conditions, tree.root.conditions);
            assert.deepEqual(
                saved.root.children?.map((child) => child.name),
                ["Wait"]
            );
            assert.equal(saved.version, DOCUMENT_VERSION);
            assert.deepEqual(collectReachableSubtreePaths(tree.root), []);
        },
    },
    {
        name: "rejects invalid condition entries in tree files",
        run() {
            const parseRoot = (root: Record<string, unknown>) =>
                parsePersistedTreeContent(
                    JSON.stringify({
                        version: "2.8.0",
                        name: "main",
                        prefix: "",
                        group: [],
                        variables: { imports: [], locals: [] },
                        custom: {},
                        overrides: {},
                        root: { uuid: "root", id: "1", name: "Attack", ...root },
                    }),
                    "/tmp/main.json"
                );

            assert.throws(
                () => parseRoot({ conditions: [{ abort: "Lower Priority", root: { name: "A" } }] }),
                /conditions\[0\]\.abort must be one of none, self, lower, both/
            );
            assert.throws(() => parseRoot({ conditions: [{ abort: "self" }] }), /root is required/);
            assert.throws(
                () => parseRoot({ conditions: { root: { name: "A" } } }),
                /must be an array/
            );
            assert.equal(parseRoot({ conditions: [] }).root.conditions, undefined);
        },
    },
    {
        name: "defaults $condition_type while the tree uses a condition",
        run() {
            const withCondition = (
                custom: Record<string, unknown>,
                overrides: Record<string, unknown> = {}
            ) =>
                parsePersistedTreeContent(
                    JSON.stringify({
                        version: "2.7.0",
                        name: "main",
                        prefix: "",
                        group: [],
                        variables: { imports: [], locals: [] },
                        custom,
                        overrides,
                        root: {
                            uuid: "root",
                            id: "1",
                            name: "Attack",
                            conditions: [{ root: { uuid: "guard", id: "9", name: "Guard" } }],
                        },
                    }),
                    "/tmp/main.json"
                );

            assert.equal(withCondition({}).custom.$condition_type, "local");
            assert.equal(
                withCondition({ $condition_type: "global" }).custom.$condition_type,
                "global"
            );
            assert.equal(
                withCondition({ $condition_type: "shared" }).custom.$condition_type,
                "local"
            );

            const plain = parsePersistedTreeContent(
                JSON.stringify({
                    version: "2.7.0",
                    name: "main",
                    prefix: "",
                    group: [],
                    variables: { imports: [], locals: [] },
                    custom: {},
                    overrides: {},
                    root: { uuid: "root", id: "1", name: "Attack" },
                }),
                "/tmp/main.json"
            );
            assert.equal(plain.custom.$condition_type, undefined);

            const fromOverride = parsePersistedTreeContent(
                JSON.stringify({
                    version: "2.7.0",
                    name: "main",
                    prefix: "",
                    group: [],
                    variables: { imports: [], locals: [] },
                    custom: {},
                    overrides: {
                        child: {
                            conditions: [
                                {
                                    custom: { enterPriority: 2, maintainPriority: 0 },
                                    root: { uuid: "guard", id: "9", name: "Guard" },
                                },
                            ],
                        },
                    },
                    root: { uuid: "root", id: "1", name: "Attack" },
                }),
                "/tmp/main.json"
            );
            assert.equal(fromOverride.custom.$condition_type, "local");
            assert.deepEqual(fromOverride.overrides.child.conditions?.[0].custom, {
                enterPriority: 2,
                maintainPriority: 0,
            });

            const kept = reduceDocumentMutation(
                {
                    type: "updateTreeMeta",
                    payload: {
                        prefix: "",
                        export: true,
                        group: [],
                        custom: { label: "keep" },
                        variables: { imports: [], locals: [] },
                    },
                },
                { tree: withCondition({ $condition_type: "global" }), nodeDefs: [] }
            );
            assert.equal(kept.status, "changed");
            if (kept.status !== "changed") {
                return;
            }
            assert.equal(kept.tree.custom.label, "keep");
            assert.equal(kept.tree.custom.$condition_type, "global");
        },
    },
    {
        name: "walks condition trees for subtree paths and display ids",
        run() {
            const guardPath = parseWorkdirRelativeJsonPath("cond/guard.json");
            assert.ok(guardPath);
            const root: PersistedNodeModel = {
                uuid: "root",
                id: "1",
                name: "Selector",
                children: [
                    {
                        uuid: "attack",
                        id: "2",
                        name: "Attack",
                        conditions: [
                            attachedCondition(
                                { uuid: "guard", id: "", name: "Guard", path: guardPath },
                                2,
                                2
                            ),
                        ],
                    },
                ],
            };
            assert.deepEqual(collectReachableSubtreePaths(root), ["cond/guard.json"]);

            applyMainTreeDisplayIds(root, { root: "1", attack: "2", guard: "3" });
            assert.equal(root.children?.[0].conditions?.[0].root.id, "3");
        },
    },
    {
        name: "expands subtree paths inside conditions and numbers condition nodes with the tree",
        async run() {
            const guardPath = parseWorkdirRelativeJsonPath("cond/guard.json");
            assert.ok(guardPath);
            const tree: PersistedTreeModel = {
                version: DOCUMENT_VERSION,
                name: "main",
                prefix: "",
                export: true,
                group: [],
                variables: { imports: [], locals: [] },
                custom: {},
                overrides: { "guard-check": { desc: "from main" } },
                root: {
                    uuid: "root",
                    id: "1",
                    name: "Selector",
                    children: [
                        {
                            uuid: "attack",
                            id: "",
                            name: "Attack",
                            conditions: [
                                {
                                    abort: "lower",
                                    custom: { enterPriority: 7, maintainPriority: 7 },
                                    root: {
                                        uuid: "guard-ref",
                                        id: "",
                                        name: "Guard",
                                        path: guardPath,
                                    },
                                },
                            ],
                            children: [{ uuid: "leaf", id: "", name: "Log" }],
                        },
                        { uuid: "patrol", id: "", name: "Log" },
                    ],
                },
            };
            const guardContent = serializePersistedTree({
                version: DOCUMENT_VERSION,
                name: "guard",
                prefix: "",
                export: true,
                group: [],
                variables: { imports: [], locals: [] },
                custom: {},
                overrides: {},
                root: {
                    uuid: "guard-root",
                    id: "1",
                    name: "Sequence",
                    children: [{ uuid: "guard-check", id: "2", name: "Check" }],
                },
            });
            const nodeDefs: NodeDef[] = [
                { name: "Selector", type: "Composite", desc: "", preemptive: true },
                { name: "Sequence", type: "Composite", desc: "" },
                { name: "Attack", type: "Action", desc: "" },
                { name: "Check", type: "Condition", desc: "" },
                { name: "Log", type: "Action", desc: "" },
            ];
            const guardTree = parsePersistedTreeContent(guardContent, "cond/guard.json");

            const materialized = materializePersistedTree({
                persistedTree: tree,
                subtreeSources: { [guardPath]: guardTree },
                nodeDefs,
                subtreeEditable: false,
            });
            const conditionRoot = materialized.children[0].conditions[0].root;
            assert.equal(conditionRoot.data.name, "Sequence");
            assert.equal(conditionRoot.resolutionError, undefined);
            assert.equal(conditionRoot.children[0].data.name, "Check");
            assert.equal(conditionRoot.children[0].data.desc, "from main");
            assert.equal(conditionRoot.children[0].subtreeNode, true);
            // The host keeps the persisted (unexpanded) condition for editing.
            assert.equal(
                materialized.children[0].data.conditions?.[0].root.path,
                "cond/guard.json"
            );

            const { graph, mainTreeDisplayIdsByStableId } = resolveDocumentGraph({
                persistedTree: tree,
                subtreeSources: { [guardPath]: guardTree },
                nodeDefs,
                subtreeEditable: false,
            });
            // Node, its condition tree, then its children; condition nodes are not graph nodes.
            assert.deepEqual(mainTreeDisplayIdsByStableId, {
                root: "1",
                attack: "2",
                "guard-ref": "3",
                leaf: "5",
                patrol: "6",
            });
            assert.deepEqual(graph.nodeOrder.sort(), ["1", "2", "5", "6"]);
            assert.equal(graph.nodesByInstanceKey["2"].attachedConditionName, "Guard");

            const plan = await preparePersistedTreeForMainDocumentSave({
                tree,
                nodeDefs,
                readSubtreeContent: async (subtreePath) =>
                    subtreePath === guardPath ? guardContent : null,
            });
            const saved = parsePersistedTreeContent(plan.content, "/tmp/main.json");
            const attack = saved.root.children?.[0];
            assert.equal(attack?.id, "2");
            assert.equal(attack?.conditions?.[0].root.id, "3");
            assert.equal(attack?.conditions?.[0].root.children, undefined);
            assert.deepEqual(attack?.conditions?.[0].custom, {
                enterPriority: 7,
                maintainPriority: 7,
            });
            assert.equal(attack?.children?.[0].id, "5");
            // Overrides on subtree nodes inside a condition tree are reachable, so they are kept.
            assert.equal(saved.overrides["guard-check"]?.desc, "from main");
        },
    },
    {
        name: "stores subtree condition edits in main-document overrides",
        run() {
            const tree = createTestTree();
            const condition = attachedCondition({
                uuid: "guard",
                id: "9",
                name: "Guard",
                children: [{ uuid: "guard-child", id: "10", name: "Check" }],
            });
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
                            conditions: [condition],
                        },
                        currentNodeSnapshot: {
                            data: {
                                uuid: "sub-node",
                                id: "2",
                                name: "Wait",
                            },
                            subtreeNode: true,
                            subtreeOriginal: {
                                uuid: "sub-node",
                                id: "2",
                                name: "Wait",
                            },
                        },
                    },
                },
                {
                    tree,
                    nodeDefs: [
                        {
                            name: "Wait",
                            type: "Action",
                            desc: "",
                        },
                    ],
                }
            );

            assert.equal(result.status, "changed");
            if (result.status !== "changed") {
                return;
            }

            assert.equal(result.tree.root.children?.length ?? 0, 0);
            assert.equal(result.tree.overrides["sub-node"]?.conditions?.[0]?.root.name, "Guard");
            assert.equal(
                result.tree.overrides["sub-node"]?.conditions?.[0]?.root.children?.[0].name,
                "Check"
            );

            const subtreePath = parseWorkdirRelativeJsonPath("subtree/child.json");
            assert.ok(subtreePath);
            const materialized = materializePersistedTree({
                persistedTree: {
                    ...tree,
                    root: {
                        uuid: "link",
                        id: "1",
                        name: "Wait",
                        path: subtreePath,
                    },
                    overrides: result.tree.overrides,
                },
                subtreeSources: {
                    [subtreePath]: {
                        ...createTestTree(),
                        name: "child",
                        root: {
                            uuid: "sub-node",
                            id: "1",
                            name: "Wait",
                            children: [{ uuid: "leaf", id: "2", name: "Leaf" }],
                        },
                    },
                },
                nodeDefs: [{ name: "Wait", type: "Action", desc: "" }],
                subtreeEditable: true,
            });

            assert.equal(materialized.data.conditions?.[0]?.root.name, "Guard");
            assert.deepEqual(
                materialized.children.map((child) => child.data.name),
                ["Leaf"]
            );
        },
    },
    {
        name: "copies and deletes an attached condition branch with its host node",
        run() {
            const tree = createTestTree();
            const pasted = reduceDocumentMutation(
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
                            name: "Attack",
                            conditions: conditionList({
                                uuid: "clip-guard",
                                id: "10",
                                name: "Guard",
                                children: [{ uuid: "clip-check", id: "11", name: "Check" }],
                            }),
                        },
                    },
                },
                { tree, nodeDefs: [] }
            );

            assert.equal(pasted.status, "changed");
            if (pasted.status !== "changed") {
                return;
            }

            const host = pasted.tree.root.children?.[0];
            assert.equal(host?.name, "Attack");
            assert.equal(host?.conditions?.[0]?.root.name, "Guard");
            assert.notEqual(host?.conditions?.[0]?.root.uuid, "clip-guard");
            assert.notEqual(host?.conditions?.[0]?.root.children?.[0].uuid, "clip-check");

            const deleted = reduceDocumentMutation(
                {
                    type: "deleteNode",
                    payload: {
                        target: {
                            instanceKey: "2",
                            displayId: "2",
                            structuralStableId: host?.uuid ?? "",
                            sourceStableId: host?.uuid ?? "",
                            sourceTreePath: null,
                            subtreeStack: [],
                        },
                    },
                },
                { tree: pasted.tree, nodeDefs: [] }
            );

            assert.equal(deleted.status, "changed");
            if (deleted.status !== "changed") {
                return;
            }
            assert.equal(deleted.tree.root.children?.length ?? 0, 0);
            assert.equal(JSON.stringify(deleted.tree).includes("Guard"), false);
        },
    },
    {
        name: "attaches a condition entry node without adding it to children",
        run() {
            const tree = createTestTree();
            tree.root.name = "Attack";
            const result = reduceDocumentMutation(
                {
                    type: "attachCondition",
                    payload: {
                        target: {
                            instanceKey: "1",
                            displayId: "1",
                            structuralStableId: "root",
                            sourceStableId: "root",
                            sourceTreePath: null,
                            subtreeStack: [],
                        },
                        entryName: "Guard",
                    },
                },
                {
                    tree,
                    nodeDefs: [
                        { name: "Attack", type: "Action", desc: "" },
                        {
                            name: "Guard",
                            type: "Condition",
                            desc: "",
                            status: ["success", "failure"],
                        },
                    ],
                }
            );

            assert.equal(result.status, "changed");
            if (result.status !== "changed") {
                return;
            }
            assert.equal(result.tree.root.conditions?.[0]?.custom, undefined);
            assert.equal(result.tree.root.conditions?.[0]?.abort, "none");
            assert.equal(result.tree.root.conditions?.[0]?.root.name, "Guard");
            assert.equal(result.tree.root.children?.length ?? 0, 0);
            assert.equal(result.tree.custom.$condition_type, "local");

            const removed = reduceDocumentMutation(
                {
                    type: "removeCondition",
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
                    tree: result.tree,
                    nodeDefs: [
                        { name: "Attack", type: "Action", desc: "" },
                        {
                            name: "Guard",
                            type: "Condition",
                            desc: "",
                            status: ["success", "failure"],
                        },
                    ],
                }
            );
            assert.equal(removed.status, "changed");
            if (removed.status !== "changed") {
                return;
            }
            assert.equal(removed.tree.root.conditions, undefined);
            assert.equal(removed.tree.root.children?.length ?? 0, 0);
            assert.equal(removed.tree.custom.$condition_type, "local");
        },
    },
    {
        name: "removes an override-added subtree condition and keeps a source condition",
        run() {
            const tree = createTestTree();
            const target = {
                instanceKey: "node-1",
                displayId: "2",
                structuralStableId: "sub-node",
                sourceStableId: "sub-node",
                sourceTreePath: "subtree/child.json" as any,
                subtreeStack: [],
            };
            const nodeDefs = [{ name: "Wait", type: "Action" as const, desc: "" }];
            const added = reduceDocumentMutation(
                {
                    type: "updateNode",
                    payload: {
                        target,
                        data: {
                            name: "Wait",
                            conditions: conditionList({
                                uuid: "guard",
                                id: "9",
                                name: "Guard",
                            }),
                        },
                        currentNodeSnapshot: {
                            data: { uuid: "sub-node", id: "2", name: "Wait" },
                            subtreeNode: true,
                            subtreeOriginal: { uuid: "sub-node", id: "2", name: "Wait" },
                        },
                    },
                },
                { tree, nodeDefs }
            );
            assert.equal(added.status, "changed");
            if (added.status !== "changed") {
                return;
            }

            const removed = reduceDocumentMutation(
                {
                    type: "removeCondition",
                    payload: {
                        target,
                        currentNodeSnapshot: {
                            data: {
                                uuid: "sub-node",
                                id: "2",
                                name: "Wait",
                                conditions: added.tree.overrides["sub-node"]?.conditions,
                            },
                            subtreeNode: true,
                            subtreeOriginal: { uuid: "sub-node", id: "2", name: "Wait" },
                        },
                    },
                },
                { tree: added.tree, nodeDefs }
            );
            assert.equal(removed.status, "changed");
            if (removed.status !== "changed") {
                return;
            }
            assert.equal(removed.tree.overrides["sub-node"], undefined);

            const denied = reduceDocumentMutation(
                {
                    type: "removeCondition",
                    payload: {
                        target,
                        currentNodeSnapshot: {
                            data: {
                                uuid: "sub-node",
                                id: "2",
                                name: "Wait",
                                conditions: conditionList({
                                    uuid: "guard",
                                    id: "9",
                                    name: "Guard",
                                }),
                            },
                            subtreeNode: true,
                            subtreeOriginal: {
                                uuid: "sub-node",
                                id: "2",
                                name: "Wait",
                                conditions: conditionList({
                                    uuid: "source-guard",
                                    id: "3",
                                    name: "Check",
                                }),
                            },
                        },
                    },
                },
                { tree, nodeDefs }
            );
            assert.equal(denied.status, "error");
            if (denied.status === "error") {
                assert.equal(denied.error.code, "condition-clear-denied");
            }
        },
    },
    {
        name: "rejects a condition entry whose own status returns running",
        run() {
            const tree = createTestTree();
            const result = reduceDocumentMutation(
                {
                    type: "attachCondition",
                    payload: {
                        target: {
                            instanceKey: "1",
                            displayId: "1",
                            structuralStableId: "root",
                            sourceStableId: "root",
                            sourceTreePath: null,
                            subtreeStack: [],
                        },
                        entryName: "Wait",
                    },
                },
                {
                    tree,
                    nodeDefs: [
                        { name: "Sequence", type: "Composite", desc: "" },
                        { name: "Wait", type: "Action", desc: "", status: ["success", "running"] },
                    ],
                }
            );

            assert.equal(result.status, "error");
            if (result.status !== "error") {
                return;
            }
            assert.equal(result.error.code, "condition-running-status");
            assert.equal(tree.root.conditions, undefined);
        },
    },
    {
        name: "allows a condition entry that only propagates child running",
        run() {
            const tree = createTestTree();
            const result = reduceDocumentMutation(
                {
                    type: "attachCondition",
                    payload: {
                        target: {
                            instanceKey: "1",
                            displayId: "1",
                            structuralStableId: "root",
                            sourceStableId: "root",
                            sourceTreePath: null,
                            subtreeStack: [],
                        },
                        entryName: "Wait",
                    },
                },
                {
                    tree,
                    nodeDefs: [
                        { name: "Sequence", type: "Composite", desc: "" },
                        { name: "Wait", type: "Action", desc: "", status: ["success", "|running"] },
                    ],
                }
            );

            assert.equal(result.status, "changed");
            if (result.status !== "changed") {
                return;
            }
            assert.equal(result.tree.root.conditions?.[0]?.root.name, "Wait");
        },
    },
    {
        name: "rejects nested conditions and running nodes inside a condition branch",
        run() {
            const tree = createTestTree();
            tree.root.conditions = conditionList({
                uuid: "guard",
                id: "",
                name: "Sequence",
            });
            const nodeDefs: NodeDef[] = [
                {
                    name: "Sequence",
                    type: "Composite",
                    desc: "",
                    status: ["|success", "|failure", "|running"],
                },
                { name: "Guard", type: "Condition", desc: "", status: ["success", "failure"] },
                { name: "Wait", type: "Action", desc: "", status: ["running"] },
                { name: "Check", type: "Condition", desc: "", status: ["success", "failure"] },
                { name: "Repeat", type: "Decorator", desc: "", status: ["success", "|running"] },
            ];
            const pasted = reduceDocumentMutation(
                {
                    type: "pasteNode",
                    payload: {
                        target: {
                            instanceKey: "guard",
                            displayId: "",
                            structuralStableId: "guard",
                            sourceStableId: "guard",
                            sourceTreePath: null,
                            subtreeStack: [],
                        },
                        snapshot: {
                            uuid: "wait",
                            id: "",
                            name: "Wait",
                        },
                    },
                },
                { tree, nodeDefs }
            );
            assert.equal(pasted.status, "error");
            if (pasted.status === "error") {
                assert.equal(pasted.error.code, "condition-running-status");
            }
            assert.equal(tree.root.conditions?.[0]?.root.children, undefined);

            const nested = reduceDocumentMutation(
                {
                    type: "pasteNode",
                    payload: {
                        target: {
                            instanceKey: "guard",
                            displayId: "",
                            structuralStableId: "guard",
                            sourceStableId: "guard",
                            sourceTreePath: null,
                            subtreeStack: [],
                        },
                        snapshot: {
                            uuid: "check",
                            id: "",
                            name: "Check",
                            conditions: conditionList({ uuid: "inner", id: "", name: "Guard" }),
                        },
                    },
                },
                { tree, nodeDefs }
            );
            assert.equal(nested.status, "error");
            if (nested.status === "error") {
                assert.equal(nested.error.code, "condition-nested");
            }

            const propagated = reduceDocumentMutation(
                {
                    type: "pasteNode",
                    payload: {
                        target: {
                            instanceKey: "guard",
                            displayId: "",
                            structuralStableId: "guard",
                            sourceStableId: "guard",
                            sourceTreePath: null,
                            subtreeStack: [],
                        },
                        snapshot: {
                            uuid: "repeat",
                            id: "",
                            name: "Repeat",
                        },
                    },
                },
                { tree, nodeDefs }
            );
            assert.equal(propagated.status, "changed");
            if (propagated.status === "changed") {
                assert.equal(
                    propagated.tree.root.conditions?.[0]?.root.children?.[0]?.name,
                    "Repeat"
                );
            }

            // A parent without `|running` never passes a child's running up.
            const guarded = createTestTree();
            guarded.root.conditions = conditionList({ uuid: "guard", id: "", name: "Guard" });
            const contained = reduceDocumentMutation(
                {
                    type: "pasteNode",
                    payload: {
                        target: {
                            instanceKey: "guard",
                            displayId: "",
                            structuralStableId: "guard",
                            sourceStableId: "guard",
                            sourceTreePath: null,
                            subtreeStack: [],
                        },
                        snapshot: { uuid: "wait", id: "", name: "Wait" },
                    },
                },
                { tree: guarded, nodeDefs }
            );
            assert.equal(contained.status, "changed");
        },
    },
    {
        name: "builds short condition file locations that keep the host path in the query",
        run() {
            const location = buildConditionFileLocation("/w/workdir/hero.json", "a/b c");
            assert.deepEqual(location, {
                path: "/hero.json/a%2Fb%20c/condition.json",
                query: "host=%2Fw%2Fworkdir%2Fhero.json",
            });
            assert.deepEqual(parseConditionFileLocation(location), {
                hostFilePath: "/w/workdir/hero.json",
                hostStableId: "a/b c",
            });
            assert.equal(
                buildConditionFilePath("/w/workdir/hero.json", "abc"),
                "/w/workdir/hero.json/abc/condition.json"
            );
            assert.equal(parseConditionFileLocation({ ...location, query: "" }), null);
            assert.equal(
                parseConditionFileLocation({ ...location, query: "host=%2Fw%2Fother.json" }),
                null
            );
            assert.equal(
                parseConditionFileLocation({
                    path: "/hero.json/condition.json",
                    query: location.query,
                }),
                null
            );
        },
    },
    {
        name: "edits a condition file and writes it back into the host node",
        run() {
            const tree = createTestTree();
            tree.prefix = "H";
            tree.group = ["Client"];
            tree.variables.locals = [{ name: "hp", desc: "" }];
            tree.overrides = { "sub-node": { desc: "keep" } };
            tree.root.conditions = [
                {
                    abort: "both",
                    custom: { enterPriority: 1, maintainPriority: 1, note: "keep" },
                    root: { uuid: "guard", id: "2", name: "Sequence" },
                },
                { abort: "none", root: { uuid: "second", id: "3", name: "Check" } },
            ];
            const nodeDefs: NodeDef[] = [
                { name: "Sequence", type: "Composite", desc: "" },
                { name: "Check", type: "Condition", desc: "", status: ["success", "failure"] },
                { name: "Wait", type: "Action", desc: "", status: ["running"] },
            ];

            assert.equal(buildConditionFileTree(tree, "missing"), null);
            const conditionTree = buildConditionFileTree(tree, "root");
            assert.ok(conditionTree);
            assert.equal(conditionTree.name, "condition");
            assert.equal(conditionTree.prefix, "H");
            assert.deepEqual(conditionTree.group, ["Client"]);
            assert.deepEqual(conditionTree.variables.locals, [{ name: "hp", desc: "" }]);
            // The file's custom data is the condition's custom data.
            assert.deepEqual(conditionTree.custom, {
                enterPriority: 1,
                maintainPriority: 1,
                note: "keep",
            });
            assert.deepEqual(conditionTree.overrides, tree.overrides);
            assert.equal(conditionTree.root.uuid, "guard");
            assert.equal(conditionTree.root.conditions, undefined);
            // The file round-trips like any tree file.
            const reread = parsePersistedTreeContent(
                serializePersistedTree(conditionTree),
                "/w/hero.json/root/condition.json"
            );
            assert.equal(JSON.stringify(reread.root), JSON.stringify(conditionTree.root));

            const edited = reduceDocumentMutation(
                {
                    type: "insertNode",
                    payload: {
                        target: {
                            instanceKey: "1",
                            displayId: "1",
                            structuralStableId: "guard",
                            sourceStableId: "guard",
                            sourceTreePath: null,
                            subtreeStack: [],
                        },
                    },
                },
                { tree: conditionTree, nodeDefs }
            );
            assert.equal(edited.status, "changed");
            if (edited.status !== "changed") {
                return;
            }
            edited.tree.overrides = {};
            // Custom data is edited like any other: change, add and delete keys.
            edited.tree.custom = { maintainPriority: 1, extra: true };

            const written = reduceDocumentMutation(
                {
                    type: "setConditionRoot",
                    payload: { hostStableId: "root", ...readConditionFileWriteBack(edited.tree) },
                },
                { tree, nodeDefs }
            );
            assert.equal(written.status, "changed");
            if (written.status !== "changed") {
                return;
            }
            const [first, second] = written.tree.root.conditions ?? [];
            assert.equal(first?.abort, "both");
            assert.deepEqual(first?.custom, { maintainPriority: 1, extra: true });
            assert.equal(first?.root.uuid, "guard");
            assert.equal(first?.root.children?.length, 1);
            assert.equal(second?.root.uuid, "second");
            assert.deepEqual(written.tree.overrides, {});
            assert.equal(tree.root.conditions?.[0].root.children, undefined);

            const unchanged = reduceDocumentMutation(
                {
                    type: "setConditionRoot",
                    payload: { hostStableId: "root", ...readConditionFileWriteBack(conditionTree) },
                },
                { tree, nodeDefs }
            );
            assert.equal(unchanged.status, "noop");

            const running = reduceDocumentMutation(
                {
                    type: "setConditionRoot",
                    payload: {
                        hostStableId: "root",
                        overrides: tree.overrides,
                        root: {
                            uuid: "guard",
                            id: "2",
                            name: "Sequence",
                            children: [{ uuid: "wait", id: "", name: "Wait" }],
                        },
                    },
                },
                {
                    tree,
                    nodeDefs: [
                        {
                            name: "Sequence",
                            type: "Composite",
                            desc: "",
                            status: ["|success", "|failure", "|running"],
                        },
                        ...nodeDefs.slice(1),
                    ],
                }
            );
            assert.equal(running.status, "error");
            if (running.status === "error") {
                assert.equal(running.error.code, "condition-running-status");
            }

            const missing = reduceDocumentMutation(
                {
                    type: "setConditionRoot",
                    payload: { hostStableId: "nope", root: conditionTree.root, overrides: {} },
                },
                { tree, nodeDefs }
            );
            assert.equal(missing.status, "error");
        },
    },
    {
        name: "refuses to save a condition branch that nests another condition",
        async run() {
            const tree = createTestTree();
            tree.root.conditions = conditionList({
                uuid: "guard",
                id: "",
                name: "Guard",
                conditions: conditionList({ uuid: "inner", id: "", name: "Check" }),
            });
            await assert.rejects(
                () =>
                    preparePersistedTreeForMainDocumentSave({
                        tree,
                        nodeDefs: [
                            { name: "Sequence", type: "Composite", desc: "" },
                            { name: "Guard", type: "Condition", desc: "" },
                            { name: "Check", type: "Condition", desc: "" },
                        ],
                        readSubtreeContent: async () => null,
                    }),
                (error: unknown) => error instanceof ConditionBranchSaveError
            );
        },
    },
]);
