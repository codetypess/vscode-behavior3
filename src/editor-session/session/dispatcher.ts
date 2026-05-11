import * as vscode from "vscode";
import type { EditorToHostMessage } from "../../../webview/shared/message-protocol";
import {
    logAsyncRuntimeError,
    writeWebviewLogMessage,
} from "../runtime/logging";
import type { HostMessageSink, MessageSource } from "./context";

interface SessionDispatcherFileRequestHandlers {
    handleReadFileMessage(
        msg: Extract<EditorToHostMessage, { type: "readFile" }>,
        reply: HostMessageSink
    ): Promise<void>;
    handleSaveSubtreeMessage(
        msg: Extract<EditorToHostMessage, { type: "saveSubtree" }>,
        reply: HostMessageSink
    ): Promise<void>;
    handleSaveSubtreeAsMessage(
        msg: Extract<EditorToHostMessage, { type: "saveSubtreeAs" }>,
        reply: HostMessageSink
    ): Promise<void>;
}

export interface SessionDispatcher {
    dispatchEditorMessage(
        msg: EditorToHostMessage,
        reply?: HostMessageSink,
        source?: MessageSource
    ): Promise<void>;
}

export interface CreateSessionDispatcherParams {
    postMessage: HostMessageSink;
    handleReadyMessage(reply?: HostMessageSink): Promise<void>;
    handleHistoryNavigationMessage(direction: "undo" | "redo"): Promise<void>;
    handleSelectTreeMessage(): Promise<void>;
    handleSelectNodeMessage(
        msg: Extract<EditorToHostMessage, { type: "selectNode" }>
    ): Promise<void>;
    handleMutateDocumentMessage(
        msg: Extract<EditorToHostMessage, { type: "mutateDocument" }>,
        reply?: HostMessageSink,
        source?: MessageSource
    ): Promise<void>;
    handleSaveDocumentMessage(
        msg: Extract<EditorToHostMessage, { type: "saveDocument" }>,
        reply?: HostMessageSink
    ): Promise<void>;
    handleRevertDocumentMessage(
        msg: Extract<EditorToHostMessage, { type: "revertDocument" }>,
        reply?: HostMessageSink
    ): Promise<void>;
    refreshSettings(opts?: { refreshDefs?: boolean }): Promise<void>;
    handleValidateNodeChecksMessage(
        msg: Extract<EditorToHostMessage, { type: "validateNodeChecks" }>,
        reply?: HostMessageSink
    ): Promise<void>;
    fileRequestHandlers: SessionDispatcherFileRequestHandlers;
}

export function createSessionDispatcher({
    postMessage,
    handleReadyMessage,
    handleHistoryNavigationMessage,
    handleSelectTreeMessage,
    handleSelectNodeMessage,
    handleMutateDocumentMessage,
    handleSaveDocumentMessage,
    handleRevertDocumentMessage,
    refreshSettings,
    handleValidateNodeChecksMessage,
    fileRequestHandlers,
}: CreateSessionDispatcherParams): SessionDispatcher {
    const dispatchEditorMessage = async (
        msg: EditorToHostMessage,
        reply: HostMessageSink = postMessage,
        source: MessageSource = "editor"
    ): Promise<void> => {
        switch (msg.type) {
            case "ready":
                await handleReadyMessage(reply);
                return;

            case "undo":
                await handleHistoryNavigationMessage("undo");
                return;

            case "redo":
                await handleHistoryNavigationMessage("redo");
                return;

            case "selectTree":
                await handleSelectTreeMessage();
                return;

            case "selectNode":
                await handleSelectNodeMessage(msg);
                return;

            case "requestFocusVariable":
                if (source !== "editor") {
                    // Transient raw relay into editor-local highlights; never store it in host snapshots.
                    await postMessage({
                        type: "relayFocusVariable",
                        names: msg.names,
                    });
                }
                return;

            case "mutateDocument":
                await handleMutateDocumentMessage(msg, reply, source);
                return;

            case "saveDocument":
                await handleSaveDocumentMessage(msg, reply);
                return;

            case "revertDocument":
                await handleRevertDocumentMessage(msg, reply);
                return;

            case "requestSetting":
                await refreshSettings({ refreshDefs: true });
                return;

            case "build":
                void vscode.commands
                    .executeCommand("behavior3.build", {
                        buildScriptDebug: msg.buildScriptDebug,
                    })
                    .then(undefined, logAsyncRuntimeError("command:behavior3.build"));
                return;

            case "validateNodeChecks":
                await handleValidateNodeChecksMessage(msg, reply);
                return;

            case "webviewLog":
                writeWebviewLogMessage(msg);
                return;

            case "readFile":
                await fileRequestHandlers.handleReadFileMessage(msg, reply);
                return;

            case "saveSubtree":
                await fileRequestHandlers.handleSaveSubtreeMessage(msg, reply);
                return;

            case "saveSubtreeAs":
                await fileRequestHandlers.handleSaveSubtreeAsMessage(msg, reply);
                return;
        }
    };

    return {
        dispatchEditorMessage,
    };
}
