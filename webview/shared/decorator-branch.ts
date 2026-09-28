import { ABORT_TYPES, DEFAULT_ABORT_TYPE, type AbortType } from "./b3type";
import type { NodeDef, PersistedNodeModel, PersistedTreeModel } from "./contracts";
import { findNodeDef, createNodeDefMap } from "./node-utils";

export type DecoratorBranchViolation = "nested-decorator" | "running-status";

/** Tree custom key written while the tree uses an attached decorator. */
export const DECORATOR_TYPE_CUSTOM_KEY = "$decorator_type";
export const DECORATOR_TYPE_VALUES = ["local", "global"] as const;
export type DecoratorType = (typeof DECORATOR_TYPE_VALUES)[number];
export const DEFAULT_DECORATOR_TYPE: DecoratorType = "local";

type DecoratorPresenceNode = {
    decorator?: unknown;
    children?: DecoratorPresenceNode[];
};

const nodeHasAttachedDecorator = (node: DecoratorPresenceNode): boolean => {
    if (node.decorator) {
        return true;
    }
    for (const child of node.children ?? []) {
        if (nodeHasAttachedDecorator(child)) {
            return true;
        }
    }
    return false;
};

/** True when this persisted tree has an attached decorator on a node or an override. */
export const treeUsesAttachedDecorator = (tree: {
    root: DecoratorPresenceNode;
    overrides?: Record<string, { decorator?: unknown } | undefined>;
}): boolean => {
    if (nodeHasAttachedDecorator(tree.root)) {
        return true;
    }
    return Object.values(tree.overrides ?? {}).some((entry) => Boolean(entry?.decorator));
};

export const readDecoratorType = (value: unknown): DecoratorType | undefined =>
    value === "local" || value === "global" ? value : undefined;

/** Keep `$decorator_type` at `local` or `global` while the tree uses a decorator. */
export const ensureDecoratorTypeCustom = (tree: {
    root: DecoratorPresenceNode;
    custom: Record<string, string | number | boolean | object>;
    overrides?: Record<string, { decorator?: unknown } | undefined>;
}): boolean => {
    if (!treeUsesAttachedDecorator(tree)) {
        return false;
    }
    if (readDecoratorType(tree.custom[DECORATOR_TYPE_CUSTOM_KEY])) {
        return false;
    }
    tree.custom = {
        ...tree.custom,
        [DECORATOR_TYPE_CUSTOM_KEY]: DEFAULT_DECORATOR_TYPE,
    };
    return true;
};

/** Integer value of a node display id. Non-integer ids count as 0. */
export const nodeIdToPriority = (id: string | undefined): number => {
    if (!id || !/^-?\d+$/.test(id)) {
        return 0;
    }
    const value = Number(id);
    return Number.isSafeInteger(value) ? value : 0;
};

export const readDecoratorInt = (value: unknown): number | undefined => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return undefined;
    }
    return Math.trunc(value);
};

export const readAbortType = (value: unknown): AbortType =>
    typeof value === "string" && (ABORT_TYPES as readonly string[]).includes(value)
        ? (value as AbortType)
        : DEFAULT_ABORT_TYPE;

/**
 * Move priorities onto a new node id.
 * A maintain priority that still matches the previous enter priority follows the new id.
 * A lower maintain priority stays, clamped to 0 through the new enter priority.
 */
export const refreshDecoratorPriorities = (
    previousEnter: number,
    previousMaintain: number,
    nextNodeId: string | undefined
): { enterPriority: number; maintainPriority: number } => {
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
export const normalizeDecoratorPriorities = (
    nodeId: string | undefined,
    maintainPriority: unknown
): { enterPriority: number; maintainPriority: number } => {
    const enterPriority = nodeIdToPriority(nodeId);
    const maintain = readDecoratorInt(maintainPriority) ?? enterPriority;
    const upper = Math.max(0, enterPriority);
    return {
        enterPriority,
        maintainPriority: Math.min(upper, Math.max(0, maintain)),
    };
};

export class DecoratorBranchSaveError extends Error {
    readonly violation: DecoratorBranchViolation;

    constructor(violation: DecoratorBranchViolation) {
        super(violation);
        this.name = "DecoratorBranchSaveError";
        this.violation = violation;
    }
}

/**
 * True when the node definition itself returns running.
 * `|running` only copies a child's running status and is allowed.
 */
export const nodeDefReturnsRunning = (
    nodeDef: Pick<NodeDef, "status"> | null | undefined
): boolean => nodeDef?.status?.some((status) => status === "running") ?? false;

const violationFromBranch = (
    branch: PersistedNodeModel,
    defsByName: ReturnType<typeof createNodeDefMap>
): DecoratorBranchViolation | null => {
    const visit = (node: PersistedNodeModel): DecoratorBranchViolation | null => {
        if (nodeDefReturnsRunning(findNodeDef(defsByName, node.name))) {
            return "running-status";
        }
        if (node.decorator) {
            return "nested-decorator";
        }
        for (const child of node.children ?? []) {
            const childViolation = visit(child);
            if (childViolation) {
                return childViolation;
            }
        }
        return null;
    };

    return visit(branch);
};

/** The branch root is allowed. A `decorator` field on any node inside it is nested. */
export const findDecoratorBranchViolation = (
    branch: PersistedNodeModel,
    nodeDefs: readonly NodeDef[]
): DecoratorBranchViolation | null => violationFromBranch(branch, createNodeDefMap(nodeDefs));

/** Outermost decorator branch that contains this stable id, including the branch root. */
export const findEnclosingDecoratorBranch = (
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
        if (branch.decorator && branchContains(branch.decorator.root)) {
            return true;
        }
        return false;
    };

    const visitHost = (node: PersistedNodeModel) => {
        if (found) {
            return;
        }
        if (node.decorator && branchContains(node.decorator.root)) {
            found = node.decorator.root;
            return;
        }
        for (const child of node.children ?? []) {
            visitHost(child);
        }
    };

    visitHost(root);
    return found;
};

export const findTreeDecoratorBranchViolation = (
    tree: PersistedTreeModel,
    nodeDefs: readonly NodeDef[]
): DecoratorBranchViolation | null => {
    const defsByName = createNodeDefMap(nodeDefs);
    let violation: DecoratorBranchViolation | null = null;

    const visitHost = (node: PersistedNodeModel) => {
        if (violation) {
            return;
        }
        if (node.decorator) {
            violation = violationFromBranch(node.decorator.root, defsByName);
            if (violation) {
                return;
            }
        }
        for (const child of node.children ?? []) {
            visitHost(child);
        }
    };

    visitHost(tree.root);
    if (violation) {
        return violation;
    }

    for (const patch of Object.values(tree.overrides)) {
        if (!patch.decorator) {
            continue;
        }
        violation = violationFromBranch(patch.decorator.root, defsByName);
        if (violation) {
            return violation;
        }
    }

    return null;
};

export const assertDecoratorBranchesSavable = (
    tree: PersistedTreeModel,
    nodeDefs: readonly NodeDef[]
): void => {
    const violation = findTreeDecoratorBranchViolation(tree, nodeDefs);
    if (violation) {
        throw new DecoratorBranchSaveError(violation);
    }
};
