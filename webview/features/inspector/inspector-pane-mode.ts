import type { EditNode, NodeInstanceRef } from "../../shared/contracts";

export type InspectorPaneMode = "skeleton" | "tree" | "node" | "node-pending" | "decorator";

export const getInspectorPaneMode = (params: {
    documentPresent: boolean;
    selectedNodeRef: NodeInstanceRef | null;
    selectedNode: EditNode | null;
    inspectorSurface?: "node" | "decorator" | null;
}): InspectorPaneMode => {
    if (!params.documentPresent) {
        return "skeleton";
    }
    if (
        params.inspectorSurface === "decorator" &&
        params.selectedNode?.data.decorator
    ) {
        return "decorator";
    }
    if (params.selectedNode) {
        return "node";
    }
    if (params.selectedNodeRef) {
        return "node-pending";
    }
    return "tree";
};
