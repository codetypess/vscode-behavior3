import i18n from "../shared/misc/i18n";
import type {
    DropIntent,
    DocumentMutation,
    DocumentMutationResponse,
    EditorCommand,
    ResolvedNodeModel,
    UpdateNodeInput,
    UpdateTreeMetaInput,
} from "../shared/contracts";
import { stringifyJson } from "../shared/misc/stringify";
import { parseWorkdirRelativeJsonPath } from "../shared/protocol";
import { clonePersistedNode } from "../shared/tree";
import {
    preflightDropIntent,
    type DropPreflightDenialReason,
} from "../shared/drop-preflight";
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

const forwardDocumentMutation = async (
    runtime: ControllerRuntime,
    mutation: DocumentMutation
): Promise<DocumentMutationResponse> => {
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
