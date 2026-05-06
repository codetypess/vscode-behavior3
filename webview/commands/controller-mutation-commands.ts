import i18n from "../shared/misc/i18n";
import type {
    DropIntent,
    DocumentMutation,
    DocumentMutationResponse,
    DocumentMutationSelection,
    EditorCommand,
    PersistedTreeModel,
    ResolvedNodeModel,
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
import { clonePersistedNode } from "../shared/tree";
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

const applyMutationSelection = async (
    runtime: ControllerRuntime,
    nextSelection: DocumentMutationSelection | undefined
): Promise<void> => {
    if (!nextSelection || isInspectorSidebar()) {
        return;
    }

    if (nextSelection.kind === "tree") {
        runtime.selectTreeState();
        await runtime.deps.graphAdapter.applySelection({ selectedNodeKey: null });
        return;
    }

    const resolvedGraph = runtime.getResolvedGraph();
    const nextNode = Object.values(resolvedGraph?.nodesByInstanceKey ?? {}).find(
        (node) => node.ref.structuralStableId === nextSelection.structuralStableId
    );
    if (!nextNode) {
        runtime.selectPendingNodeState(nextSelection.structuralStableId);
        return;
    }

    runtime.selectResolvedNodeState(nextNode.ref.instanceKey);
    await runtime.deps.graphAdapter.applySelection({ selectedNodeKey: nextNode.ref.instanceKey });
};

const forwardDocumentMutation = async (
    runtime: ControllerRuntime,
    mutation: DocumentMutation
): Promise<DocumentMutationResponse> => {
    const response = await runtime.deps.hostAdapter.mutateDocument(mutation);
    if (!response.success) {
        runtime.notifyError(response.error ?? "Document mutation failed");
        return response;
    }
    await applyMutationSelection(runtime, response.nextSelection);
    return response;
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
    const currentNodeSnapshot = selectedSnapshot
        ? {
              data: clonePersistedNode(selectedSnapshot.data),
              subtreeNode: selectedSnapshot.subtreeNode,
              subtreeOriginal: selectedSnapshot.subtreeOriginal
                  ? clonePersistedNode(selectedSnapshot.subtreeOriginal)
                  : undefined,
          }
        : payload.currentNodeSnapshot;
    const shouldDetachSubtree = Boolean(currentNodeSnapshot?.data.path) && !payload.data.path;
    const detachedSubtreeRoot = shouldDetachSubtree
        ? runtime.buildPersistedNodeFromResolved(payload.target.instanceKey, {
              clearPathOnRoot: true,
          }) ?? undefined
        : payload.detachedSubtreeRoot;

    return {
        ...payload,
        currentNodeSnapshot,
        detachedSubtreeRoot,
    };
};

const getResolvedNodeByInstanceKey = (
    runtime: ControllerRuntime,
    instanceKey: string
): ResolvedNodeModel | null => runtime.getResolvedGraph()?.nodesByInstanceKey[instanceKey] ?? null;

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

            if (result.status === "noop") {
                return;
            }

            await forwardDocumentMutation(runtime, mutation);
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
                if (result.error.code === "missing-target-node") {
                    await forwardDocumentMutation(runtime, mutation);
                    return;
                }

                notifyDocumentMutationError(runtime, result.error);
                return;
            }

            if (result.status === "noop") {
                return;
            }

            await forwardDocumentMutation(runtime, mutation);
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
