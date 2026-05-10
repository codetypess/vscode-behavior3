import * as path from "path";
import * as vscode from "vscode";
import {
    normalizeTreeContentForWrite,
    readFileContentFromDisk,
    TreeEditorDocument,
} from "./editor-session/document-sync";
import {
    preparePersistedTreeForMainDocumentSave,
    type MainDocumentSubtreeWriteback,
} from "../webview/domain/main-document-save";
import { parsePersistedTreeContent } from "../webview/shared/tree";
import type { HostSelectionState, NodeInstanceRef } from "../webview/shared/contracts";
import type {
    EditorToHostMessage,
    HostToEditorMessage,
} from "../webview/shared/message-protocol";
import type { ActiveTreeEditorWebview } from "./editor-session/tree-editor-webview-session";
import { resolveTreeEditorSession } from "./editor-session/tree-editor-webview-session";
import { getNewerVersionMessage, getTreeFileVersion } from "./editor-session/session-file-version";
import { getEditorLanguage } from "./editor-session/session-settings";
import { InspectorSidebarCoordinator } from "./inspector-sidebar-coordinator";
import { configureBehaviorWebview } from "./webview-html";
import { isDocumentVersionNewer } from "../webview/shared/document-version";
import { normalizeHostSelectionState } from "../webview/shared/protocol";
import { getBehaviorProjectRootFsPath, resolveNodeDefs } from "./setting-resolver";

function getNewerFileWriteError(content: string): string | null {
    const fileVersion = getTreeFileVersion(content);
    if (!fileVersion || !isDocumentVersionNewer(fileVersion)) {
        return null;
    }
    const config = vscode.workspace.getConfiguration("behavior3");
    const language = getEditorLanguage(config.get<string>("language", "auto"));
    return getNewerVersionMessage(language, fileVersion, "edit");
}

/**
 * VS Code custom-editor facade.
 * Keep lifecycle/save/revert ownership here; per-webview message orchestration
 * belongs in `editor-session/tree-editor-webview-session.ts`.
 */
export class TreeEditorProvider implements vscode.CustomEditorProvider<TreeEditorDocument> {
    public static readonly viewType = "behavior3.treeEditor";
    private static readonly activeWebviews = new Set<ActiveTreeEditorWebview>();
    private readonly documentSelections = new Map<string, HostSelectionState>();
    private readonly documentRevealTargets = new Map<string, NodeInstanceRef>();
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

    private stageDocumentSelection(documentUri: string, selection: HostSelectionState): void {
        const normalized = normalizeHostSelectionState(selection);
        this.documentSelections.set(documentUri, normalized);

        const message: EditorToHostMessage =
            normalized.kind === "tree"
                ? { type: "selectTree" }
                : { type: "selectNode", target: normalized.ref };

        TreeEditorProvider.dispatchMessageToDocument(documentUri, message, async () => true);
        if (normalized.kind === "tree") {
            this.documentRevealTargets.delete(documentUri);
            return;
        }

        this.documentRevealTargets.set(documentUri, normalized.ref);
        const delivered = TreeEditorProvider.postMessageToDocument(documentUri, {
            type: "relayFocusNode",
            target: normalized.ref,
        });
        if (delivered) {
            this.documentRevealTargets.delete(documentUri);
        }
    }

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

    private getProjectRootFsPath(
        document: TreeEditorDocument,
        workspaceFolderUri?: vscode.Uri
    ): string {
        return workspaceFolderUri
            ? getBehaviorProjectRootFsPath(document.uri, workspaceFolderUri)
            : path.dirname(document.uri.fsPath);
    }

    private async buildMainDocumentSavePlan(document: TreeEditorDocument): Promise<{
        content: string;
        subtreeWritebacks: MainDocumentSubtreeWriteback[];
        projectRootFsPath: string;
    }> {
        const workspaceFolderUri = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;
        const projectRootFsPath = this.getProjectRootFsPath(document, workspaceFolderUri);

        try {
            // Main-document saves resolve reachable subtrees first so display ids match the rendered graph.
            const tree = parsePersistedTreeContent(document.content, document.uri.fsPath);
            const nodeDefs = workspaceFolderUri
                ? await resolveNodeDefs(workspaceFolderUri, document.uri)
                : [];

            const savePlan = await preparePersistedTreeForMainDocumentSave({
                tree,
                nodeDefs,
                readSubtreeContent: async (relativePath) => {
                    const subtreeUri = vscode.Uri.file(
                        path.join(projectRootFsPath, relativePath)
                    );
                    try {
                        return await readFileContentFromDisk(subtreeUri);
                    } catch {
                        return null;
                    }
                },
            });
            return {
                ...savePlan,
                projectRootFsPath,
            };
        } catch {
            return {
                content: normalizeTreeContentForWrite(document.content, document.uri.fsPath),
                subtreeWritebacks: [],
                projectRootFsPath,
            };
        }
    }

    private async assertCanWriteSubtreeWritebacks(
        projectRootFsPath: string,
        writebacks: MainDocumentSubtreeWriteback[]
    ): Promise<void> {
        for (const writeback of writebacks) {
            const subtreeUri = vscode.Uri.file(path.join(projectRootFsPath, writeback.path));
            let existingContent: string | null = null;
            try {
                existingContent = await readFileContentFromDisk(subtreeUri);
            } catch {
                // Missing files can be created; other read failures will surface during the write.
            }
            if (existingContent === null) {
                continue;
            }

            const error = getNewerFileWriteError(existingContent);
            if (error) {
                throw new Error(error);
            }
        }
    }

    private async writeSubtreeWritebacks(
        projectRootFsPath: string,
        writebacks: MainDocumentSubtreeWriteback[]
    ): Promise<void> {
        for (const writeback of writebacks) {
            const subtreeUri = vscode.Uri.file(path.join(projectRootFsPath, writeback.path));
            await this.writeDocumentContentToDisk(subtreeUri, writeback.content);
        }
    }

    private async persistMainDocumentToDisk(
        document: TreeEditorDocument,
        opts?: { notifyReload?: boolean }
    ): Promise<string> {
        // This is the single VS Code save path that marks sessions saved and suppresses our watcher echo.
        const savePlan = await this.buildMainDocumentSavePlan(document);
        this.assertCanWriteTreeContent(savePlan.content);
        await this.assertCanWriteSubtreeWritebacks(
            savePlan.projectRootFsPath,
            savePlan.subtreeWritebacks
        );
        await this.writeSubtreeWritebacks(
            savePlan.projectRootFsPath,
            savePlan.subtreeWritebacks
        );
        const normalizedContent = await this.writeDocumentContentToDisk(
            document.uri,
            savePlan.content
        );
        document.markSaved(normalizedContent);
        document.sessionState.markSaved(normalizedContent);
        document.rememberOwnWrite(normalizedContent);

        if (opts?.notifyReload !== false) {
            const selection =
                this.documentSelections.get(document.uri.toString()) ?? { kind: "tree" };
            TreeEditorProvider.postMessageToDocument(document.uri.toString(), {
                type: "documentSnapshotChanged",
                snapshot: {
                    content: normalizedContent,
                    documentSession: document.sessionState.getSnapshot(),
                    selection,
                    syncKind: "reload",
                },
            });
            this.inspectorCoordinator.notifyDocumentSaved(
                document.uri.toString(),
                normalizedContent,
                document.sessionState.getSnapshot()
            );
        }

        return normalizedContent;
    }

    async openCustomDocument(
        uri: vscode.Uri,
        openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken
    ): Promise<TreeEditorDocument> {
        // VS Code may reopen from a backup or untitled buffer before the file exists on disk.
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
        const savePlan = await this.buildMainDocumentSavePlan(document);
        this.assertCanWriteTreeContent(savePlan.content);
        let existingContent: string | null = null;
        try {
            existingContent = await readFileContentFromDisk(destination);
        } catch {
            existingContent = null;
        }
        if (existingContent !== null) {
            this.assertCanWriteTreeContent(existingContent);
        }
        await this.assertCanWriteSubtreeWritebacks(
            savePlan.projectRootFsPath,
            savePlan.subtreeWritebacks
        );
        await this.writeSubtreeWritebacks(
            savePlan.projectRootFsPath,
            savePlan.subtreeWritebacks
        );
        await this.writeDocumentContentToDisk(destination, savePlan.content);
    }

    async revertCustomDocument(
        document: TreeEditorDocument,
        _cancellation: vscode.CancellationToken
    ): Promise<void> {
        const content = await readFileContentFromDisk(document.uri);
        document.clearOwnWrites();
        document.updateContent(content, { markSaved: true, markDirty: false });
        document.sessionState.replaceFromDisk(content);
        const selection =
            this.documentSelections.get(document.uri.toString()) ?? { kind: "tree" };
        TreeEditorProvider.postMessageToDocument(document.uri.toString(), {
            type: "documentSnapshotChanged",
            snapshot: {
                content,
                documentSession: document.sessionState.getSnapshot(),
                selection,
                syncKind: "reload",
            },
        });
        this.inspectorCoordinator.notifyDocumentSaved(
            document.uri.toString(),
            content,
            document.sessionState.getSnapshot()
        );
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
        webviewPanel.onDidChangeViewState(() => {
            if (!webviewPanel.active) {
                return;
            }
            this.inspectorCoordinator.setActiveDocument(document.uri.toString());
        });

        const initialSelection =
            this.documentSelections.get(document.uri.toString()) ?? ({ kind: "tree" } as const);
        const initialRevealTarget =
            this.documentRevealTargets.get(document.uri.toString()) ?? null;
        this.documentRevealTargets.delete(document.uri.toString());
        await resolveTreeEditorSession({
            document,
            webviewPanel,
            viewType: TreeEditorProvider.viewType,
            initialSelection,
            initialRevealTarget,
            configureWebview: (webview, workspaceFolderUri) => {
                configureBehaviorWebview(webview, this._extensionUri, workspaceFolderUri, {
                    title: "Behavior3 Editor",
                    mode: "editor",
                });
            },
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
            stageDocumentSelection: (documentUri, selection) => {
                this.stageDocumentSelection(documentUri, selection);
            },
            onInspectorSessionUpdate: (snapshot) => {
                this.documentSelections.set(
                    document.uri.toString(),
                    normalizeHostSelectionState(snapshot.documentSnapshot.selection)
                );
                this.inspectorCoordinator.updateSession(snapshot);
            },
            onInspectorSessionDispose: (documentUri) => {
                this.documentSelections.delete(documentUri);
                this.documentRevealTargets.delete(documentUri);
                this.inspectorCoordinator.removeSession(documentUri);
            },
        });
    }
}
