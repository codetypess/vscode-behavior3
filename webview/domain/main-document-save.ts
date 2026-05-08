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
