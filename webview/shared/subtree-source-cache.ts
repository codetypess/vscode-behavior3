import type {
    PersistedNodeModel,
    PersistedTreeModel,
    SubtreeSourceCacheEntry,
    WorkdirRelativeJsonPath,
} from "./contracts";
import {
    collectReachableSubtreePaths,
    hasMissingStableIds,
    parsePersistedTreeContent,
} from "./tree";
import { parseWorkdirRelativeJsonPath } from "./protocol";

export const loadSubtreeSourceCache = async (params: {
    root: PersistedNodeModel;
    readContent: (path: WorkdirRelativeJsonPath) => Promise<string | null>;
    onTreeLoaded?: (entry: {
        path: WorkdirRelativeJsonPath;
        tree: PersistedTreeModel;
        content: string;
        needsWriteback: boolean;
    }) => void | Promise<void>;
}): Promise<Record<WorkdirRelativeJsonPath, SubtreeSourceCacheEntry>> => {
    const cache: Record<WorkdirRelativeJsonPath, SubtreeSourceCacheEntry> = {};
    const visited = new Set<WorkdirRelativeJsonPath>();

    const loadPath = async (path: string) => {
        const normalizedPath = parseWorkdirRelativeJsonPath(path);
        if (!normalizedPath) {
            return;
        }
        if (visited.has(normalizedPath)) {
            return;
        }
        // Subtree graphs may be cyclic; materialization reports cycles after sources are cached once.
        visited.add(normalizedPath);

        const content = await params.readContent(normalizedPath);
        if (content === null) {
            // Null means the file is missing; invalid JSON is represented by an error object below.
            cache[normalizedPath] = null;
            return;
        }

        try {
            const needsWriteback = hasMissingStableIds(content);
            const tree = parsePersistedTreeContent(content, normalizedPath);
            cache[normalizedPath] = tree;

            // Callers can stage normalized subtree content after parsing without rewalking the graph.
            await params.onTreeLoaded?.({
                path: normalizedPath,
                tree,
                content,
                needsWriteback,
            });

            for (const childPath of collectReachableSubtreePaths(tree.root)) {
                await loadPath(childPath);
            }
        } catch {
            cache[normalizedPath] = {
                error: "invalid-subtree",
            };
        }
    };

    for (const path of collectReachableSubtreePaths(params.root)) {
        await loadPath(path);
    }

    return cache;
};
