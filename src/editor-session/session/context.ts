import * as vscode from "vscode";
import { mapNodeDefsIconsForWebview } from "../../node-def-icons";
import {
    getBehaviorProjectRootFsPath,
    getResolvedB3SettingDir,
    resolveNodeDefs,
} from "../../setting-resolver";
import type { InspectorSessionSnapshot } from "../../inspector-sidebar-coordinator";
import type { HostSelectionState, NodeInstanceRef } from "../../../webview/shared/contracts";
import type {
    EditorToHostMessage,
    HostToEditorMessage,
    NodeDef,
} from "../../../webview/shared/message-protocol";
import { normalizeHostSelectionState } from "../../../webview/shared/protocol";
import { TreeEditorDocument } from "../document/document-sync";
import { createSerialOperationQueue, type SerialOperationQueue } from "../runtime/operation-queue";
import { getWorkdir } from "../files/paths";
import { resolveBackingFileUri } from "../../condition-files";
import { ProjectIndex, type VarDeclResult } from "../project/project-index";
import {
    createLiveSettingsResolver,
    type EditorLiveSettings,
} from "../settings/live-settings";
import type { DocumentSessionSnapshot } from "../document/document-session-state";

export type HostMessageSink = (message: HostToEditorMessage) => Thenable<boolean>;
export type MessageSource = "editor" | "external";

export interface ActiveTreeEditorWebview {
    workspaceFsPath: string;
    documentUri: string;
    /** Re-read the document from its backing file, as for an outside change. */
    reloadFromBackingFile: () => Promise<void>;
    postMessage: (message: HostToEditorMessage) => Thenable<boolean>;
    dispatchMessage: (
        message: EditorToHostMessage,
        reply?: (message: HostToEditorMessage) => Thenable<boolean>
    ) => Promise<void>;
}

export interface TreeEditorSessionState {
    nodeDefs: NodeDef[];
    settingDir?: string;
    currentSettings: EditorLiveSettings;
    fileVersionIsNewer: boolean;
    newerFileVersion: string | null;
    cachedSubtreeRefs: Set<string> | null;
    subtreeRefreshTimer?: ReturnType<typeof setTimeout>;
    latestAllFiles: string[];
    latestVarDecls: VarDeclResult;
    sharedSelection: HostSelectionState;
    selectionRevision: number;
    inspectorContentSyncKind: "update" | "reload";
}

export interface ResolveTreeEditorSessionParams {
    document: TreeEditorDocument;
    webviewPanel: vscode.WebviewPanel;
    viewType: string;
    initialSelection: HostSelectionState;
    initialRevealTarget: NodeInstanceRef | null;
    configureWebview(webview: vscode.Webview, workspaceFolderUri: vscode.Uri): void;
    writeDocumentContentToDisk(targetUri: vscode.Uri, content: string): Promise<string>;
    revertDocument(
        document: TreeEditorDocument,
        cancellation: vscode.CancellationToken
    ): Promise<void>;
    onDidChangeDocument(document: TreeEditorDocument): void;
    /** The document content was replaced from disk (outside change). */
    onDidReloadDocument(document: TreeEditorDocument): void;
    addActiveWebview(entry: ActiveTreeEditorWebview): void;
    removeActiveWebview(entry: ActiveTreeEditorWebview): void;
    stageDocumentSelection(documentUri: string, selection: HostSelectionState): void;
    onInspectorSessionUpdate(snapshot: InspectorSessionSnapshot): void;
    onInspectorSessionDispose(documentUri: string): void;
}

export interface TreeEditorSessionContext extends ResolveTreeEditorSessionParams {
    /** Real file used to locate the workspace and settings; the host file for condition files. */
    locationUri: vscode.Uri;
    workspaceFolderUri: vscode.Uri;
    projectRootUri: vscode.Uri;
    projectIndex: ProjectIndex;
    state: TreeEditorSessionState;
    documentSession: TreeEditorDocument["sessionState"];
    resolveLiveSettings: () => Promise<EditorLiveSettings>;
    postMessage: HostMessageSink;
    mapDefsForWebview: (defs?: NodeDef[]) => NodeDef[];
    buildDocumentSessionMessage: () => DocumentSessionSnapshot;
    enqueueMainDocumentOperation: SerialOperationQueue;
}

export async function createTreeEditorSessionContext(
    params: ResolveTreeEditorSessionParams
): Promise<TreeEditorSessionContext> {
    const locationUri = resolveBackingFileUri(params.document.uri);
    const workspaceFolderUri = getWorkdir(locationUri);
    const projectRootUri = vscode.Uri.file(
        getBehaviorProjectRootFsPath(locationUri, workspaceFolderUri)
    );
    const projectIndex = new ProjectIndex(projectRootUri);
    const resolveLiveSettings = createLiveSettingsResolver(workspaceFolderUri, locationUri);
    const [nodeDefs, settingDir, currentSettings] = await Promise.all([
        resolveNodeDefs(workspaceFolderUri, locationUri),
        getResolvedB3SettingDir(workspaceFolderUri, locationUri),
        resolveLiveSettings(),
    ]);

    const state: TreeEditorSessionState = {
        nodeDefs,
        settingDir,
        currentSettings,
        fileVersionIsNewer: false,
        newerFileVersion: null,
        cachedSubtreeRefs: null,
        latestAllFiles: [],
        latestVarDecls: {
            usingVars: {},
            importDecls: [],
            subtreeDecls: [],
        },
        sharedSelection: normalizeHostSelectionState(params.initialSelection),
        selectionRevision: 0,
        inspectorContentSyncKind: "reload",
    };
    const documentSession = params.document.sessionState;
    const buildDocumentSessionMessage = () => documentSession.getSnapshot();

    params.configureWebview(params.webviewPanel.webview, workspaceFolderUri);

    const postMessage = (message: HostToEditorMessage) =>
        params.webviewPanel.webview.postMessage(message);
    const mapDefsForWebview = (defs: NodeDef[] = state.nodeDefs) =>
        mapNodeDefsIconsForWebview(
            params.webviewPanel.webview,
            workspaceFolderUri,
            state.settingDir,
            defs
        );

    return {
        ...params,
        locationUri,
        workspaceFolderUri,
        projectRootUri,
        projectIndex,
        state,
        documentSession,
        resolveLiveSettings,
        postMessage,
        mapDefsForWebview,
        buildDocumentSessionMessage,
        enqueueMainDocumentOperation: createSerialOperationQueue(),
    };
}
