import { DOCUMENT_VERSION } from "../shared/b3type";
import {
    buildConditionRestoreUpdate,
    projectConditionBranchMutation,
    readHostConditionBranch,
} from "../domain/condition-edit";
import i18n from "../shared/i18n";
import type {
    DropIntent,
    DocumentMutation,
    DocumentMutationResponse,
    EditorCommand,
    NodeInstanceRef,
    ResolvedNodeModel,
    UpdateNodeInput,
    UpdateTreeMetaInput,
} from "../shared/contracts";
import {
    compareDocumentVersion,
    isReducibleDocumentMutation,
    formatDocumentMutationReducerError,
} from "../shared/document";
import { isJsonEqual, stringifyJson } from "../shared/json";
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
    | "saveSelectedAsSubtree"
    | "attachCondition"
    | "removeCondition"
    | "openConditionEditor"
    | "conditionEditIsDirty"
    | "finishConditionEditor";

type DropPreflightDenialReason =
    | "missing-context"
    | "same-node"
    | "move-subtree-denied"
    | "drop-subtree-internal-denied"
    | "move-root-denied"
    | "drop-around-root-denied"
    | "add-child-to-subtree-ref-denied"
    | "move-into-descendant-denied";

type DropPreflightResult =
    | { allowed: true }
    | { allowed: false; reason: DropPreflightDenialReason };

type DropPreflightNode = {
    ref: Pick<NodeInstanceRef, "instanceKey" | "sourceTreePath">;
    parentKey: string | null;
    subtreeNode: boolean;
};

const preflightDropIntent = (params: {
    hasDocument: boolean;
    intent: Pick<DropIntent, "position">;
    source: DropPreflightNode | null;
    target: DropPreflightNode | null;
    isDescendant: (ancestorKey: string, targetKey: string) => boolean;
}): DropPreflightResult => {
    const { hasDocument, intent, source, target, isDescendant } = params;

    // This is a UI-side fast guard; the reducer repeats structural checks before persisting.
    if (!hasDocument || !source || !target) {
        return { allowed: false, reason: "missing-context" };
    }

    if (source.ref.instanceKey === target.ref.instanceKey) {
        return { allowed: false, reason: "same-node" };
    }

    if (source.subtreeNode) {
        return { allowed: false, reason: "move-subtree-denied" };
    }

    if (target.subtreeNode) {
        return { allowed: false, reason: "drop-subtree-internal-denied" };
    }

    if (source.parentKey === null) {
        return { allowed: false, reason: "move-root-denied" };
    }

    if (
        (intent.position === "before" || intent.position === "after") &&
        target.parentKey === null
    ) {
        return { allowed: false, reason: "drop-around-root-denied" };
    }

    if (
        intent.position === "child" &&
        target.ref.sourceTreePath !== null &&
        !target.subtreeNode
    ) {
        return { allowed: false, reason: "add-child-to-subtree-ref-denied" };
    }

    if (isDescendant(source.ref.instanceKey, target.ref.instanceKey)) {
        return { allowed: false, reason: "move-into-descendant-denied" };
    }

    return { allowed: true };
};

const forwardDocumentMutation = async (
    runtime: ControllerRuntime,
    mutation: DocumentMutation
): Promise<DocumentMutationResponse> => {
    const session = runtime.deps.graphUiStore.getState().conditionEdit;
    const tree = runtime.deps.documentStore.getState().persistedTree;
    if (session && tree && isReducibleDocumentMutation(mutation)) {
        const workspace = runtime.deps.workspaceStore.getState();
        const projected = projectConditionBranchMutation({
            tree,
            subtreeSources: workspace.subtreeSources,
            nodeDefs: workspace.nodeDefs,
            subtreeEditable: workspace.settings.subtreeEditable,
            session,
            mutation,
        });
        if (projected.kind === "error") {
            const message = formatDocumentMutationReducerError(
                projected.error,
                workspace.settings.language
            );
            runtime.notifyError(message);
            return { success: false, error: message };
        }
        if (projected.kind === "noop") {
            return { success: true };
        }
        if (projected.kind === "update") {
            const response = await runtime.deps.hostAdapter.mutateDocument({
                type: "updateNode",
                payload: projected.update,
            });
            if (!response.success) {
                runtime.notifyError(response.error ?? "Document mutation failed");
            }
            return response;
        }
    }

    // Mutations always round-trip through the host so undo history and filesystem state stay canonical.
    const response = await runtime.deps.hostAdapter.mutateDocument(mutation);
    if (!response.success) {
        runtime.notifyError(response.error ?? "Document mutation failed");
        return response;
    }
    return response;
};

const buildUpdateNodePayload = (
    runtime: ControllerRuntime,
    payload: UpdateNodeInput
): UpdateNodeInput => {
    // Attach the latest selected snapshot so the host reducer can reject stale inspector commits.
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

const buildOpenedSubtreeSelectionRef = (target: NodeInstanceRef): NodeInstanceRef => ({
    instanceKey: target.sourceStableId,
    displayId: "",
    structuralStableId: target.sourceStableId,
    sourceStableId: target.sourceStableId,
    sourceTreePath: null,
    subtreeStack: [],
});

const getDeleteAnchorNodeKey = (
    runtime: ControllerRuntime,
    selected: ResolvedNodeModel
): string | null => {
    const parentKey = selected.parentKey;
    if (!parentKey) {
        return null;
    }

    const graph = runtime.getResolvedGraph();
    const parent = graph?.nodesByInstanceKey[parentKey];
    const candidateKeys = [
        ...(parent?.childKeys ?? []).filter((nodeKey) => nodeKey !== selected.ref.instanceKey),
        parentKey,
    ];
    return (
        runtime.deps.graphAdapter.pickNearestNodeAnchor?.(
            selected.ref.instanceKey,
            candidateKeys
        ) ??
        parentKey
    );
};

const formatDropPreflightDenial = (reason: DropPreflightDenialReason): string | null => {
    switch (reason) {
        case "move-subtree-denied":
            return i18n.t("node.moveSubtreeDenied");
        case "drop-subtree-internal-denied":
            return i18n.t("node.dropSubtreeInternalDenied");
        case "move-root-denied":
            return i18n.t("node.moveRootDenied");
        case "drop-around-root-denied":
            return i18n.t("node.dropAroundRootDenied");
        case "add-child-to-subtree-ref-denied":
            return i18n.t("node.addChildToSubtreeRefDenied");
        case "move-into-descendant-denied":
            return i18n.t("node.moveIntoDescendantDenied");
        case "missing-context":
        case "same-node":
            return null;
    }
};

const canForwardDropIntent = (runtime: ControllerRuntime, intent: DropIntent): boolean => {
    // Preflight gives immediate UI feedback; the host reducer repeats these checks before persisting.
    const currentTree = runtime.deps.documentStore.getState().persistedTree;
    const sourceResolved = getResolvedNodeByInstanceKey(runtime, intent.source.instanceKey);
    const targetResolved = getResolvedNodeByInstanceKey(runtime, intent.target.instanceKey);

    const preflight = preflightDropIntent({
        hasDocument: Boolean(currentTree),
        intent,
        source: sourceResolved,
        target: targetResolved,
        isDescendant: (ancestorKey, targetKey) =>
            runtime.isDescendantInstance(ancestorKey, targetKey),
    });

    if (!preflight.allowed) {
        const message = formatDropPreflightDenial(preflight.reason);
        if (message) {
            throw new Error(message);
        }
        return false;
    }

    return true;
};

export const createMutationCommands = (
    runtime: ControllerRuntime
): Pick<EditorCommand, MutationCommandKeys> => {
    const { deps } = runtime;

    const openSubtreePath = async (path: string, opts?: { openSelection?: NodeInstanceRef }) => {
        const subtreePath = parseWorkdirRelativeJsonPath(path);
        if (!subtreePath) {
            runtime.notifyError(i18n.t("validation.invalidJsonPath", { path }));
            return;
        }

        const response = await deps.hostAdapter.readFile(subtreePath, {
            openIfSubtree: true,
            openSelection: opts?.openSelection,
        });
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

            await forwardDocumentMutation(runtime, { type: "updateTreeMeta", payload });
        },

        async updateNode(payload: UpdateNodeInput) {
            const currentTree = deps.documentStore.getState().persistedTree;
            if (!currentTree) {
                return;
            }

            await forwardDocumentMutation(runtime, {
                type: "updateNode",
                payload: buildUpdateNodePayload(runtime, payload),
            });
        },

        async performDrop(intent: DropIntent) {
            if (!canForwardDropIntent(runtime, intent)) {
                return;
            }

            runtime.setNextGraphRenderAnchor(intent.target.instanceKey);
            try {
                const response = await forwardDocumentMutation(runtime, {
                    type: "performDrop",
                    payload: intent,
                });
                if (!response.success) {
                    runtime.setNextGraphRenderAnchor(null);
                }
            } catch (error) {
                runtime.setNextGraphRenderAnchor(null);
                throw error;
            }
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

            runtime.setNextGraphRenderAnchor(selected.ref.instanceKey);
            try {
                const response = await forwardDocumentMutation(runtime, {
                    type: "insertNode",
                    payload: {
                        target: selected.ref,
                    },
                });
                if (!response.success) {
                    runtime.setNextGraphRenderAnchor(null);
                }
            } catch (error) {
                runtime.setNextGraphRenderAnchor(null);
                throw error;
            }
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

            const anchorNodeKey = getDeleteAnchorNodeKey(runtime, selected);
            runtime.setNextGraphRenderAnchor(anchorNodeKey);
            try {
                const response = await forwardDocumentMutation(runtime, {
                    type: "deleteNode",
                    payload: {
                        target: selected.ref,
                    },
                });
                if (!response.success) {
                    runtime.setNextGraphRenderAnchor(null);
                }
            } catch (error) {
                runtime.setNextGraphRenderAnchor(null);
                throw error;
            }
        },

        openSubtreePath,

        async openSelectedSubtree(target) {
            const ref = target ?? deps.selectionStore.getState().selectedNodeRef;
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
            await openSubtreePath(path, {
                openSelection: buildOpenedSubtreeSelectionRef(ref),
            });
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

        async attachCondition(entryName) {
            const selected = runtime.getSelectedResolvedNode();
            if (!selected) {
                runtime.notifyError(i18n.t("node.noNodeSelected"));
                return;
            }
            if (runtime.deps.graphUiStore.getState().conditionEdit) {
                runtime.notifyError(i18n.t("mutation.conditionNested"));
                return;
            }
            if (selected.attachedConditionName) {
                runtime.notifyError(i18n.t("mutation.conditionAlreadyAttached"));
                return;
            }

            const selectedSnapshot = runtime.deps.selectionStore.getState().selectedNodeSnapshot;
            await forwardDocumentMutation(runtime, {
                type: "attachCondition",
                payload: {
                    target: selected.ref,
                    entryName,
                    currentNodeSnapshot: selectedSnapshot
                        ? {
                              data: clonePersistedNode(selectedSnapshot.data),
                              subtreeNode: selectedSnapshot.subtreeNode,
                              subtreeOriginal: selectedSnapshot.subtreeOriginal
                                  ? clonePersistedNode(selectedSnapshot.subtreeOriginal)
                                  : undefined,
                          }
                        : undefined,
                },
            });
        },

        async removeCondition() {
            const selected = runtime.getSelectedResolvedNode();
            if (!selected) {
                runtime.notifyError(i18n.t("node.noNodeSelected"));
                return;
            }
            if (runtime.deps.graphUiStore.getState().conditionEdit) {
                runtime.notifyError(i18n.t("mutation.conditionNested"));
                return;
            }
            if (!selected.attachedConditionName) {
                runtime.notifyError(i18n.t("mutation.conditionNotAttached"));
                return;
            }
            const selectedSnapshot = runtime.deps.selectionStore.getState().selectedNodeSnapshot;
            if (selected.subtreeNode && selectedSnapshot?.subtreeOriginal?.conditions?.length) {
                runtime.notifyError(i18n.t("mutation.conditionClearDenied"));
                return;
            }

            await forwardDocumentMutation(runtime, {
                type: "removeCondition",
                payload: {
                    target: selected.ref,
                    currentNodeSnapshot: selectedSnapshot
                        ? {
                              data: clonePersistedNode(selectedSnapshot.data),
                              subtreeNode: selectedSnapshot.subtreeNode,
                              subtreeOriginal: selectedSnapshot.subtreeOriginal
                                  ? clonePersistedNode(selectedSnapshot.subtreeOriginal)
                                  : undefined,
                          }
                        : undefined,
                },
            });
        },

        async openConditionEditor(target) {
            if (runtime.deps.graphUiStore.getState().conditionEdit) {
                return;
            }
            const resolved = runtime.getResolvedGraph()?.nodesByInstanceKey[target.instanceKey];
            const tree = runtime.deps.documentStore.getState().persistedTree;
            const workspace = runtime.deps.workspaceStore.getState();
            if (!resolved?.attachedConditionName || !tree) {
                return;
            }
            const branch = readHostConditionBranch({
                tree,
                subtreeSources: workspace.subtreeSources,
                nodeDefs: workspace.nodeDefs,
                subtreeEditable: workspace.settings.subtreeEditable,
                hostRef: resolved.ref,
            });
            if (!branch) {
                return;
            }

            runtime.deps.graphUiStore.setState((state) => ({
                ...state,
                conditionEdit: {
                    hostRef: resolved.ref,
                    source: "editor",
                    hostName: resolved.name,
                    hostSubtreeNode: resolved.subtreeNode,
                    entryCondition: branch,
                },
            }));
            await runtime.rebuildGraph({ preserveSelection: false });
            const rootKey = runtime.getResolvedGraph()?.rootKey;
            const root = rootKey
                ? runtime.getResolvedGraph()?.nodesByInstanceKey[rootKey]
                : undefined;
            if (root) {
                // `conditionHost` lets the sidebar open the same page and resolve this ref.
                runtime.deps.hostAdapter.selectNode(root.ref, undefined, resolved.ref);
                await runtime.showSelectionVisualHint(root.ref.instanceKey);
            }
        },

        conditionEditIsDirty() {
            const session = runtime.deps.graphUiStore.getState().conditionEdit;
            const tree = runtime.deps.documentStore.getState().persistedTree;
            const workspace = runtime.deps.workspaceStore.getState();
            if (!session?.entryCondition || !tree) {
                return false;
            }
            const branch = readHostConditionBranch({
                tree,
                subtreeSources: workspace.subtreeSources,
                nodeDefs: workspace.nodeDefs,
                subtreeEditable: workspace.settings.subtreeEditable,
                hostRef: session.hostRef,
            });
            return !isJsonEqual(branch, session.entryCondition);
        },

        async finishConditionEditor(action) {
            const session = runtime.deps.graphUiStore.getState().conditionEdit;
            if (!session) {
                return true;
            }

            const leave = async () => {
                runtime.deps.graphUiStore.setState((state) => ({
                    ...state,
                    conditionEdit: null,
                }));
                await runtime.rebuildGraph({ preserveSelection: false });
                const graph = runtime.getResolvedGraph();
                const host = graph
                    ? Object.values(graph.nodesByInstanceKey).find(
                          (node) =>
                              node.ref.structuralStableId === session.hostRef.structuralStableId &&
                              node.ref.sourceStableId === session.hostRef.sourceStableId
                      )
                    : undefined;
                // Either selection drops `conditionHost`, which closes mirrored pages too.
                if (host) {
                    runtime.deps.hostAdapter.selectNode(host.ref);
                    await runtime.showSelectionVisualHint(host.ref.instanceKey);
                } else {
                    runtime.deps.hostAdapter.selectTree();
                }
            };

            if (action === "save") {
                const currentTree = runtime.deps.documentStore.getState().persistedTree;
                if (
                    currentTree &&
                    compareDocumentVersion(currentTree.version, DOCUMENT_VERSION) > 0
                ) {
                    runtime.deps.hostAdapter.log(
                        "warn",
                        `[v2] refusing to save newer file version: ${currentTree.version}`
                    );
                    return false;
                }
                const saved = await runtime.deps.hostAdapter.saveDocument();
                if (!saved.success) {
                    const error = saved.error ?? "Save failed";
                    runtime.notifyError(
                        error.includes("condition-nested")
                            ? i18n.t("mutation.conditionNested")
                            : error.includes("condition-running-status")
                              ? i18n.t("mutation.conditionRunningStatus")
                              : error
                    );
                    return false;
                }
                await leave();
                return true;
            }

            const tree = runtime.deps.documentStore.getState().persistedTree;
            const workspace = runtime.deps.workspaceStore.getState();
            if (tree && session.entryCondition) {
                const current = readHostConditionBranch({
                    tree,
                    subtreeSources: workspace.subtreeSources,
                    nodeDefs: workspace.nodeDefs,
                    subtreeEditable: workspace.settings.subtreeEditable,
                    hostRef: session.hostRef,
                });
                if (!isJsonEqual(current, session.entryCondition)) {
                    const update = buildConditionRestoreUpdate({
                        tree,
                        subtreeSources: workspace.subtreeSources,
                        nodeDefs: workspace.nodeDefs,
                        subtreeEditable: workspace.settings.subtreeEditable,
                        session,
                    });
                    if (!update) {
                        runtime.notifyError(i18n.t("mutation.missingTargetNode"));
                        return false;
                    }
                    const response = await runtime.deps.hostAdapter.mutateDocument({
                        type: "updateNode",
                        payload: update,
                    });
                    if (!response.success) {
                        runtime.notifyError(response.error ?? "Document mutation failed");
                        return false;
                    }
                }
            }
            await leave();
            return true;
        },
    };
};
