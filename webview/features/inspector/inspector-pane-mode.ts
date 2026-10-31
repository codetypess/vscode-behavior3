import type { EditNode, NodeInstanceRef } from "../../shared/contracts";

export type InspectorPaneMode = "skeleton" | "tree" | "node" | "node-pending" | "condition";

export const getInspectorPaneMode = (params: {
    documentPresent: boolean;
    selectedNodeRef: NodeInstanceRef | null;
    selectedNode: EditNode | null;
    inspectorSurface?: "node" | "condition" | null;
}): InspectorPaneMode => {
    if (!params.documentPresent) {
        return "skeleton";
    }
    if (
        params.inspectorSurface === "condition" &&
        params.selectedNode?.data.conditions?.length
    ) {
        return "condition";
    }
    if (params.selectedNode) {
        return "node";
    }
    if (params.selectedNodeRef) {
        return "node-pending";
    }
    return "tree";
};
