import { VERSION } from "../shared/misc/b3type";
import i18n from "../shared/misc/i18n";
import { stringifyJson } from "../shared/misc/stringify";
import { generateUuid } from "../shared/stable-id";
import type {
    ClipboardNodeMutationInput,
    DropIntent,
    DocumentMutation,
    EditorCommand,
    PersistedNodeModel,
    PersistedTreeModel,
    ResolvedNodeModel,
    SaveSelectedAsSubtreeInput,
    TargetNodeMutationInput,
    UpdateNodeInput,
    UpdateTreeMetaInput,
} from "../shared/contracts";
import {
    type DocumentMutationReducerError,
    type ReducibleDocumentMutation,
    formatDocumentMutationReducerError,
    reduceDocumentMutation,
} from "../shared/document-mutation-reducer";
import { parseWorkdirRelativeJsonPath } from "../shared/protocol";
import {
    clonePersistedNode,
    clonePersistedTree,
    findPersistedNodeByStableId,
    serializePersistedTree,
} from "../shared/tree";
import { type ControllerRuntime } from "./controller-runtime";

type MutationCommandKeys =
    | "updateTreeMeta"
    | "updateNode"
    | "performDrop"
    | "copyNode"
    | "pasteNode"
    | "insertNode"
    | "replaceNode"
    | "deleteNode"
    | "openSubtreePath"
    | "openSelectedSubtree"
    | "saveSelectedAsSubtree";

const isInspectorSidebar = () => window.__B3_WEBVIEW_KIND__ === "inspector-sidebar";

const getLanguage = (runtime: ControllerRuntime) =>
    runtime.deps.workspaceStore.getState().settings.language;

const forwardDocumentMutation = async (
    runtime: ControllerRuntime,
    mutation: DocumentMutation
): Promise<boolean> => {
    const response = await runtime.deps.hostAdapter.mutateDocument(mutation);
    if (!response.success) {
        runtime.notifyError(response.error ?? "Document mutation failed");
        return false;
    }
    return true;
};

const notifyDocumentMutationError = (
    runtime: ControllerRuntime,
    error: DocumentMutationReducerError
): void => {
    if (error.code === "invalid-json-path") {
        runtime.notifyError(i18n.t("validation.invalidJsonPath", { path: error.path }));
        return;
    }

    runtime.notifyError(formatDocumentMutationReducerError(error, getLanguage(runtime)));
};

const buildUpdateNodePayload = (
    runtime: ControllerRuntime,
    payload: UpdateNodeInput
): UpdateNodeInput => {
    const selectedSnapshot = runtime.deps.selectionStore.getState().selectedNodeSnapshot;
    const shouldDetachSubtree = Boolean(selectedSnapshot?.data.path) && !payload.data.path;
    if (!shouldDetachSubtree) {
        return payload;
    }

    const detachedSubtreeRoot = runtime.buildPersistedNodeFromResolved(payload.target.instanceKey, {
        clearPathOnRoot: true,
    });

    return {
        ...payload,
        detachedSubtreeRoot: detachedSubtreeRoot ?? undefined,
    };
};

const getResolvedNodeByInstanceKey = (
    runtime: ControllerRuntime,
    instanceKey: string
): ResolvedNodeModel | null => runtime.getResolvedGraph()?.nodesByInstanceKey[instanceKey] ?? null;

const executeUpdateTreeMetaCompat = async (
    runtime: ControllerRuntime,
    payload: UpdateTreeMetaInput
): Promise<void> => {
    const tree = runtime.deps.documentStore.getState().persistedTree;
    if (!tree) {
        return;
    }

    const mutation: ReducibleDocumentMutation = { type: "updateTreeMeta", payload };
    const result = reduceDocumentMutation(mutation, {
        tree,
        nodeDefs: runtime.deps.workspaceStore.getState().nodeDefs,
    });

    if (result.status === "error") {
        notifyDocumentMutationError(runtime, result.error);
        return;
    }

    if (result.status === "noop") {
        return;
    }

    await runtime.commitTreeMutation(result.tree, {
        syncSubtreeSources: false,
        rebuildGraph: result.rebuildGraph,
        preserveSelection: true,
        applyVisualState: true,
    });
};

const executeUpdateNodeCompat = async (
    runtime: ControllerRuntime,
    payload: UpdateNodeInput
): Promise<void> => {
    runtime.selectResolvedNodeState(payload.target.instanceKey);

    const currentTree = runtime.deps.documentStore.getState().persistedTree;
    const selectedSnapshot = runtime.deps.selectionStore.getState().selectedNodeSnapshot;
    if (!currentTree) {
        return;
    }

    const mutation: ReducibleDocumentMutation = {
        type: "updateNode",
        payload: buildUpdateNodePayload(runtime, payload),
    };
    const result = reduceDocumentMutation(mutation, {
        tree: currentTree,
        nodeDefs: runtime.deps.workspaceStore.getState().nodeDefs,
        selectedNode: selectedSnapshot,
    });

    if (result.status === "error") {
        notifyDocumentMutationError(runtime, result.error);
        return;
    }

    if (result.status === "noop") {
        return;
    }

    await runtime.commitTreeMutation(result.tree);
};

const resolveDropContext = (
    runtime: ControllerRuntime,
    intent: DropIntent
):
    | {
          currentTree: PersistedTreeModel;
          sourceResolved: ResolvedNodeModel;
          targetResolved: ResolvedNodeModel;
      }
    | null => {
    const currentTree = runtime.deps.documentStore.getState().persistedTree;
    const sourceResolved = getResolvedNodeByInstanceKey(runtime, intent.source.instanceKey);
    const targetResolved = getResolvedNodeByInstanceKey(runtime, intent.target.instanceKey);

    if (!currentTree || !sourceResolved || !targetResolved) {
        return null;
    }

    if (intent.source.instanceKey === intent.target.instanceKey) {
        return null;
    }

    if (sourceResolved.subtreeNode) {
        throw new Error(i18n.t("node.moveSubtreeDenied"));
    }

    if (targetResolved.subtreeNode) {
        throw new Error(i18n.t("node.dropSubtreeInternalDenied"));
    }

    if (sourceResolved.parentKey === null) {
        throw new Error(i18n.t("node.moveRootDenied"));
    }

    if (
        (intent.position === "before" || intent.position === "after") &&
        targetResolved.parentKey === null
    ) {
        throw new Error(i18n.t("node.dropAroundRootDenied"));
    }

    if (
        intent.position === "child" &&
        targetResolved.ref.sourceTreePath !== null &&
        !targetResolved.subtreeNode
    ) {
        throw new Error(i18n.t("node.addChildToSubtreeRefDenied"));
    }

    if (
        runtime.isDescendantInstance(
            sourceResolved.ref.instanceKey,
            targetResolved.ref.instanceKey
        )
    ) {
        throw new Error(i18n.t("node.moveIntoDescendantDenied"));
    }

    return {
        currentTree,
        sourceResolved,
        targetResolved,
    };
};

const executePerformDropCompat = async (
    runtime: ControllerRuntime,
    intent: DropIntent
): Promise<void> => {
    const dropContext = resolveDropContext(runtime, intent);
    if (!dropContext) {
        return;
    }

    const { currentTree, sourceResolved, targetResolved } = dropContext;
    const tree = clonePersistedTree(currentTree);
    const sourceLocation = runtime.findPersistedNodeLocationByStableId(
        tree.root,
        sourceResolved.ref.structuralStableId
    );
    const targetLocation = runtime.findPersistedNodeLocationByStableId(
        tree.root,
        targetResolved.ref.structuralStableId
    );

    if (!sourceLocation?.parent || !targetLocation) {
        return;
    }

    const sourceSiblings = sourceLocation.parent.children ?? [];
    const sourceIndex = sourceSiblings.findIndex((entry) => entry.uuid === sourceLocation.node.uuid);
    if (sourceIndex < 0) {
        return;
    }

    const [movedNode] = sourceSiblings.splice(sourceIndex, 1);
    if (!movedNode) {
        return;
    }

    if (intent.position === "child") {
        targetLocation.node.children ||= [];
        targetLocation.node.children.push(movedNode);
    } else {
        const targetParent = targetLocation.parent;
        if (!targetParent?.children) {
            return;
        }

        const targetIndex = targetParent.children.findIndex(
            (entry) => entry.uuid === targetLocation.node.uuid
        );
        if (targetIndex < 0) {
            return;
        }

        targetParent.children.splice(
            intent.position === "before" ? targetIndex : targetIndex + 1,
            0,
            movedNode
        );
    }

    await runtime.commitTreeMutation(tree, {
        prepareSelection: () => {
            runtime.selectResolvedNodeState(sourceResolved.ref.instanceKey);
        },
    });
};

const executePasteNodeCompat = async (
    runtime: ControllerRuntime,
    payload: ClipboardNodeMutationInput
): Promise<void> => {
    const currentTree = runtime.deps.documentStore.getState().persistedTree;
    const targetResolved = getResolvedNodeByInstanceKey(runtime, payload.target.instanceKey);
    if (!currentTree || !targetResolved) {
        return;
    }
    if (runtime.isSubtreeStructureLocked(targetResolved)) {
        runtime.notifyError(i18n.t("node.editSubtreeDenied"));
        return;
    }

    const tree = clonePersistedTree(currentTree);
    const targetNode = findPersistedNodeByStableId(tree.root, payload.target.structuralStableId);
    if (!targetNode) {
        return;
    }

    const nextNode = clonePersistedNode(payload.snapshot);
    runtime.assignFreshStableIds(nextNode);
    targetNode.children ||= [];
    targetNode.children.push(nextNode);

    await runtime.commitTreeMutation(tree, {
        prepareSelection: () => {
            runtime.selectPendingNodeState(nextNode.uuid);
        },
    });
};

const executeInsertNodeCompat = async (
    runtime: ControllerRuntime,
    payload: TargetNodeMutationInput
): Promise<void> => {
    const currentTree = runtime.deps.documentStore.getState().persistedTree;
    const targetResolved = getResolvedNodeByInstanceKey(runtime, payload.target.instanceKey);
    if (!currentTree || !targetResolved) {
        return;
    }
    if (runtime.isSubtreeStructureLocked(targetResolved)) {
        runtime.notifyError(i18n.t("node.editSubtreeDenied"));
        return;
    }

    const tree = clonePersistedTree(currentTree);
    const targetNode = findPersistedNodeByStableId(tree.root, payload.target.structuralStableId);
    if (!targetNode) {
        return;
    }

    const nextNode: PersistedNodeModel = {
        uuid: generateUuid(),
        id: "",
        name: "unknown",
    };
    targetNode.children ||= [];
    targetNode.children.push(nextNode);

    await runtime.commitTreeMutation(tree, {
        prepareSelection: () => {
            runtime.selectPendingNodeState(nextNode.uuid);
        },
    });
};

const executeReplaceNodeCompat = async (
    runtime: ControllerRuntime,
    payload: ClipboardNodeMutationInput
): Promise<void> => {
    const currentTree = runtime.deps.documentStore.getState().persistedTree;
    const targetResolved = getResolvedNodeByInstanceKey(runtime, payload.target.instanceKey);
    if (!currentTree || !targetResolved) {
        return;
    }
    if (runtime.isSubtreeStructureLocked(targetResolved)) {
        runtime.notifyError(i18n.t("node.editSubtreeDenied"));
        return;
    }

    const tree = clonePersistedTree(currentTree);
    const targetNode = findPersistedNodeByStableId(tree.root, payload.target.structuralStableId);
    if (!targetNode) {
        return;
    }

    const replacement = clonePersistedNode(payload.snapshot);
    replacement.uuid = targetNode.uuid;
    for (const child of replacement.children ?? []) {
        runtime.assignFreshStableIds(child);
    }
    if (replacement.path) {
        replacement.children = undefined;
    }
    runtime.overwritePersistedNode(targetNode, replacement);

    await runtime.commitTreeMutation(tree, {
        prepareSelection: () => {
            runtime.selectPendingNodeState(replacement.uuid);
        },
    });
};

const executeDeleteNodeCompat = async (
    runtime: ControllerRuntime,
    payload: TargetNodeMutationInput
): Promise<void> => {
    const currentTree = runtime.deps.documentStore.getState().persistedTree;
    const targetResolved = getResolvedNodeByInstanceKey(runtime, payload.target.instanceKey);
    if (!currentTree || !targetResolved) {
        return;
    }
    if (targetResolved.parentKey === null) {
        runtime.notifyError(i18n.t("node.deleteRootNodeDenied"));
        return;
    }
    if (targetResolved.subtreeNode) {
        runtime.notifyError(i18n.t("node.editSubtreeDenied"));
        return;
    }

    const tree = clonePersistedTree(currentTree);
    const location = runtime.findPersistedNodeLocationByStableId(
        tree.root,
        payload.target.structuralStableId
    );
    if (!location?.parent?.children) {
        return;
    }

    location.parent.children = location.parent.children.filter(
        (entry) => entry.uuid !== location.node.uuid
    );
    const nextSelection = location.parent.uuid;

    await runtime.commitTreeMutation(tree, {
        prepareSelection: () => {
            runtime.selectPendingNodeState(nextSelection);
        },
    });
};

const executeSaveSelectedAsSubtreeCompat = async (
    runtime: ControllerRuntime,
    payload: SaveSelectedAsSubtreeInput
): Promise<void> => {
    const currentTree = runtime.deps.documentStore.getState().persistedTree;
    const targetResolved = getResolvedNodeByInstanceKey(runtime, payload.target.instanceKey);
    if (!currentTree || !targetResolved) {
        return;
    }
    if (targetResolved.parentKey === null) {
        runtime.notifyError(i18n.t("node.subtreeSaveRootError"));
        return;
    }
    if (runtime.isSubtreeStructureLocked(targetResolved)) {
        runtime.notifyError(i18n.t("node.editSubtreeDenied"));
        return;
    }

    const subtreeModel: PersistedTreeModel = {
        version: VERSION,
        name: "subtree",
        prefix: "",
        desc: payload.subtreeRoot.desc,
        export: true,
        group: [],
        variables: {
            imports: [],
            locals: [],
        },
        custom: {},
        overrides: {},
        root: clonePersistedNode(payload.subtreeRoot),
    };

    const result = await runtime.deps.hostAdapter.saveSubtreeAs(
        serializePersistedTree(subtreeModel),
        payload.suggestedBaseName
    );
    if (!result.savedPath) {
        return;
    }

    const tree = clonePersistedTree(currentTree);
    const targetNode = findPersistedNodeByStableId(tree.root, payload.target.structuralStableId);
    if (!targetNode) {
        return;
    }

    targetNode.path = result.savedPath;
    targetNode.children = undefined;

    await runtime.commitTreeMutation(tree, {
        prepareSelection: () => {
            runtime.selectPendingNodeState(targetNode.uuid);
        },
    });
    runtime.notifySuccess(i18n.t("node.subtreeSaveSuccess", { path: targetNode.path }));
};

export const runDocumentMutationCompat = async (
    runtime: ControllerRuntime,
    mutation: DocumentMutation
): Promise<void> => {
    switch (mutation.type) {
        case "updateTreeMeta":
            await executeUpdateTreeMetaCompat(runtime, mutation.payload);
            return;

        case "updateNode":
            await executeUpdateNodeCompat(runtime, mutation.payload);
            return;

        case "performDrop":
            await executePerformDropCompat(runtime, mutation.payload);
            return;

        case "pasteNode":
            await executePasteNodeCompat(runtime, mutation.payload);
            return;

        case "insertNode":
            await executeInsertNodeCompat(runtime, mutation.payload);
            return;

        case "replaceNode":
            await executeReplaceNodeCompat(runtime, mutation.payload);
            return;

        case "deleteNode":
            await executeDeleteNodeCompat(runtime, mutation.payload);
            return;

        case "saveSelectedAsSubtree":
            await executeSaveSelectedAsSubtreeCompat(runtime, mutation.payload);
            return;
    }
};

export const createMutationCommands = (
    runtime: ControllerRuntime
): Pick<EditorCommand, MutationCommandKeys> => {
    const { deps } = runtime;

    const openSubtreePath = async (path: string) => {
        const subtreePath = parseWorkdirRelativeJsonPath(path);
        if (!subtreePath) {
            runtime.notifyError(i18n.t("validation.invalidJsonPath", { path }));
            return;
        }

        const response = await deps.hostAdapter.readFile(subtreePath, { openIfSubtree: true });
        if (response.content === null) {
            runtime.notifyError(i18n.t("node.subtreeOpenFailed", { path: subtreePath }));
        }
    };

    return {
        async updateTreeMeta(payload: UpdateTreeMetaInput) {
            const tree = deps.documentStore.getState().persistedTree;
            if (!tree) {
                return;
            }
            const mutation: ReducibleDocumentMutation = { type: "updateTreeMeta", payload };
            const result = reduceDocumentMutation(mutation, {
                tree,
                nodeDefs: deps.workspaceStore.getState().nodeDefs,
            });

            if (result.status === "error") {
                notifyDocumentMutationError(runtime, result.error);
                return;
            }

            if (isInspectorSidebar()) {
                await forwardDocumentMutation(runtime, mutation);
                return;
            }

            if (result.status === "noop") {
                return;
            }

            await runtime.commitTreeMutation(result.tree, {
                syncSubtreeSources: false,
                rebuildGraph: result.rebuildGraph,
                preserveSelection: true,
                applyVisualState: true,
            });
        },

        async updateNode(payload: UpdateNodeInput) {
            const currentTree = deps.documentStore.getState().persistedTree;
            const selectedSnapshot = deps.selectionStore.getState().selectedNodeSnapshot;
            if (!currentTree) {
                return;
            }

            const mutation: ReducibleDocumentMutation = {
                type: "updateNode",
                payload: buildUpdateNodePayload(runtime, payload),
            };
            const result = reduceDocumentMutation(mutation, {
                tree: currentTree,
                nodeDefs: deps.workspaceStore.getState().nodeDefs,
                selectedNode: selectedSnapshot,
            });

            if (result.status === "error") {
                if (
                    isInspectorSidebar() &&
                    (result.error.code === "missing-selected-node" ||
                        result.error.code === "selected-node-mismatch" ||
                        result.error.code === "missing-target-node" ||
                        result.error.code === "missing-subtree-original" ||
                        result.error.code === "missing-detached-subtree-root")
                ) {
                    await forwardDocumentMutation(runtime, mutation);
                    return;
                }

                notifyDocumentMutationError(runtime, result.error);
                return;
            }

            if (isInspectorSidebar()) {
                await forwardDocumentMutation(runtime, mutation);
                return;
            }

            if (result.status === "noop") {
                return;
            }

            await runtime.commitTreeMutation(result.tree);
        },

        async performDrop(intent: DropIntent) {
            const dropContext = resolveDropContext(runtime, intent);
            if (!dropContext) {
                return;
            }

            await forwardDocumentMutation(runtime, {
                type: "performDrop",
                payload: intent,
            });
        },

        async copyNode() {
            const selected = runtime.getSelectedResolvedNode();
            if (!selected) {
                runtime.notifyError(i18n.t("node.noNodeSelected"));
                return;
            }

            const snapshot = runtime.buildPersistedNodeFromResolved(selected.ref.instanceKey, {
                clearPathOnRoot: true,
            });
            if (!snapshot) {
                return;
            }

            try {
                await navigator.clipboard.writeText(stringifyJson(snapshot, { indent: 2 }));
            } catch (error) {
                deps.hostAdapter.log("warn", `[v2] clipboard write failed: ${String(error)}`);
            }
        },

        async pasteNode() {
            const selected = runtime.getSelectedResolvedNode();
            if (!selected) {
                runtime.notifyError(i18n.t("node.noNodeSelected"));
                return;
            }
            if (runtime.isSubtreeStructureLocked(selected)) {
                runtime.notifyError(i18n.t("node.editSubtreeDenied"));
                return;
            }

            const snapshot = await runtime.readClipboardNode();
            if (!snapshot) {
                return;
            }

            await forwardDocumentMutation(runtime, {
                type: "pasteNode",
                payload: {
                    target: selected.ref,
                    snapshot,
                },
            });
        },

        async insertNode() {
            const selected = runtime.getSelectedResolvedNode();
            if (!selected) {
                runtime.notifyError(i18n.t("node.noNodeSelected"));
                return;
            }
            if (runtime.isSubtreeStructureLocked(selected)) {
                runtime.notifyError(i18n.t("node.editSubtreeDenied"));
                return;
            }

            await forwardDocumentMutation(runtime, {
                type: "insertNode",
                payload: {
                    target: selected.ref,
                },
            });
        },

        async replaceNode() {
            const selected = runtime.getSelectedResolvedNode();
            if (!selected) {
                runtime.notifyError(i18n.t("node.noNodeSelected"));
                return;
            }
            if (runtime.isSubtreeStructureLocked(selected)) {
                runtime.notifyError(i18n.t("node.editSubtreeDenied"));
                return;
            }

            const snapshot = await runtime.readClipboardNode();
            if (!snapshot) {
                return;
            }

            await forwardDocumentMutation(runtime, {
                type: "replaceNode",
                payload: {
                    target: selected.ref,
                    snapshot,
                },
            });
        },

        async deleteNode() {
            const selected = runtime.getSelectedResolvedNode();
            if (!selected) {
                return;
            }
            if (selected.parentKey === null) {
                runtime.notifyError(i18n.t("node.deleteRootNodeDenied"));
                return;
            }
            if (selected.subtreeNode) {
                runtime.notifyError(i18n.t("node.editSubtreeDenied"));
                return;
            }

            await forwardDocumentMutation(runtime, {
                type: "deleteNode",
                payload: {
                    target: selected.ref,
                },
            });
        },

        openSubtreePath,

        async openSelectedSubtree() {
            const ref = deps.selectionStore.getState().selectedNodeRef;
            const resolvedGraph = runtime.getResolvedGraph();
            if (!ref || !resolvedGraph) {
                return;
            }
            const current = resolvedGraph.nodesByInstanceKey[ref.instanceKey];
            const lastSubtreePath =
                ref.subtreeStack.length > 0
                    ? ref.subtreeStack[ref.subtreeStack.length - 1]
                    : undefined;
            const path = current?.path ?? lastSubtreePath;
            if (!path) {
                return;
            }
            await openSubtreePath(path);
        },

        async saveSelectedAsSubtree() {
            const selected = runtime.getSelectedResolvedNode();
            if (!selected) {
                runtime.notifyError(i18n.t("node.noNodeSelected"));
                return;
            }
            if (selected.parentKey === null) {
                runtime.notifyError(i18n.t("node.subtreeSaveRootError"));
                return;
            }
            if (runtime.isSubtreeStructureLocked(selected)) {
                runtime.notifyError(i18n.t("node.editSubtreeDenied"));
                return;
            }

            const subtreeRoot = runtime.buildPersistedNodeFromResolved(selected.ref.instanceKey, {
                clearPathOnRoot: true,
            });
            if (!subtreeRoot) {
                return;
            }

            const suggestedBaseName = subtreeRoot.name?.trim() || "subtree";
            await forwardDocumentMutation(runtime, {
                type: "saveSelectedAsSubtree",
                payload: {
                    target: selected.ref,
                    subtreeRoot,
                    suggestedBaseName,
                },
            });
        },
    };
};
