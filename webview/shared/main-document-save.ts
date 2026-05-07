import { resolveDocumentGraph } from "../domain/resolve-graph";
import type { NodeDef } from "./misc/b3type";
import type {
    PersistedTreeModel,
    WorkdirRelativeJsonPath,
} from "./contracts";
import { loadSubtreeSourceCache } from "./subtree-source-cache";
import {
    applyMainTreeDisplayIds,
    clonePersistedTree,
    serializePersistedTree,
} from "./tree";

export const serializePersistedTreeForMainDocumentSave = async (params: {
    tree: PersistedTreeModel;
    nodeDefs: NodeDef[];
    readSubtreeContent: (path: WorkdirRelativeJsonPath) => Promise<string | null>;
}): Promise<string> => {
    const subtreeSources = await loadSubtreeSourceCache({
        root: params.tree.root,
        readContent: params.readSubtreeContent,
    });

    const resolved = resolveDocumentGraph({
        persistedTree: params.tree,
        subtreeSources,
        nodeDefs: params.nodeDefs,
        subtreeEditable: true,
    });

    const nextTree = clonePersistedTree(params.tree);
    applyMainTreeDisplayIds(nextTree.root, resolved.mainTreeDisplayIdsByStableId);
    return serializePersistedTree(nextTree);
};
