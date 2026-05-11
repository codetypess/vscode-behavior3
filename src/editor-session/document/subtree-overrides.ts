import * as path from "path";
import * as vscode from "vscode";
import type { PersistedNodeModel, PersistedTreeModel } from "../../../webview/shared/contracts";
import type { EditorToHostMessage } from "../../../webview/shared/message-protocol";
import {
    findPersistedNodeByStableId,
    loadSubtreeSourceCache,
    pruneStaleSubtreeOverrides,
    walkPersistedNodes,
} from "../../../webview/shared/tree";

type DocumentMutation = Extract<EditorToHostMessage, { type: "mutateDocument" }>["mutation"];

function branchContainsSubtreeLink(node: PersistedNodeModel | null | undefined): boolean {
    if (!node) {
        return false;
    }

    let found = false;
    walkPersistedNodes(node, (entry) => {
        if (entry.path) {
            found = true;
        }
    });
    return found;
}

export async function normalizeReachableSubtreeOverrides(params: {
    tree: PersistedTreeModel;
    projectRootFsPath: string;
    readWorkspaceFileContent(fileUri: vscode.Uri): Promise<string>;
}): Promise<void> {
    if (Object.keys(params.tree.overrides).length === 0) {
        return;
    }

    const subtreeSources = await loadSubtreeSourceCache({
        root: params.tree.root,
        readContent: async (relativePath) => {
            const subtreeUri = vscode.Uri.file(path.join(params.projectRootFsPath, relativePath));
            try {
                return await params.readWorkspaceFileContent(subtreeUri);
            } catch {
                return null;
            }
        },
    });
    pruneStaleSubtreeOverrides({
        tree: params.tree,
        subtreeSources,
    });
}

export function mutationMayAffectSubtreeOverrideReachability(
    mutation: DocumentMutation,
    currentTree: PersistedTreeModel
): boolean {
    switch (mutation.type) {
        case "updateNode": {
            if (mutation.payload.currentNodeSnapshot?.subtreeNode) {
                return false;
            }

            const currentNode =
                findPersistedNodeByStableId(
                    currentTree.root,
                    mutation.payload.target.structuralStableId
                ) ?? mutation.payload.currentNodeSnapshot?.data;
            if (!currentNode) {
                return false;
            }

            const currentPath = currentNode.path;
            const nextPath = mutation.payload.data.path?.trim() || undefined;
            return currentPath !== nextPath;
        }

        case "replaceNode": {
            const currentNode = findPersistedNodeByStableId(
                currentTree.root,
                mutation.payload.target.structuralStableId
            );
            return (
                branchContainsSubtreeLink(currentNode) ||
                branchContainsSubtreeLink(mutation.payload.snapshot)
            );
        }

        case "deleteNode": {
            const currentNode = findPersistedNodeByStableId(
                currentTree.root,
                mutation.payload.target.structuralStableId
            );
            return branchContainsSubtreeLink(currentNode);
        }

        default:
            return false;
    }
}
