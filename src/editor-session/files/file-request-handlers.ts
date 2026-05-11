import * as vscode from "vscode";
import { getBehavior3OutputChannel } from "../../output-channel";
import type {
    EditorToHostMessage,
    HostToEditorMessage,
} from "../../../webview/shared/message-protocol";
import type { HostSelectionState } from "../../../webview/shared/contracts";
import { normalizeNodeInstanceRef } from "../../../webview/shared/protocol";
import {
    readWorkspaceFileContent,
    resolvePathInWorkdir,
    uriToWorkdirRelative,
} from "./paths";

type HostMessageSink = (message: HostToEditorMessage) => Thenable<boolean>;

export interface SaveSubtreeContentAsResult {
    savedPath: string | null;
    error?: string;
}

interface CreateSessionFileRequestHandlersParams {
    projectRootUri: vscode.Uri;
    viewType: string;
    stageDocumentSelection(documentUri: string, selection: HostSelectionState): void;
    writeDocumentContentToDisk(targetUri: vscode.Uri, content: string): Promise<string>;
    getActiveNewerFileEditMessage(): string | null;
    getExistingNewerFileEditMessage(fileUri: vscode.Uri): Promise<string | null>;
}

export function createSessionFileRequestHandlers({
    projectRootUri,
    viewType,
    stageDocumentSelection,
    writeDocumentContentToDisk,
    getActiveNewerFileEditMessage,
    getExistingNewerFileEditMessage,
}: CreateSessionFileRequestHandlersParams) {
    const saveSubtreeContentAs = async (
        content: string,
        suggestedBaseName: string
    ): Promise<SaveSubtreeContentAsResult> => {
        try {
            // Save As is constrained to workdir so persisted subtree references stay portable.
            const activeFileBlockMessage = getActiveNewerFileEditMessage();
            if (activeFileBlockMessage) {
                vscode.window.showErrorMessage(activeFileBlockMessage);
                return {
                    savedPath: null,
                    error: activeFileBlockMessage,
                };
            }

            const defaultUri = vscode.Uri.joinPath(projectRootUri, `${suggestedBaseName}.json`);
            const picked = await vscode.window.showSaveDialog({
                defaultUri,
                filters: { JSON: ["json"] },
            });
            if (!picked) {
                return {
                    savedPath: null,
                };
            }

            const rel = uriToWorkdirRelative(picked, projectRootUri);
            if (!rel) {
                const error = "Save location must be inside the behavior tree work directory.";
                vscode.window.showErrorMessage(error);
                return {
                    savedPath: null,
                    error,
                };
            }

            const targetFileBlockMessage = await getExistingNewerFileEditMessage(picked);
            if (targetFileBlockMessage) {
                vscode.window.showErrorMessage(targetFileBlockMessage);
                return {
                    savedPath: null,
                    error: targetFileBlockMessage,
                };
            }

            await writeDocumentContentToDisk(picked, content);
            return {
                savedPath: rel,
            };
        } catch (error) {
            const message = String(error);
            vscode.window.showErrorMessage(`Failed to save subtree: ${message}`);
            return {
                savedPath: null,
                error: message,
            };
        }
    };

    const handleReadFileMessage = async (
        msg: Extract<EditorToHostMessage, { type: "readFile" }>,
        reply: HostMessageSink
    ): Promise<void> => {
        const fileUri = resolvePathInWorkdir(msg.path, projectRootUri);
        if (!fileUri) {
            await reply({
                type: "readFileResult",
                requestId: msg.requestId,
                content: null,
            });
            getBehavior3OutputChannel().warn("readFile rejected: path outside workdir", msg.path);
            return;
        }

        try {
            const content = await readWorkspaceFileContent(fileUri);
            if (msg.openIfSubtree) {
                if (msg.openSelection) {
                    stageDocumentSelection(fileUri.toString(), {
                        kind: "node",
                        ref: normalizeNodeInstanceRef(msg.openSelection),
                    });
                }
                try {
                    await vscode.commands.executeCommand(
                        "vscode.openWith",
                        fileUri,
                        viewType,
                        vscode.ViewColumn.Active
                    );
                } catch {
                    /* ignore open failure */
                }
            }

            await reply({
                type: "readFileResult",
                requestId: msg.requestId,
                content,
            });
        } catch {
            await reply({
                type: "readFileResult",
                requestId: msg.requestId,
                content: null,
            });
            getBehavior3OutputChannel().warn("readFile failed", msg.path);
        }
    };

    const handleSaveSubtreeMessage = async (
        msg: Extract<EditorToHostMessage, { type: "saveSubtree" }>,
        reply: HostMessageSink
    ): Promise<void> => {
        const fileUri = resolvePathInWorkdir(msg.path, projectRootUri, {
            mustBeJson: true,
        });
        if (!fileUri) {
            const error = "Save path must be a .json file inside the behavior tree work directory.";
            await reply({
                type: "saveSubtreeResult",
                requestId: msg.requestId,
                success: false,
                error,
            });
            getBehavior3OutputChannel().warn("saveSubtree rejected", msg.path);
            return;
        }

        try {
            const activeFileBlockMessage = getActiveNewerFileEditMessage();
            if (activeFileBlockMessage) {
                await reply({
                    type: "saveSubtreeResult",
                    requestId: msg.requestId,
                    success: false,
                    error: activeFileBlockMessage,
                });
                getBehavior3OutputChannel().warn(
                    `saveSubtree blocked: active file was created by a newer Behavior3 version`
                );
                return;
            }

            const targetFileBlockMessage = await getExistingNewerFileEditMessage(fileUri);
            if (targetFileBlockMessage) {
                await reply({
                    type: "saveSubtreeResult",
                    requestId: msg.requestId,
                    success: false,
                    error: targetFileBlockMessage,
                });
                getBehavior3OutputChannel().warn(
                    `saveSubtree blocked: ${fileUri.fsPath} was created by a newer Behavior3 version`
                );
                return;
            }

            await writeDocumentContentToDisk(fileUri, msg.content);
            await reply({
                type: "saveSubtreeResult",
                requestId: msg.requestId,
                success: true,
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to save subtree: ${error}`);
            await reply({
                type: "saveSubtreeResult",
                requestId: msg.requestId,
                success: false,
                error: String(error),
            });
        }
    };

    const handleSaveSubtreeAsMessage = async (
        msg: Extract<EditorToHostMessage, { type: "saveSubtreeAs" }>,
        reply: HostMessageSink
    ): Promise<void> => {
        const result = await saveSubtreeContentAs(msg.content, msg.suggestedBaseName);
        await reply({
            type: "saveSubtreeAsResult",
            requestId: msg.requestId,
            savedPath: result.savedPath,
            error: result.error,
        });
    };

    return {
        handleReadFileMessage,
        handleSaveSubtreeMessage,
        handleSaveSubtreeAsMessage,
        saveSubtreeContentAs,
    };
}
