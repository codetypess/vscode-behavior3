import assert from "node:assert/strict";
import { createEditorController } from "../../webview/commands/create-editor-controller";
import { resolveDocumentGraph } from "../../webview/domain/resolve-graph";
import { createAppHooksStore } from "../../webview/shared/antd";
import type {
    DocumentMutation,
    GraphHighlightState,
    HostAdapter,
    NodeDef,
    NodeInstanceRef,
    PersistedTreeModel,
} from "../../webview/shared/contracts";
import { reduceDocumentMutation } from "../../webview/shared/document";
import type { GraphAdapter } from "../../webview/shared/graph-contracts";
import { parseWorkdirRelativeJsonPath } from "../../webview/shared/protocol";
import { parsePersistedTreeContent, serializePersistedTree } from "../../webview/shared/tree";
import {
    createDocumentStore,
    showDocumentReloadConflict,
} from "../../webview/stores/document-store";
import { createGraphUiStore } from "../../webview/stores/graph-ui-store";
import { createSelectionStore } from "../../webview/stores/selection-store";
import { createWorkspaceStore } from "../../webview/stores/workspace-store";
import { createHostInitSettings, createTestTree } from "../shared-test-fixtures";
import { defineSharedTests } from "../shared-test-types";

export const editorControllerSharedTests = defineSharedTests([
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
                executeInspectorHostCommand() {},
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
                executeInspectorHostCommand() {},
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
                settings: createHostInitSettings(),
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
                executeInspectorHostCommand() {},
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
                settings: createHostInitSettings(),
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
                executeInspectorHostCommand() {},
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
            const subtreePath = parseWorkdirRelativeJsonPath("sub/tree.json");
            assert.ok(subtreePath);

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
                settings: createHostInitSettings(),
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
            assert.ok(workspaceStore.getState().subtreeSources[subtreePath]);
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
                executeInspectorHostCommand() {},
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
                settings: createHostInitSettings(),
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
            let lastHighlights: GraphHighlightState = {
                activeVariableNames: [],
                variableHits: {},
            };

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
                executeInspectorHostCommand() {},
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
                settings: createHostInitSettings(),
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
            assert.deepEqual(lastHighlights.activeVariableNames, ["hp"]);
            assert.deepEqual(lastHighlights.variableHits["1"], ["input"]);
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
                executeInspectorHostCommand() {},
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
                settings: createHostInitSettings(),
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

            assert.equal(selectionStore.getState().selectedNodeRef?.structuralStableId, "child-b");
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
                executeInspectorHostCommand() {},
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
                settings: createHostInitSettings(),
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
                executeInspectorHostCommand() {},
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
                settings: createHostInitSettings(),
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
                executeInspectorHostCommand() {},
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
                settings: createHostInitSettings(),
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
                documentStore.getState().persistedTree?.root.children?.map((child) => child.uuid),
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
                    executeInspectorHostCommand() {},
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
                    settings: createHostInitSettings(),
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
                executeInspectorHostCommand() {},
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
                settings: createHostInitSettings(),
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
        name: "node update snapshots omit resolved default args for main-tree nodes",
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
                executeInspectorHostCommand() {},
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
                    name: "BackTeam",
                },
            };
            const content = serializePersistedTree(tree);
            await controller.initFromHost({
                filePath: "/tmp/main.json",
                workdir: "/tmp",
                content,
                nodeDefs: [
                    {
                        name: "BackTeam",
                        type: "Action",
                        desc: "",
                        args: [
                            {
                                name: "speed_rate",
                                type: "float?",
                                desc: "",
                                default: 1.5,
                            },
                        ],
                    },
                ],
                allFiles: [],
                settings: createHostInitSettings(),
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

            assert.equal(selectionStore.getState().selectedNodeSnapshot?.data.args, undefined);
            assert.deepEqual(selectionStore.getState().selectedNodeSnapshot?.effectiveArgs, {
                speed_rate: 1.5,
            });

            const target = selectionStore.getState().selectedNodeRef;
            assert.ok(target);
            await controller.updateNode({
                target,
                data: {
                    name: "BackTeam",
                    desc: "changed",
                },
            });

            const updateNodeMutation = mutations[0];
            assert.equal(updateNodeMutation?.type, "updateNode");
            if (updateNodeMutation?.type !== "updateNode") {
                return;
            }
            assert.equal(updateNodeMutation.payload.currentNodeSnapshot?.data.args, undefined);
        },
    },
    {
        name: "node update snapshots keep resolved args for subtree nodes",
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

            let selectedNodeTarget: NodeInstanceRef | null = null;
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
                    selectedNodeTarget = target;
                },
                requestFocusVariable() {},
                sendRequestSetting() {},
                sendBuild() {},
                executeInspectorHostCommand() {},
                async validateNodeChecks() {
                    return { diagnostics: [] };
                },
                async saveDocument() {
                    return { success: true };
                },
                async revertDocument() {
                    return { success: true };
                },
                async readFile(readPath) {
                    if (String(readPath).endsWith("sub.json")) {
                        return {
                            content: serializePersistedTree({
                                version: "2.0.0",
                                name: "sub",
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
                                            uuid: "sub-node",
                                            id: "2",
                                            name: "FindOneTarget",
                                            args: {
                                                max_first: false,
                                                sort_type: 1,
                                                target_type: "enemy",
                                            },
                                            input: ["search_radius"],
                                            output: ["target"],
                                        },
                                    ],
                                },
                            }),
                        };
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
                            uuid: "link-root",
                            id: "2",
                            name: "Sequence",
                            path: "sub.json" as any,
                        },
                    ],
                },
            };
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
                    },
                    {
                        name: "FindOneTarget",
                        type: "Action",
                        desc: "",
                        args: [
                            {
                                name: "max_first",
                                type: "bool",
                                desc: "",
                                default: false,
                            },
                            {
                                name: "sort_type",
                                type: "int",
                                desc: "",
                                default: 0,
                            },
                            {
                                name: "target_type",
                                type: "string",
                                desc: "",
                            },
                        ],
                        input: ["search_radius"],
                        output: ["target"],
                    },
                ],
                allFiles: [],
                settings: createHostInitSettings(),
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

            assert.deepEqual(selectionStore.getState().selectedNodeSnapshot?.data.args, {
                max_first: false,
                sort_type: 1,
                target_type: "enemy",
            });
            assert.deepEqual(selectionStore.getState().selectedNodeSnapshot?.effectiveArgs, {
                max_first: false,
                sort_type: 1,
                target_type: "enemy",
            });
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
                executeInspectorHostCommand() {},
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
                settings: createHostInitSettings(),
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
                executeInspectorHostCommand() {},
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
                settings: createHostInitSettings(),
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
            assert.equal(selectionStore.getState().selectedNodeRef?.structuralStableId, "child-c");
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
                executeInspectorHostCommand() {},
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
                settings: createHostInitSettings(),
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
            assert.equal(selectionStore.getState().selectedNodeRef?.structuralStableId, "child-b");
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
                executeInspectorHostCommand() {},
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
                settings: createHostInitSettings(),
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

            const outerPath = parseWorkdirRelativeJsonPath("sub/outer.json");
            const deepPath = parseWorkdirRelativeJsonPath("sub/deep.json");
            assert.ok(outerPath);
            assert.ok(deepPath);

            const mainGraph = resolveDocumentGraph({
                persistedTree: mainTree,
                subtreeSources: {
                    [outerPath]: parsePersistedTreeContent(outerContent, "/tmp/sub/outer.json"),
                    [deepPath]: parsePersistedTreeContent(deepContent, "/tmp/sub/deep.json"),
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
                settings: createHostInitSettings(),
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

            assert.equal(selectionStore.getState().selectedNodeRef?.sourceStableId, "deep-root");
            assert.equal(
                selectionStore.getState().selectedNodeRef?.sourceTreePath,
                "sub/deep.json"
            );
            assert.deepEqual(selectionStore.getState().selectedNodeRef?.subtreeStack, [
                "sub/outer.json",
                "sub/deep.json",
            ]);
            assert.equal(selectionStore.getState().selectedNodeSnapshot?.data.uuid, "deep-root");
            assert.equal(
                appliedSelectionKey,
                selectionStore.getState().selectedNodeRef?.instanceKey ?? null
            );
        },
    },
]);
