import type {
    ConditionEditSession,
    NodeDef,
    NodeInstanceRef,
    PersistedNodeModel,
    PersistedTreeModel,
    SubtreeSourceCacheEntry,
    UpdateNodeInput,
    WorkdirRelativeJsonPath,
} from "../shared/contracts";
import { createConditionData, findConditionBranchViolation } from "../shared/condition-branch";
import {
    reduceDocumentMutation,
    type DocumentMutationReducerError,
    type ReducibleDocumentMutation,
} from "../shared/document";
import { clonePersistedNode, findPersistedNodeByStableId } from "../shared/tree";
import { materializePersistedTree, type MaterializedTreeNode } from "../shared/tree-materializer";

const findMaterializedHost = (
    node: MaterializedTreeNode,
    hostRef: NodeInstanceRef
): MaterializedTreeNode | null => {
    if (
        node.structuralStableId === hostRef.structuralStableId &&
        node.sourceStableId === hostRef.sourceStableId
    ) {
        return node;
    }
    for (const child of node.children) {
        const found = findMaterializedHost(child, hostRef);
        if (found) {
            return found;
        }
    }
    return null;
};

export const readHostConditionBranch = (params: {
    tree: PersistedTreeModel;
    subtreeSources: Record<WorkdirRelativeJsonPath, SubtreeSourceCacheEntry>;
    nodeDefs: NodeDef[];
    subtreeEditable: boolean;
    hostRef: NodeInstanceRef;
}): PersistedNodeModel | null => {
    const root = materializePersistedTree({
        persistedTree: params.tree,
        subtreeSources: params.subtreeSources,
        nodeDefs: params.nodeDefs,
        subtreeEditable: params.subtreeEditable,
    });
    const host = findMaterializedHost(root, params.hostRef);
    const condition = host?.data.conditions?.[0];
    if (!condition) {
        return null;
    }
    return clonePersistedNode(condition.root);
};

export const persistedTreeFromConditionBranch = (
    branch: PersistedNodeModel,
    template: PersistedTreeModel
): PersistedTreeModel => ({
    version: template.version,
    name: template.name,
    prefix: template.prefix,
    desc: template.desc,
    export: template.export,
    group: [],
    variables: { imports: [], locals: [] },
    custom: {},
    root: clonePersistedNode(branch),
    overrides: {},
});

const mutationStableIds = (mutation: ReducibleDocumentMutation): string[] | null => {
    switch (mutation.type) {
        case "updateTreeMeta":
            return null;
        case "performDrop":
            return [
                mutation.payload.source.structuralStableId,
                mutation.payload.target.structuralStableId,
            ];
        default:
            return [mutation.payload.target.structuralStableId];
    }
};

export type ConditionBranchProjection =
    | { kind: "forward" }
    | { kind: "noop" }
    | { kind: "error"; error: DocumentMutationReducerError }
    | { kind: "update"; update: UpdateNodeInput };

/** Apply a branch-local mutation, then describe the host `condition` write. */
export const projectConditionBranchMutation = (params: {
    tree: PersistedTreeModel;
    subtreeSources: Record<WorkdirRelativeJsonPath, SubtreeSourceCacheEntry>;
    nodeDefs: NodeDef[];
    subtreeEditable: boolean;
    session: ConditionEditSession;
    mutation: ReducibleDocumentMutation;
}): ConditionBranchProjection => {
    if (params.mutation.type === "attachCondition" || params.mutation.type === "removeCondition") {
        return { kind: "error", error: { code: "condition-nested" } };
    }

    const stableIds = mutationStableIds(params.mutation);
    if (!stableIds) {
        return { kind: "forward" };
    }

    const branch = readHostConditionBranch({
        tree: params.tree,
        subtreeSources: params.subtreeSources,
        nodeDefs: params.nodeDefs,
        subtreeEditable: params.subtreeEditable,
        hostRef: params.session.hostRef,
    });
    if (!branch) {
        return { kind: "error", error: { code: "missing-target-node" } };
    }

    const inBranch = stableIds.every((stableId) => findPersistedNodeByStableId(branch, stableId));
    if (!inBranch) {
        return { kind: "forward" };
    }

    const synthetic = persistedTreeFromConditionBranch(branch, params.tree);
    const reduced = reduceDocumentMutation(params.mutation, {
        tree: synthetic,
        nodeDefs: params.nodeDefs,
    });
    if (reduced.status === "error") {
        return { kind: "error", error: reduced.error };
    }
    if (reduced.status === "noop") {
        return { kind: "noop" };
    }

    const violation = findConditionBranchViolation(reduced.tree.root, params.nodeDefs);
    if (violation === "nested-condition") {
        return { kind: "error", error: { code: "condition-nested" } };
    }
    if (violation === "running-status") {
        return { kind: "error", error: { code: "condition-running-status" } };
    }

    const materialized = materializePersistedTree({
        persistedTree: params.tree,
        subtreeSources: params.subtreeSources,
        nodeDefs: params.nodeDefs,
        subtreeEditable: params.subtreeEditable,
    });
    const host = findMaterializedHost(materialized, params.session.hostRef);
    if (!host) {
        return { kind: "error", error: { code: "missing-target-node" } };
    }

    return {
        kind: "update",
        update: buildHostConditionUpdate(host, params.session.hostRef, reduced.tree.root),
    };
};

/** Write `root` back as the root of the host's first condition; other items are kept. */
const buildHostConditionUpdate = (
    host: MaterializedTreeNode,
    hostRef: NodeInstanceRef,
    root: PersistedNodeModel
): UpdateNodeInput => {
    const [first, ...rest] = host.data.conditions ?? [];
    const nextFirst = first
        ? { ...first, custom: first.custom ? { ...first.custom } : undefined }
        : createConditionData(hostRef.displayId || host.data.id, root);
    return {
        target: hostRef,
        data: {
            name: host.data.name,
            desc: host.data.desc,
            args: host.data.args,
            input: host.data.input,
            output: host.data.output,
            debug: host.data.debug,
            disabled: host.data.disabled,
            path: host.data.path,
            conditions: [{ ...nextFirst, root: clonePersistedNode(root) }, ...rest],
        },
        currentNodeSnapshot: {
            data: clonePersistedNode(host.data),
            subtreeNode: host.subtreeNode,
            subtreeOriginal: host.subtreeOriginal
                ? clonePersistedNode(host.subtreeOriginal)
                : undefined,
        },
    };
};

export const buildConditionRestoreUpdate = (params: {
    tree: PersistedTreeModel;
    subtreeSources: Record<WorkdirRelativeJsonPath, SubtreeSourceCacheEntry>;
    nodeDefs: NodeDef[];
    subtreeEditable: boolean;
    session: ConditionEditSession;
}): UpdateNodeInput | null => {
    const materialized = materializePersistedTree({
        persistedTree: params.tree,
        subtreeSources: params.subtreeSources,
        nodeDefs: params.nodeDefs,
        subtreeEditable: params.subtreeEditable,
    });
    const host = findMaterializedHost(materialized, params.session.hostRef);
    if (!host) {
        return null;
    }
    return buildHostConditionUpdate(host, params.session.hostRef, params.session.entryCondition);
};
