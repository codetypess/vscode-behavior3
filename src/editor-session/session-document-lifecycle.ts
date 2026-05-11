import * as vscode from "vscode";
import { getBehavior3OutputChannel } from "../output-channel";
import { readFileContentFromDisk } from "./document/document-sync";
import type { FileVersionGuard } from "./document/file-version-guard";
import type { SessionInspectorSync } from "./session-inspector-sync";
import type { HostMessageSink, TreeEditorSessionContext } from "./session-context";
import type { SessionSubtreeTracking } from "./session-subtree-tracking";
import type { EditorToHostMessage, HostToEditorMessage } from "../../webview/shared/message-protocol";

export interface SessionDocumentLifecycle {
    handleSaveDocumentMessage(
        msg: Extract<EditorToHostMessage, { type: "saveDocument" }>,
        reply?: HostMessageSink
    ): Promise<void>;
    handleHistoryNavigationMessage(direction: "undo" | "redo"): Promise<void>;
    handleRevertDocumentMessage(
        msg: Extract<EditorToHostMessage, { type: "revertDocument" }>,
        reply?: HostMessageSink
    ): Promise<void>;
    handleMainDocumentFileChange(): Promise<void>;
}

export function createSessionDocumentLifecycle(
    context: TreeEditorSessionContext,
    inspectorSync: SessionInspectorSync,
    subtreeTracking: SessionSubtreeTracking,
    fileVersionGuard: FileVersionGuard
): SessionDocumentLifecycle {
    const {
        document,
        revertDocument,
        onDidChangeDocument,
        state,
        documentSession,
        postMessage,
        buildDocumentSessionMessage,
        enqueueMainDocumentOperation,
    } = context;
    const { fanoutDocumentSnapshot } = inspectorSync;
    const { invalidateSubtreeRefs, refreshTrackedSubtreeRefs } = subtreeTracking;
    const { updateFileVersionState, blockEditingForNewerFile } = fileVersionGuard;

    const applySessionHistorySnapshot = async (snapshot: string): Promise<boolean> => {
        const sessionSnapshot = buildDocumentSessionMessage();
        const changed = document.syncContentState(snapshot, sessionSnapshot.dirty);
        if (!changed) {
            return false;
        }

        state.inspectorContentSyncKind = "update";
        invalidateSubtreeRefs();
        void refreshTrackedSubtreeRefs();
        updateFileVersionState(snapshot);
        onDidChangeDocument(document);
        await fanoutDocumentSnapshot({
            syncKind: "update",
        });
        return true;
    };

    /**
     * Save requests reuse the serialized main-document queue so an external file
     * change cannot interleave between "apply webview content" and the VS Code
     * custom-editor save lifecycle.
     */
    const handleSaveDocumentMessage = async (
        msg: Extract<EditorToHostMessage, { type: "saveDocument" }>,
        reply: HostMessageSink = postMessage
    ): Promise<void> => {
        await enqueueMainDocumentOperation(async () => {
            const editBlockedMessage = blockEditingForNewerFile();
            if (editBlockedMessage) {
                await reply({
                    type: "saveDocumentResult",
                    requestId: msg.requestId,
                    success: false,
                    error: editBlockedMessage,
                } satisfies HostToEditorMessage);
                return;
            }

            try {
                if (document.isDirty) {
                    await vscode.workspace.save(document.uri);
                }
                const success = !document.isDirty;
                if (!success) {
                    getBehavior3OutputChannel().warn(
                        `[saveDocument] save failed for ${document.uri.fsPath}; isDirty=${document.isDirty}`
                    );
                }
                await reply({
                    type: "saveDocumentResult",
                    requestId: msg.requestId,
                    success,
                    error: success ? undefined : "Failed to save document",
                } satisfies HostToEditorMessage);

                if (success) {
                    state.inspectorContentSyncKind = "reload";
                }
            } catch (error) {
                getBehavior3OutputChannel().error(
                    `[saveDocument] exception for ${document.uri.fsPath}: ${String(error)}`
                );
                await reply({
                    type: "saveDocumentResult",
                    requestId: msg.requestId,
                    success: false,
                    error: String(error),
                } satisfies HostToEditorMessage);
            }
        });
    };

    const handleHistoryNavigationMessage = async (
        direction: "undo" | "redo"
    ): Promise<void> => {
        await enqueueMainDocumentOperation(async () => {
            const editBlockedMessage = blockEditingForNewerFile();
            if (editBlockedMessage) {
                return;
            }

            const snapshot = direction === "undo" ? documentSession.undo() : documentSession.redo();
            if (!snapshot) {
                return;
            }

            await applySessionHistorySnapshot(snapshot);
        });
    };

    const handleRevertDocumentMessage = async (
        msg: Extract<EditorToHostMessage, { type: "revertDocument" }>,
        reply: HostMessageSink = postMessage
    ): Promise<void> => {
        await enqueueMainDocumentOperation(async () => {
            const cancellation = new vscode.CancellationTokenSource();
            try {
                await revertDocument(document, cancellation.token);
                state.inspectorContentSyncKind = "reload";
                await reply({
                    type: "revertDocumentResult",
                    requestId: msg.requestId,
                    success: true,
                } satisfies HostToEditorMessage);
            } catch (error) {
                await reply({
                    type: "revertDocumentResult",
                    requestId: msg.requestId,
                    success: false,
                    error: String(error),
                } satisfies HostToEditorMessage);
            } finally {
                cancellation.dispose();
            }
        });
    };

    const handleMainDocumentFileChange = async (): Promise<void> => {
        await enqueueMainDocumentOperation(async () => {
            // Watcher events race with our own writes and external edits; consume them under the same queue.
            let content: string;
            try {
                content = await readFileContentFromDisk(document.uri);
            } catch {
                return;
            }

            invalidateSubtreeRefs();

            if (document.consumeOwnWrite(content)) {
                return;
            }

            if (document.content === content) {
                return;
            }

            /**
             * Clean external reloads apply silently when the webview has no
             * unsaved edits; otherwise we surface a conflict payload and let the
             * webview decide when/how to merge or reload.
             */
            if (!document.isDirty) {
                document.updateContent(content, { markSaved: true, markDirty: false });
                documentSession.replaceFromDisk(content);
                state.inspectorContentSyncKind = "reload";
                void refreshTrackedSubtreeRefs();
                updateFileVersionState(content, { showWarning: true });
                await fanoutDocumentSnapshot({
                    syncKind: "reload",
                });
                return;
            }

            documentSession.showReloadConflict(content);
            await fanoutDocumentSnapshot({
                syncKind: "update",
                refreshVars: false,
            });
        });
    };

    return {
        handleSaveDocumentMessage,
        handleHistoryNavigationMessage,
        handleRevertDocumentMessage,
        handleMainDocumentFileChange,
    };
}
