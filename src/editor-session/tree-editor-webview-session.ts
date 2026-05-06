import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
    normalizeTreeContentForWrite,
    readFileContentFromDisk,
    TreeEditorDocument,
} from "./document-sync";
import { getBehavior3OutputChannel } from "../output-channel";
import { formatConsoleArgs } from "../output-channel";
import { mapNodeDefsIconsForWebview } from "../node-def-icons";
import { ProjectIndex, type VarDeclResult } from "./project-index";
import {
    findB3WorkspacePath,
    getBehaviorProjectRootFsPath,
    getResolvedB3SettingDir,
    resolveNodeDefs,
    resolveWorkspaceNodeColors,
    watchSettingFile,
    watchWorkspaceFile,
} from "../setting-resolver";
import type {
    EditorToHostMessage,
    HostToEditorMessage,
    NodeDef,
} from "../../webview/shared/message-protocol";
import type {
    DocumentMutationSelection,
    HostSelectionState,
    NodeInstanceRef,
} from "../../webview/shared/contracts";
import {
    formatDocumentMutationReducerError,
    isReducibleDocumentMutation,
    reduceDocumentMutation,
} from "../../webview/shared/document-mutation-reducer";
import { isDocumentVersionNewer } from "../../webview/shared/document-version";
import {
    normalizeHostSelectionState,
    normalizeNodeInstanceRef,
    parseWorkdirRelativeJsonPath,
} from "../../webview/shared/protocol";
import { parseWorkspaceModelContent } from "../../webview/shared/schema";
import {
    clonePersistedNode,
    clonePersistedTree,
    findPersistedNodeByStableId,
    parsePersistedTreeContent,
    serializePersistedTree,
} from "../../webview/shared/tree";
import b3path from "../../webview/shared/misc/b3path";
import { setFs } from "../../webview/shared/misc/b3fs";
import {
    collectNodeArgCheckDiagnostics,
    createBuildScriptRuntime,
    createBuildScriptRuntimeWithCheckModules,
    loadRuntimeModule,
    resolveCheckScriptPaths,
} from "../../webview/shared/misc/b3build";
import type { BuildEnv, CheckScriptModule } from "../../webview/shared/misc/b3build";
import { VERSION, type NodeData, type TreeData } from "../../webview/shared/misc/b3type";
import type { InspectorSessionSnapshot } from "../inspector-sidebar-coordinator";

setFs(fs);

/**
 * Per-webview extension-host session.
 * It serializes document mutations, bridges file/watcher events into the
 * webview protocol, and keeps project-level caches in sync with editor state.
 */
export interface ActiveTreeEditorWebview {
    workspaceFsPath: string;
    documentUri: string;
    postMessage: (message: HostToEditorMessage) => Thenable<boolean>;
    dispatchMessage: (
        message: EditorToHostMessage,
        reply?: (message: HostToEditorMessage) => Thenable<boolean>
    ) => Promise<void>;
}

type HostMessageSink = (message: HostToEditorMessage) => Thenable<boolean>;
type MessageSource = "editor" | "external";

interface EditorLiveSettings {
    checkExpr: boolean;
    subtreeEditable: boolean;
    language: "zh" | "en";
    nodeColors?: Record<string, string>;
}

interface TreeEditorSessionState {
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

interface ResolveTreeEditorSessionParams {
    document: TreeEditorDocument;
    webviewPanel: vscode.WebviewPanel;
    viewType: string;
    configureWebview(webview: vscode.Webview, workspaceFolderUri: vscode.Uri): void;
    writeDocumentContentToDisk(targetUri: vscode.Uri, content: string): Promise<string>;
    revertDocument(
        document: TreeEditorDocument,
        cancellation: vscode.CancellationToken
    ): Promise<void>;
    onDidChangeDocument(document: TreeEditorDocument): void;
    addActiveWebview(entry: ActiveTreeEditorWebview): void;
    removeActiveWebview(entry: ActiveTreeEditorWebview): void;
    onInspectorSessionUpdate(snapshot: InspectorSessionSnapshot): void;
    onInspectorSessionDispose(documentUri: string): void;
}

function getWorkdir(documentUri: vscode.Uri): vscode.Uri {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
    if (workspaceFolder) {
        return workspaceFolder.uri;
    }
    return vscode.Uri.file(path.dirname(documentUri.fsPath));
}

function createLiveSettingsResolver(
    workspaceFolderUri: vscode.Uri,
    documentUri: vscode.Uri
): () => Promise<EditorLiveSettings> {
    return async () => {
        const config = vscode.workspace.getConfiguration("behavior3");
        return {
            checkExpr: config.get<boolean>("checkExpr", true),
            subtreeEditable: config.get<boolean>("subtreeEditable", true),
            language: getEditorLanguage(config.get<string>("language", "auto")),
            nodeColors: await resolveWorkspaceNodeColors(workspaceFolderUri, documentUri),
        };
    };
}

function getTreeFileVersion(content: string): string | undefined {
    try {
        const fileData = JSON.parse(content) as { version?: unknown };
        return typeof fileData.version === "string" ? fileData.version : undefined;
    } catch {
        return undefined;
    }
}

function getNewerVersionMessage(
    language: EditorLiveSettings["language"],
    fileVersion: string,
    mode: "warn" | "edit"
): string {
    if (mode === "warn") {
        return language === "zh"
            ? `此文件由新版本 Behavior3(${fileVersion}) 创建，请升级到最新版本。`
            : `This file is created by a newer version of Behavior3(${fileVersion}), please upgrade to the latest version.`;
    }

    return language === "zh"
        ? `此文件由新版本 Behavior3(${fileVersion}) 创建，请升级到最新版本后再编辑。`
        : `This file is created by a newer version of Behavior3(${fileVersion}). Please upgrade to the latest version.`;
}

async function parseUsingVarsFromContent(
    projectIndex: ProjectIndex,
    content: string
): Promise<VarDeclResult | undefined> {
    try {
        return (await projectIndex.buildUsingVars(content)) ?? undefined;
    } catch {
        return undefined;
    }
}

function postVarDeclLoaded(
    postMessage: (message: HostToEditorMessage) => Thenable<boolean>,
    result: VarDeclResult,
    allFiles?: string[]
): Thenable<boolean> {
    return postMessage({
        type: "varDeclLoaded",
        usingVars: Object.values(result.usingVars),
        allFiles,
        importDecls: result.importDecls,
        subtreeDecls: result.subtreeDecls,
    });
}

async function readWorkspaceFileContent(fileUri: vscode.Uri): Promise<string> {
    const openDoc = vscode.workspace.textDocuments.find(
        (doc) => doc.uri.fsPath === fileUri.fsPath || doc.uri.toString() === fileUri.toString()
    );

    if (openDoc) {
        return openDoc.getText();
    }

    const raw = await vscode.workspace.fs.readFile(fileUri);
    return Buffer.from(raw).toString("utf-8");
}

function clearRefreshTimer(timer: ReturnType<typeof setTimeout> | undefined): undefined {
    if (timer) {
        clearTimeout(timer);
    }
    return undefined;
}

const isJsonEqual = (left: unknown, right: unknown): boolean =>
    JSON.stringify(left) === JSON.stringify(right);

const buildPendingSelectionRef = (structuralStableId: string): NodeInstanceRef => ({
    instanceKey: structuralStableId,
    displayId: "",
    structuralStableId,
    sourceStableId: structuralStableId,
    sourceTreePath: null,
    subtreeStack: [],
});

function disposeAll(disposables: vscode.Disposable[]): void {
    for (const disposable of disposables) {
        disposable.dispose();
    }
}

function uriToWorkdirRelative(uri: vscode.Uri, workdir: vscode.Uri): string | undefined {
    if (uri.scheme !== "file") return undefined;
    const rel = path.relative(workdir.fsPath, uri.fsPath).replace(/\\/g, "/");
    if (rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
    return parseWorkdirRelativeJsonPath(rel) ?? undefined;
}

function resolvePathInWorkdir(
    inputPath: string,
    workdir: vscode.Uri,
    options?: { mustBeJson?: boolean }
): vscode.Uri | undefined {
    const parsedPath = parseWorkdirRelativeJsonPath(inputPath);
    if (!parsedPath) {
        return undefined;
    }
    const candidate = path.join(workdir.fsPath, parsedPath);
    if (options?.mustBeJson && path.extname(candidate).toLowerCase() !== ".json") {
        return undefined;
    }
    const rel = path.relative(workdir.fsPath, candidate).replace(/\\/g, "/");
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
        return undefined;
    }
    return vscode.Uri.file(candidate);
}

function getVSCodeTheme(): "dark" | "light" {
    const kind = vscode.window.activeColorTheme.kind;
    return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight
        ? "light"
        : "dark";
}

function getEditorLanguage(setting: string): "zh" | "en" {
    if (setting === "zh" || setting === "en") {
        return setting;
    }
    const envLanguage = vscode.env.language.toLowerCase();
    return envLanguage.startsWith("zh") ? "zh" : "en";
}

function formatRuntimeError(error: unknown): string {
    if (error instanceof Error) {
        return error.stack ?? error.message;
    }
    return String(error);
}

function logRuntimeError(scope: string, error: unknown): void {
    getBehavior3OutputChannel().error(`[${scope}] ${formatRuntimeError(error)}`);
}

function logAsyncRuntimeError(scope: string): (error: unknown) => void {
    return (error) => logRuntimeError(scope, error);
}

function createBuildScriptLogger(): BuildEnv["logger"] {
    const write =
        (level: "debug" | "info" | "warn" | "error") =>
        (...args: unknown[]) => {
            getBehavior3OutputChannel()[level](formatConsoleArgs(args));
        };

    return {
        log: write("info"),
        debug: write("debug"),
        info: write("info"),
        warn: write("warn"),
        error: write("error"),
    };
}

const toNodeData = (node: unknown): NodeData => node as NodeData;

export async function resolveTreeEditorSession({
    document,
    webviewPanel,
    viewType,
    configureWebview,
    writeDocumentContentToDisk,
    revertDocument,
    onDidChangeDocument,
    addActiveWebview,
    removeActiveWebview,
    onInspectorSessionUpdate,
    onInspectorSessionDispose,
}: ResolveTreeEditorSessionParams): Promise<void> {
    const workspaceFolderUri = getWorkdir(document.uri);
    const projectRootUri = vscode.Uri.file(
        getBehaviorProjectRootFsPath(document.uri, workspaceFolderUri)
    );
    const projectIndex = new ProjectIndex(projectRootUri);
    const resolveLiveSettings = createLiveSettingsResolver(workspaceFolderUri, document.uri);
    const [nodeDefs, settingDir, currentSettings] = await Promise.all([
        resolveNodeDefs(workspaceFolderUri, document.uri),
        getResolvedB3SettingDir(workspaceFolderUri, document.uri),
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
        sharedSelection: { kind: "tree" },
        selectionRevision: 0,
        inspectorContentSyncKind: "reload",
    };
    const documentSession = document.sessionState;
    const buildDocumentSessionMessage = () => documentSession.getSnapshot();

    configureWebview(webviewPanel.webview, workspaceFolderUri);

    const postMessage = (message: HostToEditorMessage) => webviewPanel.webview.postMessage(message);
    const mapDefsForWebview = (defs: NodeDef[] = state.nodeDefs) =>
        mapNodeDefsIconsForWebview(
            webviewPanel.webview,
            workspaceFolderUri,
            state.settingDir,
            defs
        );

    const buildInspectorVarsMessage = (): Extract<
        HostToEditorMessage,
        { type: "varDeclLoaded" }
    > => ({
        type: "varDeclLoaded",
        usingVars: Object.values(state.latestVarDecls.usingVars),
        allFiles: state.latestAllFiles,
        importDecls: state.latestVarDecls.importDecls,
        subtreeDecls: state.latestVarDecls.subtreeDecls,
    });

    const buildDocumentSnapshotMessage = (opts?: {
        content?: string;
        documentSession?: ReturnType<typeof buildDocumentSessionMessage>;
        syncKind?: "update" | "reload";
        selection?: HostSelectionState;
    }): Extract<HostToEditorMessage, { type: "documentSnapshotChanged" }> => ({
        type: "documentSnapshotChanged",
        snapshot: {
            content: opts?.content ?? document.content,
            documentSession: opts?.documentSession ?? buildDocumentSessionMessage(),
            selection: opts?.selection ?? state.sharedSelection,
            syncKind: opts?.syncKind ?? state.inspectorContentSyncKind,
        },
    });

    const buildHostSelectionFromMutationSelection = (
        selection: DocumentMutationSelection
    ): HostSelectionState =>
        selection.kind === "tree"
            ? { kind: "tree" }
            : {
                  kind: "node",
                  ref: buildPendingSelectionRef(selection.structuralStableId),
              };

    const updateSharedSelection = (selection: HostSelectionState): boolean => {
        const normalized = normalizeHostSelectionState(selection);
        if (isJsonEqual(state.sharedSelection, normalized)) {
            return false;
        }
        state.sharedSelection = normalized;
        state.selectionRevision += 1;
        return true;
    };

    const notifyInspectorSessionUpdate = () => {
        const documentSession = buildDocumentSessionMessage();
        onInspectorSessionUpdate({
            documentUri: document.uri.toString(),
            initMessage: {
                type: "init",
                content: document.content,
                filePath: document.uri.fsPath,
                workdir: projectRootUri.fsPath,
                nodeDefs: mapDefsForWebview(),
                checkExpr: state.currentSettings.checkExpr,
                subtreeEditable: state.currentSettings.subtreeEditable,
                language: state.currentSettings.language,
                theme: getVSCodeTheme(),
                allFiles: state.latestAllFiles,
                nodeColors: state.currentSettings.nodeColors,
                documentSession,
                selection: state.sharedSelection,
            },
            varsMessage: buildInspectorVarsMessage(),
            documentSnapshot: buildDocumentSnapshotMessage({
                documentSession,
            }).snapshot,
            selectionRevision: state.selectionRevision,
        });
    };

    const refreshLatestVarDeclsFromContent = async (content: string): Promise<void> => {
        const [allFiles, result] = await Promise.all([
            projectIndex.getAllFiles(),
            parseUsingVarsFromContent(projectIndex, content),
        ]);

        state.latestAllFiles = allFiles;
        state.latestVarDecls = result ?? {
            usingVars: {},
            importDecls: [],
            subtreeDecls: [],
        };
    };

    const activeWebviewEntry: ActiveTreeEditorWebview = {
        workspaceFsPath: workspaceFolderUri.fsPath,
        documentUri: document.uri.toString(),
        postMessage,
        dispatchMessage: async (message, reply = postMessage) => {
            await dispatchEditorMessage(message, reply, "external");
        },
    };
    addActiveWebview(activeWebviewEntry);
    let mainDocumentOperationQueue: Promise<unknown> = Promise.resolve();
    const createNodeCheckRuntime = async () => {
        const workspaceFile = findB3WorkspacePath(document.uri, workspaceFolderUri);
        if (!workspaceFile) {
            return {
                buildScriptRuntime: createBuildScriptRuntime(null, {
                    fs,
                    path: b3path,
                    workdir: workspaceFolderUri.fsPath,
                    nodeDefs: new Map(state.nodeDefs.map((def) => [def.name, def] as const)),
                    logger: createBuildScriptLogger(),
                }),
                treePath: workspaceFolderUri.fsPath,
            };
        }

        const workspaceText = await readWorkspaceFileContent(vscode.Uri.file(workspaceFile));
        const workspaceModel = parseWorkspaceModelContent(workspaceText);
        const buildScript = workspaceModel.settings.buildScript;
        const checkScripts = workspaceModel.settings.checkScripts ?? [];
        const workdir = path.dirname(workspaceFile).replace(/\\/g, "/");
        const env: BuildEnv = {
            fs,
            path: b3path,
            workdir,
            nodeDefs: new Map(state.nodeDefs.map((def) => [def.name, def] as const)),
            logger: createBuildScriptLogger(),
        };

        let buildScriptModule: unknown = null;
        let hasRuntimeLoadError = false;
        if (buildScript) {
            const scriptPath = path.join(workdir, buildScript);
            buildScriptModule = await loadRuntimeModule(scriptPath, { debug: false });
            hasRuntimeLoadError = !buildScriptModule;
        }

        const checkScriptModules: CheckScriptModule[] = [];
        const checkScriptPaths = resolveCheckScriptPaths(workdir, checkScripts);
        hasRuntimeLoadError = hasRuntimeLoadError || checkScriptPaths.missingPatterns.length > 0;
        for (const pattern of checkScriptPaths.missingPatterns) {
            env.logger.error(`checkScripts pattern matched no files: ${pattern}`);
        }
        for (const scriptPath of checkScriptPaths.paths) {
            const moduleExports = await loadRuntimeModule(scriptPath, { debug: false });
            if (!moduleExports) {
                env.logger.error(`'${scriptPath}' is not a valid check script`);
                hasRuntimeLoadError = true;
                continue;
            }
            checkScriptModules.push({ path: scriptPath, moduleExports });
        }

        const buildScriptRuntime = createBuildScriptRuntimeWithCheckModules(
            buildScriptModule,
            checkScriptModules,
            env
        );
        return {
            buildScriptRuntime: {
                ...buildScriptRuntime,
                hasError: buildScriptRuntime.hasError || hasRuntimeLoadError,
            },
            treePath: workdir,
        };
    };

    const handleValidateNodeChecksMessage = async (
        msg: Extract<EditorToHostMessage, { type: "validateNodeChecks" }>,
        reply: HostMessageSink = postMessage
    ) => {
        try {
            const runtimeResult = await createNodeCheckRuntime();
            const tree = JSON.parse(msg.content) as TreeData;
            const diagnostics = collectNodeArgCheckDiagnostics({
                tree,
                treePath: msg.treePath || runtimeResult.treePath,
                env: {
                    fs,
                    path: b3path,
                    workdir: runtimeResult.treePath,
                    nodeDefs: new Map(state.nodeDefs.map((def) => [def.name, def] as const)),
                    logger: createBuildScriptLogger(),
                },
                checkers: runtimeResult.buildScriptRuntime.nodeArgCheckers,
                targets: msg.nodes.map((entry) => ({
                    instanceKey: entry.instanceKey,
                    treePath: entry.treePath,
                    node: toNodeData(entry.node),
                })),
            });
            await reply({
                type: "validateNodeChecksResult",
                requestId: msg.requestId,
                diagnostics: diagnostics
                    .filter(
                        (diagnostic): diagnostic is typeof diagnostic & { instanceKey: string } =>
                            typeof diagnostic.instanceKey === "string"
                    )
                    .map((diagnostic) => ({
                        instanceKey: diagnostic.instanceKey,
                        argName: diagnostic.argName,
                        checker: diagnostic.checker,
                        message: diagnostic.message,
                    })),
                error: runtimeResult.buildScriptRuntime.hasError
                    ? "checker runtime has errors"
                    : undefined,
            });
        } catch (error) {
            await reply({
                type: "validateNodeChecksResult",
                requestId: msg.requestId,
                diagnostics: [],
                error: String(error),
            });
        }
    };

    /**
     * Main-document writes, reloads, and revert/save flows all funnel through a
     * single queue so watcher callbacks and webview messages cannot race each
     * other and leave the in-memory document in an impossible state.
     */
    const enqueueMainDocumentOperation = <T>(operation: () => Promise<T> | T): Promise<T> => {
        const task = mainDocumentOperationQueue.then(operation, operation);
        mainDocumentOperationQueue = task.then(
            () => undefined,
            () => undefined
        );
        return task;
    };

    const refreshSettings = async ({
        refreshDefs = false,
    }: { refreshDefs?: boolean } = {}): Promise<void> => {
        if (refreshDefs) {
            const [freshDefs, freshSettingDir] = await Promise.all([
                resolveNodeDefs(workspaceFolderUri, document.uri),
                getResolvedB3SettingDir(workspaceFolderUri, document.uri),
            ]);
            state.nodeDefs = freshDefs;
            state.settingDir = freshSettingDir;
        }

        state.currentSettings = await resolveLiveSettings();
        await postMessage({
            type: "settingLoaded",
            nodeDefs: mapDefsForWebview(),
            settings: state.currentSettings,
        });
        notifyInspectorSessionUpdate();
    };

    const invalidateSubtreeRefs = () => {
        state.cachedSubtreeRefs = null;
    };

    /** Cache the transitive subtree closure of the current main document. */
    const refreshTrackedSubtreeRefs = async () => {
        state.cachedSubtreeRefs = await projectIndex.getTransitiveSubtreeRelativePaths(
            document.content
        );
    };

    const updateFileVersionState = (content: string, opts?: { showWarning?: boolean }): void => {
        state.fileVersionIsNewer = false;
        state.newerFileVersion = null;

        const fileVersion = getTreeFileVersion(content);
        if (!fileVersion || !isDocumentVersionNewer(fileVersion)) {
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

    const isTrackedSubtreeDocument = (uri: vscode.Uri): boolean => {
        const rel = uriToWorkdirRelative(uri, projectRootUri);
        return !!rel && Boolean(state.cachedSubtreeRefs?.has(rel));
    };

    const flushParentSubtreeRefresh = () => {
        void (async () => {
            await refreshLatestVarDeclsFromContent(document.content);
            await postMessage(buildInspectorVarsMessage());
            notifyInspectorSessionUpdate();
            await postMessage({ type: "subtreeFileChanged" });
        })();
    };

    const isMainDocumentUri = (uri: vscode.Uri): boolean =>
        uri.toString() === document.uri.toString();

    const scheduleParentSubtreeRefresh = () => {
        state.subtreeRefreshTimer = clearRefreshTimer(state.subtreeRefreshTimer);
        state.subtreeRefreshTimer = setTimeout(() => {
            state.subtreeRefreshTimer = undefined;
            flushParentSubtreeRefresh();
        }, 450);
    };

    const scheduleTrackedSubtreeRefresh = (uri: vscode.Uri): void => {
        if (isMainDocumentUri(uri) || !isTrackedSubtreeDocument(uri)) {
            return;
        }
        scheduleParentSubtreeRefresh();
    };

    const flushTrackedSubtreeRefresh = (uri: vscode.Uri): void => {
        if (isMainDocumentUri(uri) || !isTrackedSubtreeDocument(uri)) {
            return;
        }
        state.subtreeRefreshTimer = clearRefreshTimer(state.subtreeRefreshTimer);
        flushParentSubtreeRefresh();
    };

    /**
     * Normalize webview JSON before it becomes the document source of truth.
     * This is the earliest point where we can refresh subtree tracking and
     * file-version state for subsequent watcher/save logic.
     */
    const applyContentFromWebview = (content: string): boolean => {
        const normalizedContent = normalizeTreeContentForWrite(content, document.uri.fsPath);
        if (document.content === normalizedContent) {
            return false;
        }

        const changed = document.updateContent(normalizedContent, { markDirty: true });
        if (!changed) {
            return false;
        }

        state.inspectorContentSyncKind = "update";
        documentSession.applyCommittedSnapshot(normalizedContent);
        invalidateSubtreeRefs();
        void refreshTrackedSubtreeRefs();
        updateFileVersionState(normalizedContent);
        onDidChangeDocument(document);
        return true;
    };

    const fanoutDocumentSnapshot = async (opts?: {
        syncKind?: "update" | "reload";
        refreshVars?: boolean;
    }): Promise<void> => {
        await postMessage(
            buildDocumentSnapshotMessage({
                syncKind: opts?.syncKind,
            })
        );
        if (opts?.refreshVars !== false) {
            await refreshLatestVarDeclsFromContent(document.content);
            await postMessage(buildInspectorVarsMessage());
        }
        notifyInspectorSessionUpdate();
    };

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

    const getActiveNewerFileEditMessage = (): string | null => {
        updateFileVersionState(document.content);
        if (!state.fileVersionIsNewer) {
            return null;
        }

        const fileVersion = state.newerFileVersion ?? getTreeFileVersion(document.content) ?? "";
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

    const getExistingNewerFileEditMessage = async (fileUri: vscode.Uri): Promise<string | null> => {
        let content: string;
        try {
            content = await readWorkspaceFileContent(fileUri);
        } catch {
            return null;
        }

        const fileVersion = getTreeFileVersion(content);
        if (!fileVersion || !isDocumentVersionNewer(fileVersion)) {
            return null;
        }

        const message = getNewerVersionMessage(state.currentSettings.language, fileVersion, "edit");
        return message;
    };

    /**
     * Handshake entry point: send immutable bootstrap state first, then follow
     * up with computed var/subtree metadata that depends on project indexing.
     */
    const handleReadyMessage = async (reply: HostMessageSink = postMessage): Promise<void> => {
        const theme = getVSCodeTheme();
        const content = document.content;

        updateFileVersionState(content, { showWarning: true });

        await Promise.all([refreshLatestVarDeclsFromContent(content), refreshTrackedSubtreeRefs()]);

        await reply({
            type: "init",
            content,
            filePath: document.uri.fsPath,
            workdir: projectRootUri.fsPath,
            nodeDefs: mapDefsForWebview(),
            checkExpr: state.currentSettings.checkExpr,
            subtreeEditable: state.currentSettings.subtreeEditable,
            language: state.currentSettings.language,
            theme,
            allFiles: state.latestAllFiles,
            nodeColors: state.currentSettings.nodeColors,
            documentSession: buildDocumentSessionMessage(),
            selection: state.sharedSelection,
        });

        await postVarDeclLoaded(reply, state.latestVarDecls, state.latestAllFiles);

        notifyInspectorSessionUpdate();
    };

    const handleSaveSelectedAsSubtreeMutation = async (
        msg: Extract<EditorToHostMessage, { type: "mutateDocument" }>
    ): Promise<
        | {
              kind: "handled";
              reply: Extract<HostToEditorMessage, { type: "mutateDocumentResult" }>;
          }
        | { kind: "skip" }
    > => {
        if (msg.mutation.type !== "saveSelectedAsSubtree") {
            return { kind: "skip" };
        }

        const currentTree = parsePersistedTreeContent(document.content, document.uri.fsPath);
        if (currentTree.root.uuid === msg.mutation.payload.target.structuralStableId) {
            return {
                kind: "handled",
                reply: {
                    type: "mutateDocumentResult",
                    requestId: msg.requestId,
                    success: false,
                    error:
                        state.currentSettings.language === "zh"
                            ? "根节点不能另存为 subtree。"
                            : "The root node cannot be saved as a subtree.",
                },
            };
        }

        const targetNode = findPersistedNodeByStableId(
            currentTree.root,
            msg.mutation.payload.target.structuralStableId
        );
        if (!targetNode || targetNode.path) {
            return {
                kind: "handled",
                reply: {
                    type: "mutateDocumentResult",
                    requestId: msg.requestId,
                    success: false,
                    error:
                        state.currentSettings.language === "zh"
                            ? "未找到可另存为 subtree 的目标节点。"
                            : "The target node could not be saved as a subtree.",
                },
            };
        }

        const subtreeModel = {
            version: VERSION,
            name: "subtree",
            prefix: "",
            desc: msg.mutation.payload.subtreeRoot.desc,
            export: true,
            group: [],
            variables: {
                imports: [],
                locals: [],
            },
            custom: {},
            overrides: {},
            root: clonePersistedNode(msg.mutation.payload.subtreeRoot),
        };

        const saveResult = await saveSubtreeContentAs(
            serializePersistedTree(subtreeModel),
            msg.mutation.payload.suggestedBaseName
        );
        if (saveResult.error) {
            return {
                kind: "handled",
                reply: {
                    type: "mutateDocumentResult",
                    requestId: msg.requestId,
                    success: false,
                    error: saveResult.error,
                },
            };
        }

        if (!saveResult.savedPath) {
            return {
                kind: "handled",
                reply: {
                    type: "mutateDocumentResult",
                    requestId: msg.requestId,
                    success: true,
                },
            };
        }

        const savedPath = parseWorkdirRelativeJsonPath(saveResult.savedPath);
        if (!savedPath) {
            return {
                kind: "handled",
                reply: {
                    type: "mutateDocumentResult",
                    requestId: msg.requestId,
                    success: false,
                    error: "Host returned an invalid saved subtree path.",
                },
            };
        }

        const nextTree = clonePersistedTree(currentTree);
        const nextTargetNode = findPersistedNodeByStableId(
            nextTree.root,
            msg.mutation.payload.target.structuralStableId
        );
        if (!nextTargetNode) {
            return {
                kind: "handled",
                reply: {
                    type: "mutateDocumentResult",
                    requestId: msg.requestId,
                    success: false,
                    error:
                        state.currentSettings.language === "zh"
                            ? "提交 subtree 保存结果时未找到目标节点。"
                            : "The target node could not be found after saving the subtree.",
                },
            };
        }

        nextTargetNode.path = savedPath;
        nextTargetNode.children = undefined;
        const nextSelection: DocumentMutationSelection = {
            kind: "node",
            structuralStableId: nextTargetNode.uuid,
        };
        const changed = applyContentFromWebview(serializePersistedTree(nextTree));
        if (changed) {
            updateSharedSelection(buildHostSelectionFromMutationSelection(nextSelection));
            await fanoutDocumentSnapshot({
                syncKind: "update",
            });
        }

        return {
            kind: "handled",
            reply: {
                type: "mutateDocumentResult",
                requestId: msg.requestId,
                success: true,
            },
        };
    };

    const handleMutateDocumentMessage = async (
        msg: Extract<EditorToHostMessage, { type: "mutateDocument" }>,
        reply: HostMessageSink = postMessage,
        _source: MessageSource = "editor"
    ): Promise<void> => {
        await enqueueMainDocumentOperation(async () => {
            const editBlockedMessage = blockEditingForNewerFile();
            if (editBlockedMessage) {
                await reply({
                    type: "mutateDocumentResult",
                    requestId: msg.requestId,
                    success: false,
                    error: editBlockedMessage,
                } satisfies HostToEditorMessage);
                return;
            }

            const saveSelectedAsSubtreeResult =
                await handleSaveSelectedAsSubtreeMutation(msg);
            if (saveSelectedAsSubtreeResult.kind === "handled") {
                await reply(saveSelectedAsSubtreeResult.reply);
                return;
            }

            if (!isReducibleDocumentMutation(msg.mutation)) {
                await reply({
                    type: "mutateDocumentResult",
                    requestId: msg.requestId,
                    success: false,
                    error: "Unsupported document mutation.",
                } satisfies HostToEditorMessage);
                return;
            }

            let reduced: ReturnType<typeof reduceDocumentMutation>;
            try {
                const currentTree = parsePersistedTreeContent(document.content, document.uri.fsPath);
                reduced = reduceDocumentMutation(msg.mutation, {
                    tree: currentTree,
                    nodeDefs: state.nodeDefs,
                });
            } catch (error) {
                await reply({
                    type: "mutateDocumentResult",
                    requestId: msg.requestId,
                    success: false,
                    error: String(error),
                } satisfies HostToEditorMessage);
                return;
            }

            if (reduced.status === "error") {
                await reply({
                    type: "mutateDocumentResult",
                    requestId: msg.requestId,
                    success: false,
                    error: formatDocumentMutationReducerError(
                        reduced.error,
                        state.currentSettings.language
                    ),
                } satisfies HostToEditorMessage);
                return;
            }

            if (reduced.status === "noop") {
                await reply({
                    type: "mutateDocumentResult",
                    requestId: msg.requestId,
                    success: true,
                } satisfies HostToEditorMessage);
                return;
            }

            const changed = applyContentFromWebview(serializePersistedTree(reduced.tree));
            if (changed) {
                if (reduced.nextSelection) {
                    updateSharedSelection(
                        buildHostSelectionFromMutationSelection(reduced.nextSelection)
                    );
                }
                await fanoutDocumentSnapshot({
                    syncKind: "update",
                });
            }

            await reply({
                type: "mutateDocumentResult",
                requestId: msg.requestId,
                success: true,
            } satisfies HostToEditorMessage);
        });
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

    const handleHistoryNavigationMessage = async (direction: "undo" | "redo"): Promise<void> => {
        await enqueueMainDocumentOperation(async () => {
            const editBlockedMessage = blockEditingForNewerFile();
            if (editBlockedMessage) {
                return;
            }

            const snapshot =
                direction === "undo" ? documentSession.undo() : documentSession.redo();
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

    const handleReadFileMessage = async (
        msg: Extract<EditorToHostMessage, { type: "readFile" }>,
        reply: HostMessageSink = postMessage
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
        reply: HostMessageSink = postMessage
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
        reply: HostMessageSink = postMessage
    ): Promise<void> => {
        const result = await saveSubtreeContentAs(msg.content, msg.suggestedBaseName);
        await reply({
            type: "saveSubtreeAsResult",
            requestId: msg.requestId,
            savedPath: result.savedPath,
            error: result.error,
        });
    };

    const saveSubtreeContentAs = async (
        content: string,
        suggestedBaseName: string
    ): Promise<{ savedPath: string | null; error?: string }> => {
        try {
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

    const handleWebviewLogMessage = (
        msg: Extract<EditorToHostMessage, { type: "webviewLog" }>
    ): void => {
        const out = getBehavior3OutputChannel();
        switch (msg.level) {
            case "debug":
                out.debug(msg.message);
                break;
            case "warn":
                out.warn(msg.message);
                break;
            case "error":
                out.error(msg.message);
                break;
            case "log":
            case "info":
            default:
                out.info(msg.message);
                break;
        }
    };

    const handleSelectTreeMessage = async (): Promise<void> => {
        await enqueueMainDocumentOperation(async () => {
            if (!updateSharedSelection({ kind: "tree" })) {
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
            if (
                !updateSharedSelection({
                    kind: "node",
                    ref: normalizeNodeInstanceRef(msg.target),
                })
            ) {
                return;
            }
            await fanoutDocumentSnapshot({
                refreshVars: false,
            });
        });
    };

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
                handleWebviewLogMessage(msg);
                return;

            case "readFile":
                await handleReadFileMessage(msg, reply);
                return;

            case "saveSubtree":
                await handleSaveSubtreeMessage(msg, reply);
                return;

            case "saveSubtreeAs":
                await handleSaveSubtreeAsMessage(msg, reply);
                return;
        }
    };

    const mainDocumentWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(
            path.dirname(document.uri.fsPath),
            path.basename(document.uri.fsPath)
        )
    );
    const subtreeFileWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(projectRootUri.fsPath, "**/*.json")
    );

    /**
     * Watchers keep the project index warm and notify the current editor only
     * when affected files belong to the active document's transitive subtree set.
     */
    const sessionDisposables: vscode.Disposable[] = [
        watchSettingFile(workspaceFolderUri, () => {
            void refreshSettings({ refreshDefs: true }).catch(
                logAsyncRuntimeError("watch setting")
            );
        }),
        watchWorkspaceFile(workspaceFolderUri, () => {
            void refreshSettings().catch(logAsyncRuntimeError("watch workspace"));
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (!event.affectsConfiguration("behavior3")) {
                return;
            }
            void refreshSettings().catch(logAsyncRuntimeError("configuration changed"));
        }),
        mainDocumentWatcher,
        subtreeFileWatcher,
        vscode.workspace.onDidChangeTextDocument((event) => {
            projectIndex.invalidateFile(event.document.uri);
            if (event.contentChanges.length > 0) {
                scheduleTrackedSubtreeRefresh(event.document.uri);
            }
        }),
        vscode.workspace.onDidSaveTextDocument((savedDocument) => {
            projectIndex.invalidateFile(savedDocument.uri);
            flushTrackedSubtreeRefresh(savedDocument.uri);
        }),
        vscode.window.onDidChangeActiveColorTheme(() => {
            void postMessage({
                type: "themeChanged",
                theme: getVSCodeTheme(),
            }).then(undefined, logAsyncRuntimeError("theme changed"));
        }),
    ];

    sessionDisposables.push(
        /**
         * Webview messages are intentionally thin here: route, serialize when
         * needed, and keep protocol branching close to the session lifecycle.
         */
        webviewPanel.webview.onDidReceiveMessage(async (msg: EditorToHostMessage) => {
            try {
                await dispatchEditorMessage(msg, postMessage, "editor");
            } catch (error) {
                logRuntimeError(`webview message:${msg.type}`, error);
            }
        })
    );

    sessionDisposables.push(
        mainDocumentWatcher.onDidChange(() => {
            projectIndex.invalidateFile(document.uri);
            void handleMainDocumentFileChange();
        }),
        mainDocumentWatcher.onDidCreate(() => {
            projectIndex.invalidateFile(document.uri);
            void handleMainDocumentFileChange();
        }),
        subtreeFileWatcher.onDidChange((uri) => {
            projectIndex.invalidateFile(uri);
            scheduleTrackedSubtreeRefresh(uri);
        }),
        subtreeFileWatcher.onDidCreate((uri) => {
            projectIndex.invalidateFile(uri);
            scheduleTrackedSubtreeRefresh(uri);
        }),
        subtreeFileWatcher.onDidDelete((uri) => {
            projectIndex.invalidateFile(uri);
            scheduleTrackedSubtreeRefresh(uri);
        })
    );

    webviewPanel.onDidDispose(() => {
        state.subtreeRefreshTimer = clearRefreshTimer(state.subtreeRefreshTimer);
        projectIndex.clear();
        removeActiveWebview(activeWebviewEntry);
        onInspectorSessionDispose(document.uri.toString());
        disposeAll(sessionDisposables);
    });
}
