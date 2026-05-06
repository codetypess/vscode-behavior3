import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAppHooksStore } from "../webview/shared/misc/hooks";
import { createEditorController } from "../webview/commands/create-editor-controller";
import { createDocumentStore, showDocumentReloadConflict } from "../webview/stores/document-store";
import { createSelectionStore } from "../webview/stores/selection-store";
import { createWorkspaceStore } from "../webview/stores/workspace-store";
import { buildBehaviorProject, resolveBehaviorBuildPaths } from "../src/build/build-cli";
import { DocumentSessionState } from "../src/editor-session/document-session-state";
import { handleNativeWheelZoom } from "../webview/adapters/graph/g6-wheel-zoom";
import { buildResolvedGraphModel } from "../webview/domain/graph-selectors";
import { collectResolvedNodeDiagnostics } from "../webview/domain/tree-validation";
import { reduceDocumentMutation } from "../webview/shared/document-mutation-reducer";
import {
    normalizeNodeDefCollection,
    parseNodeDefsContent,
    parseWorkspaceModelContent,
} from "../webview/shared/schema";
import { loadSubtreeSourceCache } from "../webview/shared/subtree-source-cache";
import { materializePersistedTree } from "../webview/shared/tree-materializer";
import {
    collectTransitivePaths,
    parsePersistedTreeContent,
    serializePersistedTree,
} from "../webview/shared/tree";
import { parseWorkdirRelativeJsonPath } from "../webview/shared/protocol";
import b3path from "../webview/shared/misc/b3path";
import { loadRuntimeModule } from "../webview/shared/misc/b3build";
import type { GraphAdapter } from "../webview/shared/graph-contracts";
import type {
    DocumentMutation,
    HostAdapter,
    NodeDef,
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

const tests: Array<{ name: string; run(): Promise<void> | void }> = [
    {
        name: "normalizes legacy node definitions",
        run() {
            const defs = normalizeNodeDefCollection({
                nodes: [
                    {
                        name: "Check",
                        type: "Condition",
                        desc: "legacy",
                        args: [{ name: "value", type: "code?", desc: "expr" }],
                    },
                ],
            });

            assert.equal(defs.length, 1);
            assert.equal(defs[0]?.args?.[0]?.type, "expr?");
        },
    },
    {
        name: "normalizes boolean node arg alias",
        run() {
            const defs = normalizeNodeDefCollection([
                {
                    name: "Flag",
                    type: "Action",
                    desc: "",
                    args: [{ name: "enabled", type: "boolean?", desc: "" }],
                },
            ]);

            assert.equal(defs[0]?.args?.[0]?.type, "bool?");
        },
    },
    {
        name: "preserves node arg checker names in node definitions",
        run() {
            const defs = parseNodeDefsContent(
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

            assert.equal(defs[0]?.args?.[0]?.checker, "positive");
            assert.throws(
                () =>
                    parseNodeDefsContent(
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
                                        checker: "",
                                    },
                                ],
                            },
                        ])
                    ),
                /checker.*non-empty string/
            );
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
                    },
                },
                {
                    tree,
                    nodeDefs,
                    selectedNode: {
                        ref: {
                            instanceKey: "node-1",
                            displayId: "2",
                            structuralStableId: "sub-node",
                            sourceStableId: "sub-node",
                            sourceTreePath: "subtree/child.json" as any,
                            subtreeStack: [],
                        },
                        data: {
                            uuid: "sub-node",
                            id: "2",
                            name: "Wait",
                            args: { time: 1 },
                        },
                        prefix: "",
                        activeChildCount: 0,
                        disabled: false,
                        subtreeNode: true,
                        subtreeEditable: true,
                        subtreeOriginal: {
                            uuid: "sub-node",
                            id: "2",
                            name: "Wait",
                            args: { time: 1 },
                        },
                    },
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
                    selectedNode: {
                        ref: {
                            instanceKey: "node-1",
                            displayId: "2",
                            structuralStableId: "sub-root",
                            sourceStableId: "sub-root",
                            sourceTreePath: null,
                            subtreeStack: [],
                        },
                        data: {
                            uuid: "sub-root",
                            id: "2",
                            name: "SubtreeRef",
                            path: "subtree/child.json" as any,
                        },
                        prefix: "",
                        activeChildCount: 1,
                        disabled: false,
                        subtreeNode: false,
                        subtreeEditable: true,
                    },
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
        name: "parses only strict workdir-relative json paths",
        run() {
            assert.equal(parseWorkdirRelativeJsonPath("vars\\test.json"), "vars/test.json");
            assert.equal(parseWorkdirRelativeJsonPath("./sub/tree.json"), "sub/tree.json");
            assert.equal(parseWorkdirRelativeJsonPath("../escape.json"), null);
            assert.equal(parseWorkdirRelativeJsonPath("/absolute.json"), null);
            assert.equal(parseWorkdirRelativeJsonPath("C:\\absolute.json"), null);
            assert.equal(parseWorkdirRelativeJsonPath("tree.txt"), null);
            assert.equal(parseWorkdirRelativeJsonPath("http://example.com/tree.json"), null);
        },
    },
    {
        name: "normalizes shared b3 paths without Node path augmentation",
        run() {
            assert.equal(b3path.posixPath("vars\\sub\\../tree.json"), "vars/tree.json");
            assert.equal(b3path.basenameWithoutExt("/work/trees/main.json"), "main");
            assert.equal(b3path.dirname("/work/trees/main.json"), "/work/trees");
            assert.equal(b3path.resolve("/work/trees", "./main.json"), "/work/trees/main.json");
            assert.equal(
                b3path.relative("/work/trees", "/work/scripts/build.ts"),
                "../scripts/build.ts"
            );
            assert.equal(b3path.isAbsolute("C:\\work\\main.json"), true);
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
                    (entry) => entry.code === "undefined-variable" && entry.variable === "missing"
                ),
                true
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
                sendUpdate() {},
                undo() {},
                redo() {},
                async mutateDocument() {
                    return { success: true };
                },
                sendDocumentMutationResult() {},
                requestFocusVariable() {},
                sendTreeSelected() {},
                sendInspectorSelection() {},
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
        name: "routes canvas structural commands through host mutation intents",
        async run() {
            const documentStore = createDocumentStore();
            const workspaceStore = createWorkspaceStore();
            const selectionStore = createSelectionStore();
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
            let updateCount = 0;
            const hostAdapter: HostAdapter = {
                connect: () => () => {},
                sendReady() {},
                sendUpdate() {
                    updateCount += 1;
                },
                undo() {},
                redo() {},
                async mutateDocument(mutation) {
                    mutations.push(mutation);
                    return { success: true };
                },
                sendDocumentMutationResult() {},
                requestFocusVariable() {},
                sendTreeSelected() {},
                sendInspectorSelection() {},
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
                await controller.insertNode();
                await controller.pasteNode();

                await controller.selectNode("2");
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
            assert.equal(updateCount, 0);
        },
    },
    {
        name: "resolves pending host requests on disconnect",
        async run() {
            const testGlobal = globalThis as unknown as {
                window?: unknown;
                acquireVsCodeApi?: unknown;
            };
            const previousWindow = testGlobal.window;
            const previousAcquire = testGlobal.acquireVsCodeApi;
            const posts: unknown[] = [];
            const listeners = new Map<string, Set<EventListener>>();

            testGlobal.window = {
                setTimeout,
                clearTimeout,
                addEventListener(type: string, listener: EventListener) {
                    const entries = listeners.get(type) ?? new Set<EventListener>();
                    entries.add(listener);
                    listeners.set(type, entries);
                },
                removeEventListener(type: string, listener: EventListener) {
                    listeners.get(type)?.delete(listener);
                },
            };
            testGlobal.acquireVsCodeApi = () => ({
                postMessage(message: unknown) {
                    posts.push(message);
                },
                getState() {
                    return undefined;
                },
                setState() {},
            });

            const { getLogger, setLogger } = await import("../webview/shared/misc/logger");
            const previousLogger = getLogger();
            try {
                const { createVsCodeHostAdapter } =
                    await import("../webview/adapters/host/vscode-host-adapter");
                const adapter = createVsCodeHostAdapter();
                const off = adapter.connect(() => {});
                const resultPromise = adapter.readFile(parseWorkdirRelativeJsonPath("sub/a.json")!);

                assert.equal((posts[0] as { type?: string } | undefined)?.type, "readFile");
                off();

                const result = await resultPromise;
                assert.deepEqual(result, { content: null });
            } finally {
                setLogger(previousLogger);
                testGlobal.window = previousWindow;
                testGlobal.acquireVsCodeApi = previousAcquire;
            }
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
                    ["export function onProcessTree(tree) {", "  return tree;", "}", ""].join("\n")
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
];

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
