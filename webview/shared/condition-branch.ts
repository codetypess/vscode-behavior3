import { ABORT_MODES, DEFAULT_ABORT_MODE, type AbortMode, type ConditionData } from "./b3type";
import type { NodeDef, PersistedNodeModel, PersistedTreeModel } from "./contracts";
import { findNodeDef, createNodeDefMap } from "./node-utils";

export type ConditionBranchViolation = "nested-condition" | "running-status";

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

/**
 * A tree file's root cannot carry conditions. Any file may be used as a subtree, and a subtree
 * root's conditions belong to the reference that places it under a parent.
 */
export const isConditionOnRoot = (parent: { name: string } | null): boolean => !parent;

/**
 * Why `abort` cannot take effect under `parent`, or `null`. `lower` and `both` are checked by
 * the parent while a sibling on the right runs, so they need a parent declared `preemptive`.
 * The root has no parent; `isConditionOnRoot` covers it.
 */
export type AbortModeViolation = { code: "parent-not-preemptive"; parentName: string };

export const getAbortModeViolation = (
    abort: AbortMode,
    parent: { name: string; preemptive?: boolean } | null
): AbortModeViolation | null => {
    if ((abort !== "lower" && abort !== "both") || !parent || parent.preemptive) {
        return null;
    }
    return { code: "parent-not-preemptive", parentName: parent.name };
};

type AbortScopeNode = { parentKey: string | null; childKeys: string[]; disabled?: boolean };

/**
 * Keys of the nodes a condition on `nodeKey` can abort, for the selection hint: `self` covers the
 * node's subtree, `lower` the subtrees of its enabled right siblings, `both` the two. `null` when
 * the mode aborts nothing.
 */
export const getConditionAbortScope = (
    nodesByKey: ReadonlyMap<string, AbortScopeNode>,
    nodeKey: string,
    abort: AbortMode
): Set<string> | null => {
    if (abort === "none") {
        return null;
    }
    const scope = new Set<string>();
    const addSubtree = (key: string) => {
        const node = nodesByKey.get(key);
        if (!node || scope.has(key)) {
            return;
        }
        scope.add(key);
        node.childKeys.forEach(addSubtree);
    };
    if (abort === "self" || abort === "both") {
        addSubtree(nodeKey);
    }
    const parentKey = nodesByKey.get(nodeKey)?.parentKey;
    const siblings = parentKey ? (nodesByKey.get(parentKey)?.childKeys ?? []) : [];
    if (abort === "lower" || abort === "both") {
        for (const key of siblings.slice(siblings.indexOf(nodeKey) + 1)) {
            if (!nodesByKey.get(key)?.disabled) {
                addSubtree(key);
            }
        }
    }
    return scope;
};

/**
 * A subtree reference that sits inside another subtree: the instance's structural uuid is the
 * reference node, its source uuid the subtree root. Its conditions live in that outer subtree
 * file, so they are edited there, not from the main tree.
 */
export const isNestedSubtreeReference = (ref: {
    structuralStableId: string;
    sourceStableId: string;
    sourceTreePath: string | null;
    subtreeStack: readonly string[];
}): boolean =>
    Boolean(ref.sourceTreePath) &&
    ref.structuralStableId !== ref.sourceStableId &&
    ref.subtreeStack.length > 1;

export const isAbortMode = (value: unknown): value is AbortMode =>
    typeof value === "string" && (ABORT_MODES as readonly string[]).includes(value);

/** Lenient read for UI and clipboard input. Tree files go through the strict schema parser. */
export const readAbortMode = (value: unknown): AbortMode =>
    isAbortMode(value) ? value : DEFAULT_ABORT_MODE;

export const createConditionData = <TNode>(
    root: TNode,
    custom?: ConditionData<TNode>["custom"]
): ConditionData<TNode> =>
    custom ? { abort: DEFAULT_ABORT_MODE, custom, root } : { abort: DEFAULT_ABORT_MODE, root };

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
