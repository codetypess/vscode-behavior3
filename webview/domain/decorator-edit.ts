import type {
    DecoratorEditSession,
    NodeDef,
    NodeInstanceRef,
    PersistedNodeModel,
    PersistedTreeModel,
    SubtreeSourceCacheEntry,
    UpdateNodeInput,
    WorkdirRelativeJsonPath,
} from "../shared/contracts";
import { DEFAULT_ABORT_TYPE } from "../shared/b3type";
import { findDecoratorBranchViolation } from "../shared/decorator-branch";
import {
    reduceDocumentMutation,
    type DocumentMutationReducerError,
    type ReducibleDocumentMutation,
} from "../shared/document";
import { clonePersistedNode, findPersistedNodeByStableId } from "../shared/tree";
import {
    materializePersistedTree,
    type MaterializedTreeNode,
} from "../shared/tree-materializer";

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

export const readHostDecoratorBranch = (params: {
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
    if (!host?.data.decorator) {
        return null;
    }
    return clonePersistedNode(host.data.decorator.root);
};

export const persistedTreeFromDecoratorBranch = (
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

export type DecoratorBranchProjection =
    | { kind: "forward" }
    | { kind: "noop" }
    | { kind: "error"; error: DocumentMutationReducerError }
    | { kind: "update"; update: UpdateNodeInput };

/** Apply a branch-local mutation, then describe the host `decorator` write. */
export const projectDecoratorBranchMutation = (params: {
    tree: PersistedTreeModel;
    subtreeSources: Record<WorkdirRelativeJsonPath, SubtreeSourceCacheEntry>;
    nodeDefs: NodeDef[];
    subtreeEditable: boolean;
    session: DecoratorEditSession;
    mutation: ReducibleDocumentMutation;
}): DecoratorBranchProjection => {
    if (
        params.mutation.type === "attachDecorator" ||
        params.mutation.type === "removeDecorator"
    ) {
        return { kind: "error", error: { code: "decorator-nested" } };
    }

    const stableIds = mutationStableIds(params.mutation);
    if (!stableIds) {
        return { kind: "forward" };
    }

    const branch = readHostDecoratorBranch({
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

    const synthetic = persistedTreeFromDecoratorBranch(branch, params.tree);
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

    const violation = findDecoratorBranchViolation(reduced.tree.root, params.nodeDefs);
    if (violation === "nested-decorator") {
        return { kind: "error", error: { code: "decorator-nested" } };
    }
    if (violation === "running-status") {
        return { kind: "error", error: { code: "decorator-running-status" } };
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
        update: buildHostDecoratorUpdate(host, params.session.hostRef, reduced.tree.root),
    };
};

const buildHostDecoratorUpdate = (
    host: MaterializedTreeNode,
    hostRef: NodeInstanceRef,
    decorator: PersistedNodeModel
): UpdateNodeInput => ({
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
        decorator: {
            enterPriority: host.data.decorator?.enterPriority ?? 0,
            maintainPriority: host.data.decorator?.maintainPriority ?? 0,
            abortType: host.data.decorator?.abortType ?? DEFAULT_ABORT_TYPE,
            root: clonePersistedNode(decorator),
        },
    },
    currentNodeSnapshot: {
        data: clonePersistedNode(host.data),
        subtreeNode: host.subtreeNode,
        subtreeOriginal: host.subtreeOriginal
            ? clonePersistedNode(host.subtreeOriginal)
            : undefined,
    },
});

export const buildDecoratorRestoreUpdate = (params: {
    tree: PersistedTreeModel;
    subtreeSources: Record<WorkdirRelativeJsonPath, SubtreeSourceCacheEntry>;
    nodeDefs: NodeDef[];
    subtreeEditable: boolean;
    session: DecoratorEditSession;
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
    return buildHostDecoratorUpdate(
        host,
        params.session.hostRef,
        params.session.entryDecorator
    );
};
