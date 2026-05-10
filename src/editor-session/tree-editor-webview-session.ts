import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
    normalizeTreeContentForWrite,
    readFileContentFromDisk,
    TreeEditorDocument,
} from "./document-sync";
import { getBehavior3OutputChannel } from "../output-channel";
import { mapNodeDefsIconsForWebview } from "../node-def-icons";
import { ProjectIndex, type VarDeclResult } from "./project-index";
import { getNewerFileVersion, getNewerVersionMessage } from "./session-file-version";
import { logAsyncRuntimeError, logRuntimeError } from "./session-logging";
import {
    createSessionBuildScriptEnv,
    createSessionNodeCheckRuntime,
} from "./session-node-check-runtime";
import { createSerialOperationQueue } from "./operation-queue";
import {
    getWorkdir,
    readWorkspaceFileContent,
    uriToWorkdirRelative,
} from "./session-paths";
import { applySharedSelectionState, buildPendingSelectionRef } from "./session-selection";
import { getEditorLanguage, getVSCodeTheme, type EditorLanguage } from "./session-settings";
import { readExistingNewerFileEditMessage } from "./session-subtree-save-guards";
import { createSessionFileRequestHandlers } from "./session-file-request-handlers";
import {
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
    HostSelectionState,
    NodeInstanceRef,
    PersistedNodeModel,
} from "../../webview/shared/contracts";
import {
    type DocumentMutationSelection,
    formatDocumentMutationReducerError,
    isReducibleDocumentMutation,
    reduceDocumentMutation,
} from "../../webview/shared/document";
import {
    normalizeHostSelectionState,
    normalizeNodeInstanceRef,
    parseWorkdirRelativeJsonPath,
} from "../../webview/shared/protocol";
import {
    clonePersistedNode,
    clonePersistedTree,
    findPersistedNodeByStableId,
    loadSubtreeSourceCache,
    parsePersistedTreeContent,
    pruneStaleSubtreeOverrides,
    serializePersistedTree,
    walkPersistedNodes,
} from "../../webview/shared/tree";
import { isJsonEqual } from "../../webview/shared/json";
import { setFs } from "../../webview/shared/b3fs";
import { collectNodeArgCheckDiagnostics } from "../../webview/shared/b3build";
import { VERSION, type NodeData, type TreeData } from "../../webview/shared/b3type";
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
    language: EditorLanguage;
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
    initialSelection: HostSelectionState;
    initialRevealTarget: NodeInstanceRef | null;
    configureWebview(webview: vscode.Webview, workspaceFolderUri: vscode.Uri): void;
    writeDocumentContentToDisk(targetUri: vscode.Uri, content: string): Promise<string>;
    revertDocument(
        document: TreeEditorDocument,
        cancellation: vscode.CancellationToken
    ): Promise<void>;
    onDidChangeDocument(document: TreeEditorDocument): void;
    addActiveWebview(entry: ActiveTreeEditorWebview): void;
    removeActiveWebview(entry: ActiveTreeEditorWebview): void;
    stageDocumentSelection(documentUri: string, selection: HostSelectionState): void;
    onInspectorSessionUpdate(snapshot: InspectorSessionSnapshot): void;
    onInspectorSessionDispose(documentUri: string): void;
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

function clearRefreshTimer(timer: ReturnType<typeof setTimeout> | undefined): undefined {
    if (timer) {
        clearTimeout(timer);
    }
    return undefined;
}

function disposeAll(disposables: vscode.Disposable[]): void {
    for (const disposable of disposables) {
        disposable.dispose();
    }
}

const toNodeData = (node: unknown): NodeData => node as NodeData;

export async function resolveTreeEditorSession({
    document,
    webviewPanel,
    viewType,
    initialSelection,
    initialRevealTarget,
    configureWebview,
    writeDocumentContentToDisk,
    revertDocument,
    onDidChangeDocument,
    addActiveWebview,
    removeActiveWebview,
    stageDocumentSelection,
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
        sharedSelection: normalizeHostSelectionState(initialSelection),
        selectionRevision: 0,
        inspectorContentSyncKind: "reload",
    };
    const documentSession = document.sessionState;
    let pendingInitialRevealTarget = initialRevealTarget;
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

    const updateSharedSelection = (
        selection: HostSelectionState,
        opts?: { reassertIfEqual?: boolean }
    ): "noop" | "changed" | "reasserted" => {
        const applied = applySharedSelectionState(state.sharedSelection, selection, opts);
        if (applied.result === "noop") {
            return "noop";
        }

        state.sharedSelection = applied.selection;
        state.selectionRevision += 1;
        return applied.result;
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
        // Vars and all-files are paired because inspector path pickers depend on the same index pass.
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
    const enqueueMainDocumentOperation = createSerialOperationQueue();
    const createNodeCheckRuntime = async () => {
        // Custom checkers run in the extension host so they can use fs/path and workspace scripts.
        return createSessionNodeCheckRuntime({
            documentUri: document.uri,
            workspaceFolderUri,
            nodeDefs: state.nodeDefs,
            readWorkspaceFileContent,
        });
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
                env: createSessionBuildScriptEnv(runtimeResult.treePath, state.nodeDefs),
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

    const branchContainsSubtreeLink = (node: PersistedNodeModel | null | undefined): boolean => {
        if (!node) {
            return false;
        }

        let found = false;
        walkPersistedNodes(node, (entry) => {
            if (entry.path) {
                found = true;
            }
        });
        return found;
    };

    const normalizeReachableSubtreeOverrides = async (
        tree: ReturnType<typeof parsePersistedTreeContent>
    ): Promise<void> => {
        if (Object.keys(tree.overrides).length === 0) {
            return;
        }

        const subtreeSources = await loadSubtreeSourceCache({
            root: tree.root,
            readContent: async (relativePath) => {
                const subtreeUri = vscode.Uri.file(path.join(projectRootUri.fsPath, relativePath));
                try {
                    return await readWorkspaceFileContent(subtreeUri);
                } catch {
                    return null;
                }
            },
        });
        pruneStaleSubtreeOverrides({
            tree,
            subtreeSources,
        });
    };

    const mutationMayAffectSubtreeOverrideReachability = (
        mutation: Extract<EditorToHostMessage, { type: "mutateDocument" }>["mutation"],
        currentTree: ReturnType<typeof parsePersistedTreeContent>
    ): boolean => {
        switch (mutation.type) {
            case "updateNode": {
                if (mutation.payload.currentNodeSnapshot?.subtreeNode) {
                    return false;
                }

                const currentNode =
                    findPersistedNodeByStableId(
                        currentTree.root,
                        mutation.payload.target.structuralStableId
                    ) ?? mutation.payload.currentNodeSnapshot?.data;
                if (!currentNode) {
                    return false;
                }

                const currentPath = currentNode.path;
                const nextPath = mutation.payload.data.path?.trim() || undefined;
                return currentPath !== nextPath;
            }

            case "replaceNode": {
                const currentNode = findPersistedNodeByStableId(
                    currentTree.root,
                    mutation.payload.target.structuralStableId
                );
                return (
                    branchContainsSubtreeLink(currentNode) ||
                    branchContainsSubtreeLink(mutation.payload.snapshot)
                );
            }

            case "deleteNode": {
                const currentNode = findPersistedNodeByStableId(
                    currentTree.root,
                    mutation.payload.target.structuralStableId
                );
                return branchContainsSubtreeLink(currentNode);
            }

            default:
                return false;
        }
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
        // Editor and sidebar both consume the same host snapshot to avoid divergent dirty/selection state.
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

    const getExistingNewerFileEditMessage = async (fileUri: vscode.Uri): Promise<string | null> => {
        return readExistingNewerFileEditMessage(
            fileUri,
            state.currentSettings.language,
            readWorkspaceFileContent
        );
    };

    const fileRequestHandlers = createSessionFileRequestHandlers({
        projectRootUri,
        viewType,
        stageDocumentSelection,
        writeDocumentContentToDisk,
        getActiveNewerFileEditMessage,
        getExistingNewerFileEditMessage,
    });

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
        if (pendingInitialRevealTarget) {
            await reply({
                type: "relayFocusNode",
                target: pendingInitialRevealTarget,
            });
            pendingInitialRevealTarget = null;
        }

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

        // This mutation crosses the file-system boundary, so it stays host-side instead of reducer-only.
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

        const saveResult = await fileRequestHandlers.saveSubtreeContentAs(
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
        await normalizeReachableSubtreeOverrides(nextTree);
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
            // All persisted mutations are serialized to keep undo history, file watchers, and selection aligned.
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

            const saveSelectedAsSubtreeResult = await handleSaveSelectedAsSubtreeMutation(msg);
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
            let currentTree: ReturnType<typeof parsePersistedTreeContent> | null = null;
            try {
                currentTree = parsePersistedTreeContent(document.content, document.uri.fsPath);
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

            if (
                currentTree &&
                mutationMayAffectSubtreeOverrideReachability(msg.mutation, currentTree)
            ) {
                await normalizeReachableSubtreeOverrides(reduced.tree);
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
