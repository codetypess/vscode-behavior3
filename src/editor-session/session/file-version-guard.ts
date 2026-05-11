import * as vscode from "vscode";
import { readWorkspaceFileContent } from "../files/paths";
import type { TreeEditorSessionContext } from "./context";
import {
    getNewerFileEditMessage,
    getNewerFileVersion,
    getNewerVersionMessage,
} from "../document/file-version";

export interface FileVersionGuard {
    updateFileVersionState(content: string, opts?: { showWarning?: boolean }): void;
    getActiveNewerFileEditMessage(): string | null;
    blockEditingForNewerFile(): string | null;
    getExistingNewerFileEditMessage(fileUri: vscode.Uri): Promise<string | null>;
}

export function createFileVersionGuard(context: TreeEditorSessionContext): FileVersionGuard {
    const { document, state } = context;

    const updateFileVersionState = (
        content: string,
        opts?: { showWarning?: boolean }
    ): void => {
        state.fileVersionIsNewer = false;
        state.newerFileVersion = null;

        const fileVersion = getNewerFileVersion(content);
        if (!fileVersion) {
            return;
        }

        state.fileVersionIsNewer = true;
        state.newerFileVersion = fileVersion;
        if (opts?.showWarning) {
            vscode.window.showWarningMessage(
                getNewerVersionMessage(state.currentSettings.language, fileVersion, "warn")
            );
        }
    };

    const getActiveNewerFileEditMessage = (): string | null => {
        updateFileVersionState(document.content);
        const fileVersion = state.newerFileVersion;
        if (!state.fileVersionIsNewer || !fileVersion) {
            return null;
        }

        return getNewerVersionMessage(state.currentSettings.language, fileVersion, "edit");
    };

    const blockEditingForNewerFile = (): string | null => {
        const message = getActiveNewerFileEditMessage();
        if (!message) {
            return null;
        }

        vscode.window.showErrorMessage(message);
        return message;
    };

    const getExistingNewerFileEditMessage = async (
        fileUri: vscode.Uri
    ): Promise<string | null> => {
        try {
            const content = await readWorkspaceFileContent(fileUri);
            return getNewerFileEditMessage(state.currentSettings.language, content);
        } catch {
            return null;
        }
    };

    return {
        updateFileVersionState,
        getActiveNewerFileEditMessage,
        blockEditingForNewerFile,
        getExistingNewerFileEditMessage,
    };
}
