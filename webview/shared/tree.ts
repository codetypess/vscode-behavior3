import { DOCUMENT_VERSION, type TreeData } from "./b3type";
import { getFs } from "./b3fs";
import b3path from "./b3path";
import { parseTreeContent } from "./schema";
import { stringifyJson } from "./json";
import { createNode, subtreeNeedsMissingIds } from "./tree-model";
import type {
    PersistedNodeModel,
    PersistedTreeModel,
    SubtreeSourceCacheEntry,
    WorkdirRelativeJsonPath,
} from "./contracts";
import { parseWorkdirRelativeJsonPath } from "./protocol";

export const cloneJsonValue = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const clonePersistedTree = (tree: PersistedTreeModel): PersistedTreeModel =>
    cloneJsonValue(tree);

export const clonePersistedNode = (node: PersistedNodeModel): PersistedNodeModel =>
    cloneJsonValue(node);

export const treeDataForPersistence = (data: TreeData, name: string): TreeData => {
    return {
        version: DOCUMENT_VERSION,
        name,
        desc: data.desc?.trim() || undefined,
        prefix: data.prefix ?? "",
        export: data.export,
        group: data.group ?? [],
        variables: {
            imports: data.variables?.imports ?? [],
            locals: data.variables?.locals ?? [],
        },
        root: createNode(data.root),
        custom: data.custom ?? {},
        overrides: data.overrides ?? {},
    };
};

export const writeTree = (data: TreeData, name: string): string => {
    return stringifyJson(treeDataForPersistence(data, name), { indent: 2 });
};

/** Parse tree JSON from editor / postMessage string content. */
export const readTree = (text: string, opts?: { stableIdSeed?: string }): TreeData => {
    return parseTreeContent(text, opts);
};

/** Load tree from disk path. */
export const readTreeFromFile = (path: string): TreeData => {
    const str = getFs().readFileSync(path, "utf-8");
    return parseTreeContent(str, { stableIdSeed: path.replace(/\\/g, "/") });
};

export const parsePersistedTreeContent = (
    content: string,
    filePath?: string
): PersistedTreeModel => {
    const tree = readTree(
        content,
        filePath ? { stableIdSeed: filePath.replace(/\\/g, "/") } : undefined
    );
    if (filePath) {
        tree.name = b3path.basenameWithoutExt(filePath);
    }
    return treeDataForPersistence(tree, tree.name) as PersistedTreeModel;
};

export const serializePersistedTree = (tree: PersistedTreeModel): string => {
    return writeTree(tree as never, tree.name);
};

export const walkPersistedNodes = (
    node: PersistedNodeModel,
    visitor: (node: PersistedNodeModel, parent: PersistedNodeModel | null, depth: number) => void,
    parent: PersistedNodeModel | null = null,
    depth = 0
) => {
    visitor(node, parent, depth);
    for (const child of node.children ?? []) {
        walkPersistedNodes(child, visitor, node, depth + 1);
    }
};

export const findPersistedNodeByStableId = (
    root: PersistedNodeModel,
    stableId: string
): PersistedNodeModel | null => {
    let found: PersistedNodeModel | null = null;
    walkPersistedNodes(root, (node) => {
        if (!found && node.uuid === stableId) {
            found = node;
        }
    });
    return found;
};

export const findPersistedNodeById = (
    root: PersistedNodeModel,
    displayId: string
): PersistedNodeModel | null => {
    let found: PersistedNodeModel | null = null;
    walkPersistedNodes(root, (node) => {
        if (!found && node.id === displayId) {
            found = node;
        }
    });
    return found;
};

export const collectReachableSubtreePaths = (
    root: PersistedNodeModel
): WorkdirRelativeJsonPath[] => {
    const paths = new Set<WorkdirRelativeJsonPath>();
    walkPersistedNodes(root, (node) => {
        if (node.path) {
            paths.add(node.path);
        }
    });
    return Array.from(paths);
};

const isValidSubtreeSource = (entry: SubtreeSourceCacheEntry): entry is PersistedTreeModel =>
    Boolean(entry && !("error" in entry));

export const collectReachableSubtreeSourceStableIds = (params: {
    root: PersistedNodeModel;
    subtreeSources: Record<WorkdirRelativeJsonPath, SubtreeSourceCacheEntry>;
}): { stableIds: Set<string>; complete: boolean } => {
    const stableIds = new Set<string>();
    const visitedPaths = new Set<WorkdirRelativeJsonPath>();
    let complete = true;

    const visitSubtreePath = (subtreePath: WorkdirRelativeJsonPath) => {
        if (visitedPaths.has(subtreePath)) {
            return;
        }
        visitedPaths.add(subtreePath);

        const entry = params.subtreeSources[subtreePath];
        if (!isValidSubtreeSource(entry)) {
            complete = false;
            return;
        }

        walkPersistedNodes(entry.root, (node) => {
            stableIds.add(node.uuid);
            if (node.path) {
                visitSubtreePath(node.path);
            }
        });
    };

    walkPersistedNodes(params.root, (node) => {
        if (node.path) {
            visitSubtreePath(node.path);
        }
    });

    return { stableIds, complete };
};

export const pruneStaleSubtreeOverrides = (params: {
    tree: PersistedTreeModel;
    subtreeSources: Record<WorkdirRelativeJsonPath, SubtreeSourceCacheEntry>;
}): boolean => {
    const overrideKeys = Object.keys(params.tree.overrides);
    if (overrideKeys.length === 0) {
        return false;
    }

    const { stableIds, complete } = collectReachableSubtreeSourceStableIds({
        root: params.tree.root,
        subtreeSources: params.subtreeSources,
    });
    if (!complete) {
        return false;
    }

    let changed = false;
    for (const key of overrideKeys) {
        if (stableIds.has(key)) {
            continue;
        }
        delete params.tree.overrides[key];
        changed = true;
    }

    return changed;
};

export const collectTransitivePaths = async (
    seedPaths: Iterable<string>,
    expand: (path: string) => Promise<Iterable<string> | null | undefined>
): Promise<string[]> => {
    // Breadth-first order keeps declarations close to the order users see in tree metadata.
    const ordered: string[] = [];
    const seen = new Set<string>();
    const queue = Array.from(seedPaths);

    while (queue.length > 0) {
        const currentPath = queue.shift();
        if (!currentPath || seen.has(currentPath)) {
            continue;
        }

        seen.add(currentPath);
        ordered.push(currentPath);

        const children = await expand(currentPath);
        if (!children) {
            continue;
        }

        for (const childPath of children) {
            if (childPath && !seen.has(childPath)) {
                queue.push(childPath);
            }
        }
    }

    return ordered;
};

export const applyMainTreeDisplayIds = (
    root: PersistedNodeModel,
    idsByStableId: Record<string, string>
) => {
    walkPersistedNodes(root, (node) => {
        const nextId = idsByStableId[node.uuid];
        if (nextId) {
            node.id = nextId;
        }
    });
};

export const needsLegacyTreeWriteback = (content: string): boolean => {
    try {
        const parsed = JSON.parse(content) as {
            version?: unknown;
            root?: unknown;
            $override?: unknown;
            import?: unknown;
            vars?: unknown;
        };
        // Legacy files may need a writeback to add metadata, UUIDs, and migrate old root-level fields.
        return (
            parsed.version === undefined ||
            subtreeNeedsMissingIds(parsed.root) ||
            parsed.$override !== undefined ||
            parsed.import !== undefined ||
            parsed.vars !== undefined
        );
    } catch {
        return false;
    }
};

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
            const needsWriteback = needsLegacyTreeWriteback(content);
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
