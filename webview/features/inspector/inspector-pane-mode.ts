import type { EditNode, NodeInstanceRef } from "../../shared/contracts";

export type InspectorPaneMode = "skeleton" | "tree" | "node" | "node-pending";

export const getInspectorPaneMode = (params: {
    documentPresent: boolean;
    selectedNodeRef: NodeInstanceRef | null;
    selectedNode: EditNode | null;
}): InspectorPaneMode => {
    if (!params.documentPresent) {
        return "skeleton";
    }
    if (params.selectedNode) {
        return "node";
    }
    if (params.selectedNodeRef) {
        return "node-pending";
    }
    return "tree";
};
