import { resolveDocumentGraph } from "./resolve-graph";
import type { NodeDef } from "../shared/misc/b3type";
import type {
    PersistedTreeModel,
    WorkdirRelativeJsonPath,
} from "../shared/contracts";
import { loadSubtreeSourceCache } from "../shared/subtree-source-cache";
import {
    applyMainTreeDisplayIds,
    clonePersistedTree,
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
}): Promise<MainDocumentSavePlan> => {
    const subtreeWritebacks: MainDocumentSubtreeWriteback[] = [];
    const subtreeSources = await loadSubtreeSourceCache({
        root: params.tree.root,
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
        persistedTree: params.tree,
        subtreeSources,
        nodeDefs: params.nodeDefs,
        subtreeEditable: true,
    });

    const nextTree = clonePersistedTree(params.tree);
    // Display ids are assigned after subtree resolution so saved main-tree ids match the canvas.
    applyMainTreeDisplayIds(nextTree.root, resolved.mainTreeDisplayIdsByStableId);
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
