import type { ConditionCustom } from "./b3type";
import type { PersistedNodeModel, PersistedTreeModel } from "./contracts";
import { clonePersistedNode, cloneJsonValue, findPersistedNodeByStableId } from "./tree";

/**
 * A condition file is a virtual tree file that edits one condition item of one host node.
 * Its URI path is `/<host file name>/<host node uuid>/condition.json` for the first item and
 * `condition-<n>.json` for item n, short enough for the breadcrumbs; the full host file path
 * rides in the `host` query parameter.
 */
export const CONDITION_FILE_SCHEME = "behavior3-condition";
export const CONDITION_FILE_NAME = "condition.json";
export const CONDITION_FILE_TREE_NAME = "condition";

const HOST_QUERY_KEY = "host";
const INDEXED_FILE_NAME_PATTERN = /^condition-([1-9]\d*)\.json$/;

/** `condition.json` for the first item keeps the tab address it had before items were indexed. */
export const conditionFileName = (index: number): string =>
    index === 0 ? CONDITION_FILE_NAME : `condition-${index + 1}.json`;

const parseConditionFileName = (name: string): number | null => {
    if (name === CONDITION_FILE_NAME) {
        return 0;
    }
    const match = INDEXED_FILE_NAME_PATTERN.exec(name);
    const index = match ? Number(match[1]) - 1 : null;
    // `condition-1.json` would alias `condition.json`.
    return index !== null && index > 0 ? index : null;
};

/** Full path, unique per host file; used where a file path is shown to scripts or caches. */
export const buildConditionFilePath = (
    hostFilePath: string,
    hostStableId: string,
    index: number
): string => `${hostFilePath}/${encodeURIComponent(hostStableId)}/${conditionFileName(index)}`;

export const buildConditionFileLocation = (
    hostFilePath: string,
    hostStableId: string,
    index: number
): { path: string; query: string } => {
    const hostFileName = hostFilePath.split("/").pop() ?? hostFilePath;
    return {
        path: `/${hostFileName}/${encodeURIComponent(hostStableId)}/${conditionFileName(index)}`,
        query: `${HOST_QUERY_KEY}=${encodeURIComponent(hostFilePath)}`,
    };
};

export const parseConditionFileLocation = (location: {
    path: string;
    query: string;
}): { hostFilePath: string; hostStableId: string; index: number } | null => {
    const parts = location.path.split("/");
    const index = parts.length === 4 ? parseConditionFileName(parts[3]) : null;
    if (parts[0] !== "" || index === null) {
        return null;
    }
    const hostFilePath = new URLSearchParams(location.query).get(HOST_QUERY_KEY);
    const hostStableId = decodeURIComponent(parts[2]);
    if (!hostFilePath || !hostStableId || !hostFilePath.endsWith(`/${parts[1]}`)) {
        return null;
    }
    return { hostFilePath, hostStableId, index };
};

/** Condition-file view of one condition item of a host node, or `null` when it is missing. */
export const buildConditionFileTree = (
    hostTree: PersistedTreeModel,
    hostStableId: string,
    index: number
): PersistedTreeModel | null => {
    const host = findPersistedNodeByStableId(hostTree.root, hostStableId);
    const condition = host?.conditions?.[index];
    if (!condition) {
        return null;
    }
    // Variables and overrides come along so inspector checks and subtree nodes match the host file.
    // The tree's custom data is the condition item's own `custom`.
    return {
        version: hostTree.version,
        name: CONDITION_FILE_TREE_NAME,
        prefix: hostTree.prefix,
        export: hostTree.export,
        group: [...hostTree.group],
        variables: cloneJsonValue(hostTree.variables),
        custom: cloneJsonValue(condition.custom ?? {}),
        root: clonePersistedNode(condition.root),
        overrides: cloneJsonValue(hostTree.overrides),
    };
};

/** What a condition file writes back to its host file. */
export const readConditionFileWriteBack = (
    conditionTree: PersistedTreeModel
): {
    root: PersistedNodeModel;
    custom: ConditionCustom | undefined;
    overrides: PersistedTreeModel["overrides"];
} => ({
    root: clonePersistedNode(conditionTree.root),
    custom: Object.keys(conditionTree.custom).length
        ? cloneJsonValue(conditionTree.custom)
        : undefined,
    overrides: cloneJsonValue(conditionTree.overrides),
});
