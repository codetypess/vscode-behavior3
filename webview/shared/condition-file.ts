import type { ConditionCustom } from "./b3type";
import type { PersistedConditionData, PersistedNodeModel, PersistedTreeModel } from "./contracts";
import { clonePersistedNode, cloneJsonValue, findPersistedNodeByStableId } from "./tree";

/**
 * A condition file is a virtual tree file that edits one condition item of one host node.
 * Its URI path is `/<host file name>/<host node uuid>/condition-<condition root uuid>.json`, short
 * enough for the breadcrumbs; the full host file path rides in the `host` query parameter. The
 * item is found by its root uuid, which edits inside the condition tree keep, so the tab follows
 * the item when the host reorders its conditions.
 */
export const CONDITION_FILE_SCHEME = "behavior3-condition";
export const CONDITION_FILE_TREE_NAME = "condition";

const HOST_QUERY_KEY = "host";
const FILE_NAME_PATTERN = /^condition-(.+)\.json$/;

const conditionFileName = (rootUuid: string): string =>
    `condition-${encodeURIComponent(rootUuid)}.json`;

const parseConditionFileName = (name: string): string | null => {
    const match = FILE_NAME_PATTERN.exec(name);
    if (!match) {
        return null;
    }
    try {
        return decodeURIComponent(match[1]) || null;
    } catch {
        return null;
    }
};

/** Full path, unique per host file; used where a file path is shown to scripts or caches. */
export const buildConditionFilePath = (
    hostFilePath: string,
    hostStableId: string,
    rootUuid: string
): string => `${hostFilePath}/${encodeURIComponent(hostStableId)}/${conditionFileName(rootUuid)}`;

export const buildConditionFileLocation = (
    hostFilePath: string,
    hostStableId: string,
    rootUuid: string
): { path: string; query: string } => {
    const hostFileName = hostFilePath.split("/").pop() ?? hostFilePath;
    return {
        path: `/${hostFileName}/${encodeURIComponent(hostStableId)}/${conditionFileName(rootUuid)}`,
        query: `${HOST_QUERY_KEY}=${encodeURIComponent(hostFilePath)}`,
    };
};

export const parseConditionFileLocation = (location: {
    path: string;
    query: string;
}): { hostFilePath: string; hostStableId: string; rootUuid: string } | null => {
    const parts = location.path.split("/");
    const rootUuid = parts.length === 4 ? parseConditionFileName(parts[3]) : null;
    if (parts[0] !== "" || rootUuid === null) {
        return null;
    }
    const hostFilePath = new URLSearchParams(location.query).get(HOST_QUERY_KEY);
    const hostStableId = decodeURIComponent(parts[2]);
    if (!hostFilePath || !hostStableId || !hostFilePath.endsWith(`/${parts[1]}`)) {
        return null;
    }
    return { hostFilePath, hostStableId, rootUuid };
};

/** Current index of the host node's condition item with this root uuid, or -1 when it is gone. */
export const findConditionItemIndex = (
    hostTree: PersistedTreeModel,
    hostStableId: string,
    rootUuid: string
): number =>
    findPersistedNodeByStableId(hostTree.root, hostStableId)?.conditions?.findIndex(
        (condition) => condition.root.uuid === rootUuid
    ) ?? -1;

const findConditionItem = (
    hostTree: PersistedTreeModel,
    hostStableId: string,
    rootUuid: string
): PersistedConditionData | null =>
    findPersistedNodeByStableId(hostTree.root, hostStableId)?.conditions?.find(
        (condition) => condition.root.uuid === rootUuid
    ) ?? null;

/** Condition-file view of one condition item of a host node, or `null` when it is missing. */
export const buildConditionFileTree = (
    hostTree: PersistedTreeModel,
    hostStableId: string,
    rootUuid: string
): PersistedTreeModel | null => {
    const condition = findConditionItem(hostTree, hostStableId, rootUuid);
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

const withoutDisplayIds = (node: PersistedNodeModel): unknown => {
    const { id: _id, children, conditions, ...rest } = node;
    return {
        ...rest,
        children: children?.map(withoutDisplayIds),
        conditions: conditions?.map((condition) => ({
            ...condition,
            root: withoutDisplayIds(condition.root),
        })),
    };
};

/**
 * What a condition file shows of its item that an outside change can touch: the condition tree,
 * its `custom` and the host overrides it writes back. Display ids are left out, since reordering
 * or editing elsewhere in the host renumbers them without changing the item.
 */
export const conditionItemSignature = (
    hostTree: PersistedTreeModel,
    hostStableId: string,
    rootUuid: string
): string | null => {
    const condition = findConditionItem(hostTree, hostStableId, rootUuid);
    return condition
        ? JSON.stringify({
              root: withoutDisplayIds(condition.root),
              custom: condition.custom ?? null,
              overrides: hostTree.overrides,
          })
        : null;
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
