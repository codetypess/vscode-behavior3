import type { HostSelectionState } from "../../../webview/shared/contracts";
import type { EditorToHostMessage } from "../../../webview/shared/message-protocol";
import { normalizeNodeInstanceRef } from "../../../webview/shared/protocol";
import {
    applySharedSelectionState,
    type SharedSelectionApplyResult,
} from "./selection-state";
import type { SessionInspectorSync } from "./inspector-sync";
import type { TreeEditorSessionContext } from "./context";

export interface SessionSelectionSync {
    updateSharedSelection(
        selection: HostSelectionState,
        opts?: { reassertIfEqual?: boolean }
    ): SharedSelectionApplyResult;
    handleSelectTreeMessage(): Promise<void>;
    handleSelectNodeMessage(
        msg: Extract<EditorToHostMessage, { type: "selectNode" }>
    ): Promise<void>;
}

export function createSessionSelectionSync(
    context: TreeEditorSessionContext,
    inspectorSync: SessionInspectorSync
): SessionSelectionSync {
    const { state, enqueueMainDocumentOperation } = context;
    const { fanoutDocumentSnapshot, notifyInspectorSessionUpdate } = inspectorSync;

    const updateSharedSelection = (
        selection: HostSelectionState,
        opts?: { reassertIfEqual?: boolean }
    ): SharedSelectionApplyResult => {
        const applied = applySharedSelectionState(state.sharedSelection, selection, opts);
        if (applied.result === "noop") {
            return "noop";
        }

        state.sharedSelection = applied.selection;
        // External inspector UI uses this as an event revision, not as document content versioning.
        state.selectionRevision += 1;
        return applied.result;
    };

    const handleSelectTreeMessage = async (): Promise<void> => {
        await enqueueMainDocumentOperation(async () => {
            const result = updateSharedSelection(
                { kind: "tree" },
                { reassertIfEqual: true }
            );
            if (result === "noop") {
                return;
            }
            if (result === "reasserted") {
                notifyInspectorSessionUpdate();
                return;
            }
            await fanoutDocumentSnapshot({
                refreshVars: false,
            });
        });
    };

    const handleSelectNodeMessage = async (
        msg: Extract<EditorToHostMessage, { type: "selectNode" }>
    ): Promise<void> => {
        await enqueueMainDocumentOperation(async () => {
            const result = updateSharedSelection(
                {
                    kind: "node",
                    ref: normalizeNodeInstanceRef(msg.target),
                },
                { reassertIfEqual: true }
            );
            if (result === "noop") {
                return;
            }
            if (result === "reasserted") {
                notifyInspectorSessionUpdate();
                return;
            }
            await fanoutDocumentSnapshot({
                refreshVars: false,
            });
        });
    };

    return {
        updateSharedSelection,
        handleSelectTreeMessage,
        handleSelectNodeMessage,
    };
}
