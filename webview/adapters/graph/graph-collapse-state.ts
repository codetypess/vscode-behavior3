import type {
    GraphNodeVM,
    NodeInstanceRef,
    ResolvedGraphModel,
} from "../../shared/contracts";

const isSameSubtreeStack = (left: readonly string[], right: readonly string[]) =>
    left.length === right.length && left.every((value, index) => value === right[index]);

// The same source subtree can be mounted multiple times, so identity includes the mount stack.
export const isSameNodeIdentity = (left: NodeInstanceRef, right: NodeInstanceRef) =>
    left.structuralStableId === right.structuralStableId &&
    left.sourceStableId === right.sourceStableId &&
    left.sourceTreePath === right.sourceTreePath &&
    isSameSubtreeStack(left.subtreeStack, right.subtreeStack);

export const isCollapsedNodeRef = (
    collapsedNodeRefs: readonly NodeInstanceRef[],
    ref: NodeInstanceRef
) => collapsedNodeRefs.some((entry) => isSameNodeIdentity(entry, ref));

export const pruneCollapsedNodeRefs = (
    collapsedNodeRefs: readonly NodeInstanceRef[],
    model: ResolvedGraphModel | null
): NodeInstanceRef[] => {
    if (!model) {
        return [];
    }

    return collapsedNodeRefs.filter((ref) =>
        model.nodes.some((node) => isSameNodeIdentity(node.ref, ref))
    );
};

export const toggleCollapsedNodeRefs = (
    collapsedNodeRefs: readonly NodeInstanceRef[],
    ref: NodeInstanceRef
): NodeInstanceRef[] => {
    if (isCollapsedNodeRef(collapsedNodeRefs, ref)) {
        return collapsedNodeRefs.filter((entry) => !isSameNodeIdentity(entry, ref));
    }

    return [...collapsedNodeRefs, ref];
};

const getNodeByKey = (model: ResolvedGraphModel, nodeKey: string) =>
    model.nodes.find((node) => node.ref.instanceKey === nodeKey) ?? null;

const getAncestorNodeRefs = (
    model: ResolvedGraphModel,
    nodeKey: string
): NodeInstanceRef[] => {
    const ancestorRefs: NodeInstanceRef[] = [];
    let current = getNodeByKey(model, nodeKey);

    while (current?.parentKey) {
        const parent = getNodeByKey(model, current.parentKey);
        if (!parent) {
            break;
        }
        ancestorRefs.push(parent.ref);
        current = parent;
    }

    return ancestorRefs;
};

export const expandCollapsedAncestorsForNode = (
    collapsedNodeRefs: readonly NodeInstanceRef[],
    model: ResolvedGraphModel | null,
    nodeKey: string
): NodeInstanceRef[] => {
    if (!model || collapsedNodeRefs.length === 0) {
        return [...collapsedNodeRefs];
    }

    const ancestorRefs = getAncestorNodeRefs(model, nodeKey);
    if (ancestorRefs.length === 0) {
        return [...collapsedNodeRefs];
    }

    return collapsedNodeRefs.filter(
        (ref) => !ancestorRefs.some((ancestorRef) => isSameNodeIdentity(ref, ancestorRef))
    );
};

export const getVisibleChildKeys = (
    node: Pick<GraphNodeVM, "childKeys" | "ref">,
    collapsedNodeRefs: readonly NodeInstanceRef[]
) => (isCollapsedNodeRef(collapsedNodeRefs, node.ref) ? [] : node.childKeys);
