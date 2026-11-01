import * as path from "path";
import * as vscode from "vscode";
import {
    normalizeTreeContentForWrite,
    readFileContentFromDisk,
    TreeEditorDocument,
} from "./editor-session/document/document-sync";
import {
    preparePersistedTreeForMainDocumentSave,
    type MainDocumentSubtreeWriteback,
} from "../webview/domain/main-document-save";
import { ConditionBranchSaveError } from "../webview/shared/condition-branch";
import {
    buildConditionFileTree,
    conditionItemSignature,
    findConditionItemIndex,
    readConditionFileWriteBack,
} from "../webview/shared/condition-file";
import {
    formatDocumentMutationReducerError,
    reduceDocumentMutation,
} from "../webview/shared/document";
import { parsePersistedTreeContent, serializePersistedTree } from "../webview/shared/tree";
import {
    isConditionFileUri,
    parseConditionFileUri,
    type ConditionFileAccess,
} from "./condition-files";
import type {
    HostSelectionState,
    NodeInstanceRef,
    PersistedTreeModel,
} from "../webview/shared/contracts";
import type { EditorToHostMessage, HostToEditorMessage } from "../webview/shared/message-protocol";
import type { ActiveTreeEditorWebview } from "./editor-session/webview-session";
import { resolveTreeEditorSession } from "./editor-session/webview-session";
import { getNewerVersionMessage, getTreeFileVersion } from "./editor-session/document/file-version";
import { getEditorLanguage } from "./editor-session/settings/editor-settings";
import { InspectorSidebarCoordinator } from "./inspector-sidebar-coordinator";
import { configureBehaviorWebview } from "./webview-html";
import { isDocumentVersionNewer } from "../webview/shared/document";
import { normalizeHostSelectionState } from "../webview/shared/protocol";
import { runCustomFieldScripts } from "./editor-session/session/custom-field-scripts";
import { translateRuntimeMessage } from "../webview/shared/runtime-i18n";
import {
    getBehaviorProjectRootFsPath,
    resolveNodeDefs,
    resolveWorkspaceFileSettings,
} from "./setting-resolver";

function getConfiguredLanguage() {
    return getEditorLanguage(
        vscode.workspace.getConfiguration("behavior3").get<string>("language", "auto")
    );
}

function getNewerFileWriteError(content: string): string | null {
    const fileVersion = getTreeFileVersion(content);
    if (!fileVersion || !isDocumentVersionNewer(fileVersion)) {
        return null;
    }
    const config = vscode.workspace.getConfiguration("behavior3");
    const language = getEditorLanguage(config.get<string>("language", "auto"));
    return getNewerVersionMessage(language, fileVersion, "edit");
}

async function closeCustomEditorTabs(documentUris: ReadonlySet<string>): Promise<void> {
    if (documentUris.size === 0) {
        return;
    }
    const tabs = vscode.window.tabGroups.all.flatMap((group) =>
        group.tabs.filter(
            (tab) =>
                tab.input instanceof vscode.TabInputCustom &&
                documentUris.has(tab.input.uri.toString())
        )
    );
    if (tabs.length > 0) {
        await vscode.window.tabGroups.close(tabs);
    }
}

/**
 * VS Code custom-editor facade.
 * Keep lifecycle/save/revert ownership here; per-webview message orchestration
 * belongs in `editor-session/webview-session.ts`.
 */
export class TreeEditorProvider
    implements vscode.CustomEditorProvider<TreeEditorDocument>, ConditionFileAccess
{
    public static readonly viewType = "behavior3.treeEditor";
    private static readonly activeWebviews = new Set<ActiveTreeEditorWebview>();
    // Open documents by URI, so condition files can read their host's unsaved content.
    private readonly openDocuments = new Map<string, TreeEditorDocument>();
    // Condition files being saved; their own write-back must not bounce back as an outside change.
    private readonly savingConditionFiles = new Set<string>();
    // Each condition file's item content at its last read, to tell a reorder from a real change.
    private readonly conditionFileSignatures = new Map<string, string>();
    // Condition files with unsaved edits whose item left the host; discarded on their next focus.
    private readonly removedConditionFiles = new Set<string>();
    private readonly promptingRemovedConditionFiles = new Set<string>();
    private readonly conditionFilePanels = new Map<string, vscode.WebviewPanel>();
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
        // Sidebar/external selections may arrive before an editor exists, so keep a staged reveal target.
        const normalized = normalizeHostSelectionState(selection);
        this.documentSelections.set(documentUri, normalized);

        const message: EditorToHostMessage =
            normalized.kind === "tree"
                ? { type: "selectTree" }
                : {
                      type: "selectNode",
                      target: normalized.ref,
                      surface: normalized.kind === "condition" ? "condition" : "node",
                      conditionIndex:
                          normalized.kind === "condition" ? normalized.index : undefined,
                  };

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

    /** Host content as the editor sees it: the open document (unsaved edits included) or disk. */
    private async readHostContent(hostUri: vscode.Uri): Promise<string> {
        return (
            this.openDocuments.get(hostUri.toString())?.content ??
            (await readFileContentFromDisk(hostUri))
        );
    }

    /**
     * The host tree with the ids it would save now, condition trees included, so a condition
     * file shows the ids its nodes have in the host (they form one run starting at its root).
     * Falls back to the stored ids when the host cannot be resolved.
     */
    private async withLiveDisplayIds(
        hostUri: vscode.Uri,
        hostTree: PersistedTreeModel
    ): Promise<PersistedTreeModel> {
        const workspaceFolderUri = vscode.workspace.getWorkspaceFolder(hostUri)?.uri;
        if (!workspaceFolderUri) {
            return hostTree;
        }
        const projectRootFsPath = getBehaviorProjectRootFsPath(hostUri, workspaceFolderUri);
        try {
            const savePlan = await preparePersistedTreeForMainDocumentSave({
                tree: hostTree,
                nodeDefs: await resolveNodeDefs(workspaceFolderUri, hostUri),
                readSubtreeContent: async (relativePath) => {
                    try {
                        return await readFileContentFromDisk(
                            vscode.Uri.file(path.join(projectRootFsPath, relativePath))
                        );
                    } catch {
                        return null;
                    }
                },
            });
            return parsePersistedTreeContent(savePlan.content, hostUri.fsPath);
        } catch {
            return hostTree;
        }
    }

    async readConditionFile(uri: vscode.Uri): Promise<string> {
        const location = parseConditionFileUri(uri);
        if (!location) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        let hostContent: string;
        try {
            hostContent = await this.readHostContent(location.hostUri);
        } catch {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        const hostTree = await this.withLiveDisplayIds(
            location.hostUri,
            parsePersistedTreeContent(hostContent, location.hostUri.fsPath)
        );
        const conditionTree = buildConditionFileTree(
            hostTree,
            location.hostStableId,
            location.rootUuid
        );
        if (!conditionTree) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        const signature = conditionItemSignature(
            hostTree,
            location.hostStableId,
            location.rootUuid
        );
        if (signature !== null) {
            this.conditionFileSignatures.set(uri.toString(), signature);
        }
        return serializePersistedTree(conditionTree);
    }

    /**
     * Write a condition file back into its host, into the item with the file's root uuid wherever
     * it sits now. An open host takes it as an ordinary mutation (undo history, dirty state); a
     * closed host is updated on disk.
     */
    async writeConditionFile(uri: vscode.Uri, content: string): Promise<void> {
        const location = parseConditionFileUri(uri);
        if (!location) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        const hostTree = parsePersistedTreeContent(
            await this.readHostContent(location.hostUri),
            location.hostUri.fsPath
        );
        const index = findConditionItemIndex(hostTree, location.hostStableId, location.rootUuid);
        if (index < 0) {
            throw new Error(
                translateRuntimeMessage(getConfiguredLanguage(), "condition.fileItemRemovedSave")
            );
        }
        const conditionTree = parsePersistedTreeContent(content, uri.path);
        const mutation = {
            type: "setConditionRoot" as const,
            payload: {
                hostStableId: location.hostStableId,
                index,
                ...readConditionFileWriteBack(conditionTree),
            },
        };

        const hostKey = location.hostUri.toString();
        const result = await new Promise<{ success: boolean; error?: string } | null>((resolve) => {
            const delivered = TreeEditorProvider.dispatchMessageToDocument(
                hostKey,
                { type: "mutateDocument", requestId: `condition-file:${uri.path}`, mutation },
                async (message) => {
                    if (message.type === "mutateDocumentResult") {
                        resolve({ success: message.success, error: message.error });
                    }
                    return true;
                }
            );
            if (!delivered) {
                resolve(null);
            }
        });
        if (result) {
            if (!result.success) {
                throw new Error(result.error ?? "Failed to update the host file");
            }
            return;
        }

        const hostContent = await readFileContentFromDisk(location.hostUri);
        this.assertCanWriteTreeContent(hostContent);
        const workspaceFolderUri = vscode.workspace.getWorkspaceFolder(location.hostUri)?.uri;
        const [nodeDefs, workspaceSettings] = workspaceFolderUri
            ? await Promise.all([
                  resolveNodeDefs(workspaceFolderUri, location.hostUri),
                  resolveWorkspaceFileSettings(workspaceFolderUri, location.hostUri),
              ])
            : [[], undefined];
        const reduced = reduceDocumentMutation(mutation, {
            tree: parsePersistedTreeContent(hostContent, location.hostUri.fsPath),
            nodeDefs,
            customFields: workspaceSettings?.customFields,
        });
        if (reduced.status === "error") {
            throw new Error(
                formatDocumentMutationReducerError(reduced.error, getConfiguredLanguage())
            );
        }
        if (reduced.status === "changed") {
            await this.writeDocumentContentToDisk(
                location.hostUri,
                serializePersistedTree(reduced.tree)
            );
        }
    }

    /**
     * Sync open condition files of a host whose content just changed. A file follows its item by
     * root uuid, so a reorder keeps it open. A clean file re-reads; one with unsaved edits re-reads
     * (and may show the outside-change conflict) only when its item itself changed. A file whose
     * item is gone closes, or with unsaved edits waits for its next focus to discard them.
     */
    private refreshConditionFiles(hostUri: vscode.Uri): void {
        const hostKey = hostUri.toString();
        const entries = [...TreeEditorProvider.activeWebviews].filter(
            (entry) =>
                !this.savingConditionFiles.has(entry.documentUri) &&
                parseConditionFileUri(vscode.Uri.parse(entry.documentUri))?.hostUri.toString() ===
                    hostKey
        );
        if (entries.length === 0) {
            return;
        }
        void (async () => {
            let hostTree: PersistedTreeModel | null = null;
            try {
                const hostContent = await this.readHostContent(hostUri);
                hostTree = parsePersistedTreeContent(hostContent, hostUri.fsPath);
            } catch {
                // Unreadable host: reload as before and let each tab report it.
            }
            const removedCleanUris = new Set<string>();
            for (const entry of entries) {
                const key = entry.documentUri;
                const document = this.openDocuments.get(key);
                const location = parseConditionFileUri(vscode.Uri.parse(key));
                if (!hostTree || !document || !location) {
                    void entry.reloadFromBackingFile();
                    continue;
                }
                const signature = conditionItemSignature(
                    hostTree,
                    location.hostStableId,
                    location.rootUuid
                );
                if (signature === null) {
                    if (document.isDirty) {
                        this.markConditionFileRemoved(key);
                    } else {
                        removedCleanUris.add(key);
                    }
                    continue;
                }
                // An undo can bring a removed item back.
                this.removedConditionFiles.delete(key);
                if (document.isDirty && signature === this.conditionFileSignatures.get(key)) {
                    continue;
                }
                void entry.reloadFromBackingFile();
            }
            await closeCustomEditorTabs(removedCleanUris);
        })();
    }

    private markConditionFileRemoved(key: string): void {
        if (this.removedConditionFiles.has(key)) {
            return;
        }
        this.removedConditionFiles.add(key);
        if (this.conditionFilePanels.get(key)?.active) {
            void this.discardRemovedConditionFile(key);
        }
    }

    /** Tell the user the item is gone, then drop the tab's edits and close it. */
    private async discardRemovedConditionFile(key: string): Promise<void> {
        if (this.promptingRemovedConditionFiles.has(key)) {
            return;
        }
        this.promptingRemovedConditionFiles.add(key);
        try {
            await vscode.window.showWarningMessage(
                translateRuntimeMessage(getConfiguredLanguage(), "condition.fileItemRemoved"),
                { modal: true }
            );
        } finally {
            this.promptingRemovedConditionFiles.delete(key);
        }
        if (!this.removedConditionFiles.has(key) || !this.conditionFilePanels.get(key)?.active) {
            return;
        }
        await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
    }

    private async saveConditionDocument(document: TreeEditorDocument): Promise<void> {
        const key = document.uri.toString();
        this.savingConditionFiles.add(key);
        try {
            await this.writeConditionFile(document.uri, document.content);
            // The host now holds the tree; show it back the way the host stores it.
            const content = await this.readConditionFile(document.uri);
            document.markSaved(content);
            document.sessionState.markSaved(content);
            document.rememberOwnWrite(content);
            this.notifyDocumentReloaded(document, content);
        } finally {
            this.savingConditionFiles.delete(key);
        }
    }

    private notifyDocumentReloaded(document: TreeEditorDocument, content: string): void {
        const selection = this.documentSelections.get(document.uri.toString()) ?? { kind: "tree" };
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
                    const subtreeUri = vscode.Uri.file(path.join(projectRootFsPath, relativePath));
                    try {
                        return await readFileContentFromDisk(subtreeUri);
                    } catch {
                        return null;
                    }
                },
                afterApplyDisplayIds: workspaceFolderUri
                    ? async (savedTree, previousNodeId) => {
                          const workspaceSettings = await resolveWorkspaceFileSettings(
                              workspaceFolderUri,
                              document.uri
                          );
                          await runCustomFieldScripts({
                              tree: savedTree,
                              reason: "save",
                              previousNodeId,
                              customFields: workspaceSettings?.customFields,
                              documentUri: document.uri,
                              workspaceFolderUri,
                              nodeDefs,
                              language: getEditorLanguage(
                                  vscode.workspace
                                      .getConfiguration("behavior3")
                                      .get<string>("language", "auto")
                              ),
                          });
                      }
                    : undefined,
            });
            return {
                ...savePlan,
                projectRootFsPath,
            };
        } catch (error) {
            if (error instanceof ConditionBranchSaveError) {
                throw error;
            }
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
        // This is the single VS Code save path that marks sessions saved, suppresses our watcher echo,
        // and notifies the active editor/sidebar snapshot cache.

        const savePlan = await this.buildMainDocumentSavePlan(document);
        this.assertCanWriteTreeContent(savePlan.content);
        await this.assertCanWriteSubtreeWritebacks(
            savePlan.projectRootFsPath,
            savePlan.subtreeWritebacks
        );
        await this.writeSubtreeWritebacks(savePlan.projectRootFsPath, savePlan.subtreeWritebacks);
        const normalizedContent = await this.writeDocumentContentToDisk(
            document.uri,
            savePlan.content
        );
        document.markSaved(normalizedContent);
        document.sessionState.markSaved(normalizedContent);
        document.rememberOwnWrite(normalizedContent);

        if (opts?.notifyReload !== false) {
            this.notifyDocumentReloaded(document, normalizedContent);
        }
        this.refreshConditionFiles(document.uri);

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

        const document = new TreeEditorDocument(uri, content, { dirty });
        const key = uri.toString();
        this.openDocuments.set(key, document);
        document.onDidDispose(() => {
            if (this.openDocuments.get(key) === document) {
                this.openDocuments.delete(key);
                this.conditionFileSignatures.delete(key);
                this.removedConditionFiles.delete(key);
            }
        });
        return document;
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
        if (isConditionFileUri(document.uri)) {
            await this.saveConditionDocument(document);
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
        await this.writeSubtreeWritebacks(savePlan.projectRootFsPath, savePlan.subtreeWritebacks);
        await this.writeDocumentContentToDisk(destination, savePlan.content);
    }

    async revertCustomDocument(
        document: TreeEditorDocument,
        _cancellation: vscode.CancellationToken
    ): Promise<void> {
        const key = document.uri.toString();
        if (this.removedConditionFiles.has(key)) {
            // Nothing left to revert to: drop the edits and close the tab.
            this.removedConditionFiles.delete(key);
            document.markSaved();
            void closeCustomEditorTabs(new Set([key]));
            return;
        }
        const content = await readFileContentFromDisk(document.uri);
        document.clearOwnWrites();
        document.updateContent(content, { markSaved: true, markDirty: false });
        document.sessionState.replaceFromDisk(content);
        this.notifyDocumentReloaded(document, content);
        this.refreshConditionFiles(document.uri);
    }

    async backupCustomDocument(
        document: TreeEditorDocument,
        context: vscode.CustomDocumentBackupContext,
        _cancellation: vscode.CancellationToken
    ): Promise<vscode.CustomDocumentBackup> {
        await vscode.workspace.fs.writeFile(
            context.destination,
            Buffer.from(document.content, "utf-8")
        );

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
        const documentKey = document.uri.toString();
        if (isConditionFileUri(document.uri)) {
            this.conditionFilePanels.set(documentKey, webviewPanel);
            webviewPanel.onDidDispose(() => {
                if (this.conditionFilePanels.get(documentKey) === webviewPanel) {
                    this.conditionFilePanels.delete(documentKey);
                }
            });
        }
        webviewPanel.onDidChangeViewState(() => {
            if (!webviewPanel.active) {
                return;
            }
            this.inspectorCoordinator.setActiveDocument(documentKey);
            if (this.removedConditionFiles.has(documentKey)) {
                void this.discardRemovedConditionFile(documentKey);
            }
        });

        const initialSelection =
            this.documentSelections.get(document.uri.toString()) ?? ({ kind: "tree" } as const);
        const initialRevealTarget = this.documentRevealTargets.get(document.uri.toString()) ?? null;
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
                this.refreshConditionFiles(currentDocument.uri);
            },
            onDidReloadDocument: (currentDocument) => {
                this.refreshConditionFiles(currentDocument.uri);
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
