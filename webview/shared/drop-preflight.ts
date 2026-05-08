import type { DropIntent, NodeInstanceRef } from "./contracts";

export type DropPreflightDenialReason =
    | "missing-context"
    | "same-node"
    | "move-subtree-denied"
    | "drop-subtree-internal-denied"
    | "move-root-denied"
    | "drop-around-root-denied"
    | "add-child-to-subtree-ref-denied"
    | "move-into-descendant-denied";

export type DropPreflightResult =
    | { allowed: true }
    | { allowed: false; reason: DropPreflightDenialReason };

export interface DropPreflightNode {
    ref: Pick<NodeInstanceRef, "instanceKey" | "sourceTreePath">;
    parentKey: string | null;
    subtreeNode: boolean;
}

export const preflightDropIntent = (params: {
    hasDocument: boolean;
    intent: Pick<DropIntent, "position">;
    source: DropPreflightNode | null;
    target: DropPreflightNode | null;
    isDescendant: (ancestorKey: string, targetKey: string) => boolean;
}): DropPreflightResult => {
    const { hasDocument, intent, source, target, isDescendant } = params;

    // This is a UI-side fast guard; the reducer repeats structural checks before persisting.
    if (!hasDocument || !source || !target) {
        return { allowed: false, reason: "missing-context" };
    }

    if (source.ref.instanceKey === target.ref.instanceKey) {
        return { allowed: false, reason: "same-node" };
    }

    if (source.subtreeNode) {
        return { allowed: false, reason: "move-subtree-denied" };
    }

    if (target.subtreeNode) {
        return { allowed: false, reason: "drop-subtree-internal-denied" };
    }

    if (source.parentKey === null) {
        return { allowed: false, reason: "move-root-denied" };
    }

    if ((intent.position === "before" || intent.position === "after") && target.parentKey === null) {
        return { allowed: false, reason: "drop-around-root-denied" };
    }

    if (
        intent.position === "child" &&
        target.ref.sourceTreePath !== null &&
        !target.subtreeNode
    ) {
        return { allowed: false, reason: "add-child-to-subtree-ref-denied" };
    }

    if (isDescendant(source.ref.instanceKey, target.ref.instanceKey)) {
        return { allowed: false, reason: "move-into-descendant-denied" };
    }

    return { allowed: true };
};
