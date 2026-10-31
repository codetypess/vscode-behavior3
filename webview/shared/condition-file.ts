import type { ConditionCustom } from "./b3type";
import type { PersistedNodeModel, PersistedTreeModel } from "./contracts";
import { clonePersistedNode, cloneJsonValue, findPersistedNodeByStableId } from "./tree";

/**
 * A condition file is a virtual tree file that edits the first condition tree of one host node.
 * Its URI path is `/<host file name>/<host node uuid>/condition.json`, short enough for the
 * breadcrumbs; the full host file path rides in the `host` query parameter.
 */
export const CONDITION_FILE_SCHEME = "behavior3-condition";
export const CONDITION_FILE_NAME = "condition.json";
export const CONDITION_FILE_TREE_NAME = "condition";

const HOST_QUERY_KEY = "host";

/** Full path, unique per host file; used where a file path is shown to scripts or caches. */
export const buildConditionFilePath = (hostFilePath: string, hostStableId: string): string =>
    `${hostFilePath}/${encodeURIComponent(hostStableId)}/${CONDITION_FILE_NAME}`;

export const buildConditionFileLocation = (
    hostFilePath: string,
    hostStableId: string
): { path: string; query: string } => {
    const hostFileName = hostFilePath.split("/").pop() ?? hostFilePath;
    return {
        path: `/${hostFileName}/${encodeURIComponent(hostStableId)}/${CONDITION_FILE_NAME}`,
        query: `${HOST_QUERY_KEY}=${encodeURIComponent(hostFilePath)}`,
    };
};

export const parseConditionFileLocation = (location: {
    path: string;
    query: string;
}): { hostFilePath: string; hostStableId: string } | null => {
    const parts = location.path.split("/");
    if (parts.length !== 4 || parts[0] !== "" || parts[3] !== CONDITION_FILE_NAME) {
        return null;
    }
    const hostFilePath = new URLSearchParams(location.query).get(HOST_QUERY_KEY);
    const hostStableId = decodeURIComponent(parts[2]);
    if (!hostFilePath || !hostStableId || !hostFilePath.endsWith(`/${parts[1]}`)) {
        return null;
    }
    return { hostFilePath, hostStableId };
};

/** Condition-file view of a host node's first condition, or `null` when it has none. */
export const buildConditionFileTree = (
    hostTree: PersistedTreeModel,
    hostStableId: string
): PersistedTreeModel | null => {
    const host = findPersistedNodeByStableId(hostTree.root, hostStableId);
    const condition = host?.conditions?.[0];
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
