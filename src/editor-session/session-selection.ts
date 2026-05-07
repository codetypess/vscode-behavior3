import type { NodeInstanceRef } from "../../webview/shared/contracts";

export const buildPendingSelectionRef = (structuralStableId: string): NodeInstanceRef => ({
    instanceKey: structuralStableId,
    displayId: "",
    structuralStableId,
    sourceStableId: structuralStableId,
    sourceTreePath: null,
    subtreeStack: [],
});
