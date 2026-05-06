import * as path from "path";
import * as vscode from "vscode";
import {
    normalizeTreeContentForWrite,
    readFileContentFromDisk,
    TreeEditorDocument,
} from "./editor-session/document-sync";
import type {
    EditorToHostMessage,
    HostToEditorMessage,
} from "../webview/shared/message-protocol";
import type { ActiveTreeEditorWebview } from "./editor-session/tree-editor-webview-session";
import { resolveTreeEditorSession } from "./editor-session/tree-editor-webview-session";
import { InspectorSidebarCoordinator } from "./inspector-sidebar-coordinator";
import { configureBehaviorWebview } from "./webview-html";
import { isDocumentVersionNewer } from "../webview/shared/document-version";

function getTreeFileVersion(content: string): string | undefined {
    try {
        const fileData = JSON.parse(content) as { version?: unknown };
        return typeof fileData.version === "string" ? fileData.version : undefined;
    } catch {
        return undefined;
    }
}

function getEditorLanguage(setting: string): "zh" | "en" {
    if (setting === "zh" || setting === "en") {
        return setting;
    }
    const envLanguage = vscode.env.language.toLowerCase();
    return envLanguage.startsWith("zh") ? "zh" : "en";
}

function getNewerVersionEditMessage(fileVersion: string): string {
    const config = vscode.workspace.getConfiguration("behavior3");
    const language = getEditorLanguage(config.get<string>("language", "auto"));
    return language === "zh"
        ? `此文件由新版本 Behavior3(${fileVersion}) 创建，请升级到最新版本后再编辑。`
        : `This file is created by a newer version of Behavior3(${fileVersion}). Please upgrade to the latest version.`;
}

function getNewerFileWriteError(content: string): string | null {
    const fileVersion = getTreeFileVersion(content);
    if (!fileVersion || !isDocumentVersionNewer(fileVersion)) {
        return null;
    }
    return getNewerVersionEditMessage(fileVersion);
}

export class TreeEditorProvider implements vscode.CustomEditorProvider<TreeEditorDocument> {
    public static readonly viewType = "behavior3.treeEditor";
    private static readonly activeWebviews = new Set<ActiveTreeEditorWebview>();
    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
        vscode.CustomDocumentContentChangeEvent<TreeEditorDocument>
    >();
    public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    public static postMessageToWorkspace(
        workspaceFsPath: string,
        message: HostToEditorMessage
    ): boolean {
        let delivered = false;
        for (const entry of TreeEditorProvider.activeWebviews) {
            if (entry.workspaceFsPath !== workspaceFsPath) {
                continue;
            }
            delivered = true;
            void entry.postMessage(message);
        }
        return delivered;
    }

    public static postMessageToDocument(
        documentUri: string,
        message: HostToEditorMessage
    ): boolean {
        let delivered = false;
        for (const entry of TreeEditorProvider.activeWebviews) {
            if (entry.documentUri !== documentUri) {
                continue;
            }
            delivered = true;
            void entry.postMessage(message);
        }
        return delivered;
    }

    public static dispatchMessageToDocument(
        documentUri: string,
        message: EditorToHostMessage,
        reply: (message: HostToEditorMessage) => Thenable<boolean>
    ): boolean {
        for (const entry of TreeEditorProvider.activeWebviews) {
            if (entry.documentUri !== documentUri) {
                continue;
            }
            void entry.dispatchMessage(message, reply);
            return true;
        }
        return false;
    }

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly inspectorCoordinator: InspectorSidebarCoordinator
    ) {}

    private assertCanWriteTreeContent(content: string): void {
        const error = getNewerFileWriteError(content);
        if (!error) {
            return;
        }
        throw new Error(error);
    }

    private showBlockedSaveMessage(document: TreeEditorDocument, error: string): void {
        void vscode.window.showErrorMessage(
            `Failed to save '${path.basename(document.uri.fsPath)}': ${error}`
        );
    }

    private async writeDocumentContentToDisk(
        targetUri: vscode.Uri,
        content: string
    ): Promise<string> {
        const normalizedContent = normalizeTreeContentForWrite(content, targetUri.fsPath);
        await vscode.workspace.fs.writeFile(targetUri, Buffer.from(normalizedContent, "utf-8"));
        return normalizedContent;
    }

    private async persistMainDocumentToDisk(
        document: TreeEditorDocument,
        opts?: { notifyReload?: boolean }
    ): Promise<string> {
        this.assertCanWriteTreeContent(document.content);
        const normalizedContent = await this.writeDocumentContentToDisk(
            document.uri,
            document.content
        );
        document.markSaved(normalizedContent);
        document.rememberOwnWrite(normalizedContent);

        if (opts?.notifyReload !== false) {
            TreeEditorProvider.postMessageToDocument(document.uri.toString(), {
                type: "documentReloaded",
                content: normalizedContent,
            });
        }

        return normalizedContent;
    }

    async openCustomDocument(
        uri: vscode.Uri,
        openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken
    ): Promise<TreeEditorDocument> {
        let content = "";
        let dirty = false;

        if (openContext.backupId) {
            content = await readFileContentFromDisk(vscode.Uri.file(openContext.backupId));
            dirty = true;
        } else if (openContext.untitledDocumentData) {
            content = Buffer.from(openContext.untitledDocumentData).toString("utf-8");
            dirty = openContext.untitledDocumentData.length > 0;
        } else {
            content = await readFileContentFromDisk(uri);
        }

        return new TreeEditorDocument(uri, content, { dirty });
    }

    async saveCustomDocument(
        document: TreeEditorDocument,
        _cancellation: vscode.CancellationToken
    ): Promise<void> {
        const error = getNewerFileWriteError(document.content);
        if (error) {
            this.showBlockedSaveMessage(document, error);
            return;
        }
        await this.persistMainDocumentToDisk(document);
    }

    async saveCustomDocumentAs(
        document: TreeEditorDocument,
        destination: vscode.Uri,
        _cancellation: vscode.CancellationToken
    ): Promise<void> {
        this.assertCanWriteTreeContent(document.content);
        let existingContent: string | null = null;
        try {
            existingContent = await readFileContentFromDisk(destination);
        } catch {
            existingContent = null;
        }
        if (existingContent !== null) {
            this.assertCanWriteTreeContent(existingContent);
        }
        await this.writeDocumentContentToDisk(destination, document.content);
    }

    async revertCustomDocument(
        document: TreeEditorDocument,
        _cancellation: vscode.CancellationToken
    ): Promise<void> {
        const content = await readFileContentFromDisk(document.uri);
        document.clearOwnWrites();
        document.updateContent(content, { markSaved: true, markDirty: false });
        TreeEditorProvider.postMessageToDocument(document.uri.toString(), {
            type: "documentReloaded",
            content,
        });
    }

    async backupCustomDocument(
        document: TreeEditorDocument,
        context: vscode.CustomDocumentBackupContext,
        _cancellation: vscode.CancellationToken
    ): Promise<vscode.CustomDocumentBackup> {
        await vscode.workspace.fs.writeFile(context.destination, Buffer.from(document.content, "utf-8"));

        return {
            id: context.destination.fsPath,
            delete: async () => {
                try {
                    await vscode.workspace.fs.delete(context.destination);
                } catch {
                    /* ignore backup cleanup failures */
                }
            },
        };
    }

    async resolveCustomEditor(
        document: TreeEditorDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        await resolveTreeEditorSession({
            document,
            webviewPanel,
            viewType: TreeEditorProvider.viewType,
            configureWebview: (webview, workspaceFolderUri) => {
                configureBehaviorWebview(webview, this._extensionUri, workspaceFolderUri, {
                    title: "Behavior3 Editor",
                    mode: "editor",
                });
            },
            persistMainDocumentToDisk: (currentDocument, opts) =>
                this.persistMainDocumentToDisk(currentDocument, opts),
            writeDocumentContentToDisk: (targetUri, content) =>
                this.writeDocumentContentToDisk(targetUri, content),
            revertDocument: (currentDocument, cancellation) =>
                this.revertCustomDocument(currentDocument, cancellation),
            onDidChangeDocument: (currentDocument) => {
                this._onDidChangeCustomDocument.fire({ document: currentDocument });
            },
            addActiveWebview: (entry) => {
                TreeEditorProvider.activeWebviews.add(entry);
            },
            removeActiveWebview: (entry) => {
                TreeEditorProvider.activeWebviews.delete(entry);
            },
            onInspectorSessionUpdate: (snapshot) => {
                this.inspectorCoordinator.updateSession(snapshot);
            },
            onInspectorSessionDispose: (documentUri) => {
                this.inspectorCoordinator.removeSession(documentUri);
            },
        });
    }
}
