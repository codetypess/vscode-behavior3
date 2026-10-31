import { assertConditionBranchesSavable } from "../shared/condition-branch";
import { resolveDocumentGraph } from "./resolve-graph";
import { collectNodeIds } from "../shared/custom-field-scripts";
import type { NodeDef } from "../shared/b3type";
import type { PersistedTreeModel, WorkdirRelativeJsonPath } from "../shared/contracts";
import {
    applyMainTreeDisplayIds,
    clonePersistedTree,
    loadSubtreeSourceCache,
    pruneStaleSubtreeOverrides,
    serializePersistedTree,
} from "../shared/tree";

export interface MainDocumentSubtreeWriteback {
    path: WorkdirRelativeJsonPath;
    content: string;
}

export interface MainDocumentSavePlan {
    content: string;
    subtreeWritebacks: MainDocumentSubtreeWriteback[];
}

export const preparePersistedTreeForMainDocumentSave = async (params: {
    tree: PersistedTreeModel;
    nodeDefs: NodeDef[];
    readSubtreeContent: (path: WorkdirRelativeJsonPath) => Promise<string | null>;
    /** Runs on the tree after ids are written; gets each node's id from before. */
    afterApplyDisplayIds?: (
        tree: PersistedTreeModel,
        previousNodeId: (node: { id: string }) => string | undefined
    ) => Promise<void>;
}): Promise<MainDocumentSavePlan> => {
    const subtreeWritebacks: MainDocumentSubtreeWriteback[] = [];
    const nextTree = clonePersistedTree(params.tree);
    assertConditionBranchesSavable(nextTree, params.nodeDefs);
    const subtreeSources = await loadSubtreeSourceCache({
        root: nextTree.root,
        readContent: params.readSubtreeContent,
        onTreeLoaded: ({ path, tree, needsWriteback }) => {
            if (!needsWriteback) {
                return;
            }
            subtreeWritebacks.push({
                path,
                content: serializePersistedTree(tree),
            });
        },
    });

    const resolved = resolveDocumentGraph({
        persistedTree: nextTree,
        subtreeSources,
        nodeDefs: params.nodeDefs,
        subtreeEditable: true,
    });

    pruneStaleSubtreeOverrides({
        tree: nextTree,
        subtreeSources,
    });
    const previousNodeIds = collectNodeIds(nextTree.root);
    // Display ids are assigned after subtree resolution so saved main-tree ids match the canvas.
    applyMainTreeDisplayIds(nextTree.root, resolved.mainTreeDisplayIdsByStableId);
    await params.afterApplyDisplayIds?.(nextTree, (node) => previousNodeIds.get(node));
    return {
        content: serializePersistedTree(nextTree),
        subtreeWritebacks,
    };
};

export const serializePersistedTreeForMainDocumentSave = async (params: {
    tree: PersistedTreeModel;
    nodeDefs: NodeDef[];
    readSubtreeContent: (path: WorkdirRelativeJsonPath) => Promise<string | null>;
}): Promise<string> => {
    const savePlan = await preparePersistedTreeForMainDocumentSave(params);
    return savePlan.content;
};
