import type { HostSelectionState, NodeInstanceRef } from "../../../webview/shared/contracts";
import { isJsonEqual } from "../../../webview/shared/json";
import { normalizeHostSelectionState } from "../../../webview/shared/protocol";

export const buildPendingSelectionRef = (structuralStableId: string): NodeInstanceRef => ({
    instanceKey: structuralStableId,
    displayId: "",
    structuralStableId,
    sourceStableId: structuralStableId,
    sourceTreePath: null,
    subtreeStack: [],
});

export type SharedSelectionApplyResult = "noop" | "changed" | "reasserted";

export const applySharedSelectionState = (
    currentSelection: HostSelectionState,
    nextSelection: HostSelectionState,
    opts?: { reassertIfEqual?: boolean }
): { selection: HostSelectionState; result: SharedSelectionApplyResult } => {
    const normalized = normalizeHostSelectionState(nextSelection);
    if (isJsonEqual(currentSelection, normalized)) {
        return {
            selection: currentSelection,
            result: opts?.reassertIfEqual ? "reasserted" : "noop",
        };
    }

    return {
        selection: normalized,
        result: "changed",
    };
};
