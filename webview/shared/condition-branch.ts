import {
    ABORT_MODES,
    DEFAULT_ABORT_MODE,
    type AbortMode,
    type ConditionCustom,
    type ConditionData,
} from "./b3type";
import type { NodeDef, PersistedNodeModel, PersistedTreeModel } from "./contracts";
import { findNodeDef, createNodeDefMap } from "./node-utils";

export type ConditionBranchViolation = "nested-condition" | "running-status";

/** Tree custom key written while the tree uses a condition. */
export const CONDITION_TYPE_CUSTOM_KEY = "$condition_type";
export const CONDITION_TYPE_VALUES = ["local", "global"] as const;
export type ConditionType = (typeof CONDITION_TYPE_VALUES)[number];
export const DEFAULT_CONDITION_TYPE: ConditionType = "local";

/** Condition item custom keys owned by the editor. */
export const CONDITION_ENTER_PRIORITY_KEY = "enterPriority";
export const CONDITION_MAINTAIN_PRIORITY_KEY = "maintainPriority";
export const CONDITION_RESERVED_CUSTOM_KEYS = [
    CONDITION_ENTER_PRIORITY_KEY,
    CONDITION_MAINTAIN_PRIORITY_KEY,
] as const;

type ConditionPresenceNode = {
    conditions?: unknown[];
    children?: ConditionPresenceNode[];
};

const nodeHasConditions = (node: ConditionPresenceNode): boolean => {
    if (node.conditions?.length) {
        return true;
    }
    for (const child of node.children ?? []) {
        if (nodeHasConditions(child)) {
            return true;
        }
    }
    return false;
};

/** True when this persisted tree has a condition on a node or an override. */
export const treeUsesConditions = (tree: {
    root: ConditionPresenceNode;
    overrides?: Record<string, { conditions?: unknown[] } | undefined>;
}): boolean => {
    if (nodeHasConditions(tree.root)) {
        return true;
    }
    return Object.values(tree.overrides ?? {}).some((entry) => Boolean(entry?.conditions?.length));
};

export const readConditionType = (value: unknown): ConditionType | undefined =>
    value === "local" || value === "global" ? value : undefined;

/** Keep `$condition_type` at `local` or `global` while the tree uses a condition. */
export const ensureConditionTypeCustom = (tree: {
    root: ConditionPresenceNode;
    custom: Record<string, string | number | boolean | object>;
    overrides?: Record<string, { conditions?: unknown[] } | undefined>;
}): boolean => {
    if (!treeUsesConditions(tree)) {
        return false;
    }
    if (readConditionType(tree.custom[CONDITION_TYPE_CUSTOM_KEY])) {
        return false;
    }
    tree.custom = {
        ...tree.custom,
        [CONDITION_TYPE_CUSTOM_KEY]: DEFAULT_CONDITION_TYPE,
    };
    return true;
};

export const isAbortMode = (value: unknown): value is AbortMode =>
    typeof value === "string" && (ABORT_MODES as readonly string[]).includes(value);

/** Lenient read for UI and clipboard input. Tree files go through the strict schema parser. */
export const readAbortMode = (value: unknown): AbortMode =>
    isAbortMode(value) ? value : DEFAULT_ABORT_MODE;

/** Integer value of a node display id. Non-integer ids count as 0. */
export const nodeIdToPriority = (id: string | undefined): number => {
    if (!id || !/^-?\d+$/.test(id)) {
        return 0;
    }
    const value = Number(id);
    return Number.isSafeInteger(value) ? value : 0;
};

export const readConditionInt = (value: unknown): number | undefined => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return undefined;
    }
    return Math.trunc(value);
};

export interface ConditionPriorities {
    enterPriority: number;
    maintainPriority: number;
}

/**
 * Move priorities onto a new node id.
 * A maintain priority that still matches the previous enter priority follows the new id.
 * A lower maintain priority stays, clamped to 0 through the new enter priority.
 */
export const refreshConditionPriorities = (
    previousEnter: number,
    previousMaintain: number,
    nextNodeId: string | undefined
): ConditionPriorities => {
    const enterPriority = nodeIdToPriority(nextNodeId);
    const upper = Math.max(0, enterPriority);
    const tracking = Math.trunc(previousMaintain) === Math.trunc(previousEnter);
    const maintain = tracking ? enterPriority : Math.trunc(previousMaintain);
    return {
        enterPriority,
        maintainPriority: Math.min(upper, Math.max(0, maintain)),
    };
};

/** Enter priority follows the node id. Maintain priority stays within 0 and that value. */
export const normalizeConditionPriorities = (
    nodeId: string | undefined,
    maintainPriority: unknown
): ConditionPriorities => {
    const enterPriority = nodeIdToPriority(nodeId);
    const maintain = readConditionInt(maintainPriority) ?? enterPriority;
    const upper = Math.max(0, enterPriority);
    return {
        enterPriority,
        maintainPriority: Math.min(upper, Math.max(0, maintain)),
    };
};

export const readConditionPriorities = (
    condition: Pick<ConditionData<unknown>, "custom">
): ConditionPriorities => {
    const enterPriority = readConditionInt(condition.custom?.[CONDITION_ENTER_PRIORITY_KEY]) ?? 0;
    return {
        enterPriority,
        maintainPriority:
            readConditionInt(condition.custom?.[CONDITION_MAINTAIN_PRIORITY_KEY]) ?? enterPriority,
    };
};

export const withConditionPriorities = (
    custom: ConditionCustom | undefined,
    priorities: ConditionPriorities
): ConditionCustom => ({
    ...(custom ?? {}),
    [CONDITION_ENTER_PRIORITY_KEY]: priorities.enterPriority,
    [CONDITION_MAINTAIN_PRIORITY_KEY]: priorities.maintainPriority,
});

/** Re-derive the priorities of every condition item from the host node's (new) id. */
export const syncConditionPriorities = (
    node: { id: string; conditions?: ConditionData<unknown>[] },
    nodeId: string = node.id
): void => {
    for (const condition of node.conditions ?? []) {
        const previous = readConditionPriorities(condition);
        condition.custom = withConditionPriorities(
            condition.custom,
            refreshConditionPriorities(previous.enterPriority, previous.maintainPriority, nodeId)
        );
    }
};

export const createConditionData = <TNode>(
    hostId: string | undefined,
    root: TNode
): ConditionData<TNode> => ({
    abort: DEFAULT_ABORT_MODE,
    custom: withConditionPriorities(undefined, normalizeConditionPriorities(hostId, undefined)),
    root,
});

export class ConditionBranchSaveError extends Error {
    readonly violation: ConditionBranchViolation;

    constructor(violation: ConditionBranchViolation) {
        super(violation);
        this.name = "ConditionBranchSaveError";
        this.violation = violation;
    }
}

/**
 * True when the node definition itself returns running.
 * `|running` only copies a child's running status.
 */
export const nodeDefReturnsRunning = (
    nodeDef: Pick<NodeDef, "status"> | null | undefined
): boolean => nodeDef?.status?.some((status) => status === "running") ?? false;

/**
 * Static check from behavior3 2.0: `running` returns running by itself, `|running` returns it
 * when an enabled child can. Nodes without `status` are not rejected here.
 */
const nodeCanReturnRunning = (
    node: PersistedNodeModel,
    defsByName: ReturnType<typeof createNodeDefMap>
): boolean => {
    const status = findNodeDef(defsByName, node.name)?.status;
    if (!status) {
        return false;
    }
    if (status.includes("running")) {
        return true;
    }
    if (status.includes("|running")) {
        return (node.children ?? []).some(
            (child) => !child.disabled && nodeCanReturnRunning(child, defsByName)
        );
    }
    return false;
};

const violationFromBranch = (
    branch: PersistedNodeModel,
    defsByName: ReturnType<typeof createNodeDefMap>
): ConditionBranchViolation | null => {
    const hasNested = (node: PersistedNodeModel): boolean =>
        Boolean(node.conditions?.length) || (node.children ?? []).some(hasNested);

    if (hasNested(branch)) {
        return "nested-condition";
    }
    if (!branch.disabled && nodeCanReturnRunning(branch, defsByName)) {
        return "running-status";
    }
    return null;
};

/** The branch root is allowed. A `conditions` field on any node inside it is nested. */
export const findConditionBranchViolation = (
    branch: PersistedNodeModel,
    nodeDefs: readonly NodeDef[]
): ConditionBranchViolation | null => violationFromBranch(branch, createNodeDefMap(nodeDefs));

/** Outermost condition tree that contains this stable id, including the condition root. */
export const findEnclosingConditionBranch = (
    root: PersistedNodeModel,
    stableId: string
): PersistedNodeModel | null => {
    let found: PersistedNodeModel | null = null;

    const branchContains = (branch: PersistedNodeModel): boolean => {
        if (branch.uuid === stableId) {
            return true;
        }
        for (const child of branch.children ?? []) {
            if (branchContains(child)) {
                return true;
            }
        }
        return (branch.conditions ?? []).some((condition) => branchContains(condition.root));
    };

    const visitHost = (node: PersistedNodeModel) => {
        if (found) {
            return;
        }
        for (const condition of node.conditions ?? []) {
            if (branchContains(condition.root)) {
                found = condition.root;
                return;
            }
        }
        for (const child of node.children ?? []) {
            visitHost(child);
        }
    };

    visitHost(root);
    return found;
};

export const findTreeConditionBranchViolation = (
    tree: PersistedTreeModel,
    nodeDefs: readonly NodeDef[]
): ConditionBranchViolation | null => {
    const defsByName = createNodeDefMap(nodeDefs);
    let violation: ConditionBranchViolation | null = null;

    const visitConditions = (conditions: PersistedNodeModel["conditions"]) => {
        for (const condition of conditions ?? []) {
            violation ??= violationFromBranch(condition.root, defsByName);
        }
    };

    const visitHost = (node: PersistedNodeModel) => {
        if (violation) {
            return;
        }
        visitConditions(node.conditions);
        for (const child of node.children ?? []) {
            visitHost(child);
        }
    };

    visitHost(tree.root);
    for (const patch of Object.values(tree.overrides)) {
        visitConditions(patch.conditions);
    }

    return violation;
};

export const assertConditionBranchesSavable = (
    tree: PersistedTreeModel,
    nodeDefs: readonly NodeDef[]
): void => {
    const violation = findTreeConditionBranchViolation(tree, nodeDefs);
    if (violation) {
        throw new ConditionBranchSaveError(violation);
    }
};
