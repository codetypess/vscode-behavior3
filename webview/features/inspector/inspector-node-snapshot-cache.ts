import type { EditNode, NodeInstanceRef } from "../../shared/contracts";

interface CachedInspectorNodeSnapshotEntry {
    ref: NodeInstanceRef;
    snapshot: EditNode;
}

const snapshotCache = new Map<string, CachedInspectorNodeSnapshotEntry>();

const isSameSubtreeStack = (left: readonly string[], right: readonly string[]) =>
    left.length === right.length && left.every((value, index) => value === right[index]);

export const isSameInspectorNodeIdentity = (left: NodeInstanceRef, right: NodeInstanceRef) =>
    left.structuralStableId === right.structuralStableId &&
    left.sourceStableId === right.sourceStableId &&
    left.sourceTreePath === right.sourceTreePath &&
    isSameSubtreeStack(left.subtreeStack, right.subtreeStack);

export const cloneInspectorNodeSnapshotForRef = (
    snapshot: EditNode,
    ref: NodeInstanceRef
): EditNode => ({
    ...snapshot,
    ref,
    effectiveArgs: snapshot.effectiveArgs ? { ...snapshot.effectiveArgs } : undefined,
    data: {
        ...snapshot.data,
        id: ref.displayId,
    },
});

export const resolveCachedInspectorNodeSnapshot = (
    entry: CachedInspectorNodeSnapshotEntry | null | undefined,
    ref: NodeInstanceRef | null | undefined
): EditNode | null => {
    if (!entry || !ref || !isSameInspectorNodeIdentity(entry.ref, ref)) {
        return null;
    }
    return cloneInspectorNodeSnapshotForRef(entry.snapshot, ref);
};

export const rememberInspectorNodeSnapshot = (
    filePath: string,
    ref: NodeInstanceRef,
    snapshot: EditNode
): void => {
    snapshotCache.set(filePath, {
        ref,
        snapshot: cloneInspectorNodeSnapshotForRef(snapshot, ref),
    });
};

export const getCachedInspectorNodeSnapshot = (
    filePath: string | null | undefined,
    ref: NodeInstanceRef | null | undefined
): EditNode | null => {
    if (!filePath) {
        return null;
    }
    return resolveCachedInspectorNodeSnapshot(snapshotCache.get(filePath), ref);
};
