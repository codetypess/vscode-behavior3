import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
    normalizeTreeContentForWrite,
    readFileContentFromDisk,
} from "./document/document-sync";
import { getBehavior3OutputChannel } from "../output-channel";
import { getNewerFileVersion, getNewerVersionMessage } from "./document/file-version";
import {
    logAsyncRuntimeError,
    logRuntimeError,
    writeWebviewLogMessage,
} from "./runtime/logging";
import {
    createSessionBuildScriptEnv,
    createSessionNodeCheckRuntime,
} from "./project/node-check-runtime";
import { readWorkspaceFileContent } from "./files/paths";
import { applySharedSelectionState } from "./selection";
import { getVSCodeTheme } from "./settings/editor-settings";
import { readExistingNewerFileEditMessage } from "./document/subtree-save-guards";
import { createSessionFileRequestHandlers } from "./files/file-request-handlers";
import {
    createTreeEditorSessionContext,
    type ActiveTreeEditorWebview,
    type HostMessageSink,
    type MessageSource,
    type ResolveTreeEditorSessionParams,
} from "./session-context";
import { createSessionInspectorSync } from "./session-inspector-sync";
import { createSessionSubtreeTracking } from "./session-subtree-tracking";
import { buildHostSelectionFromMutationSelection } from "./session-messages";
import {
    mutationMayAffectSubtreeOverrideReachability,
    normalizeReachableSubtreeOverrides,
} from "./document/subtree-overrides";
import {
    getResolvedB3SettingDir,
    resolveNodeDefs,
    watchSettingFile,
    watchWorkspaceFile,
} from "../setting-resolver";
import type { EditorToHostMessage, HostToEditorMessage } from "../../webview/shared/message-protocol";
import type { HostSelectionState } from "../../webview/shared/contracts";
import {
    type DocumentMutationSelection,
    formatDocumentMutationReducerError,
    isReducibleDocumentMutation,
    reduceDocumentMutation,
} from "../../webview/shared/document";
import {
    normalizeNodeInstanceRef,
    parseWorkdirRelativeJsonPath,
} from "../../webview/shared/protocol";
import {
    clonePersistedNode,
    clonePersistedTree,
    findPersistedNodeByStableId,
    parsePersistedTreeContent,
    serializePersistedTree,
} from "../../webview/shared/tree";
import { setFs } from "../../webview/shared/b3fs";
import { collectNodeArgCheckDiagnostics } from "../../webview/shared/b3build";
import { VERSION, type NodeData, type TreeData } from "../../webview/shared/b3type";
import { translateRuntimeMessage } from "../../webview/shared/runtime-i18n";

export type { ActiveTreeEditorWebview } from "./session-context";

setFs(fs);

/**
 * Per-webview extension-host session.
 * It serializes document mutations, bridges file/watcher events into the
 * webview protocol, and keeps project-level caches in sync with editor state.
 */
function disposeAll(disposables: vscode.Disposable[]): void {
    for (const disposable of disposables) {
        disposable.dispose();
    }
}

const toNodeData = (node: unknown): NodeData => node as NodeData;

export async function resolveTreeEditorSession(
    params: ResolveTreeEditorSessionParams
): Promise<void> {
    const context = await createTreeEditorSessionContext(params);
    const {
        document,
        webviewPanel,
        viewType,
        initialRevealTarget,
        writeDocumentContentToDisk,
        revertDocument,
        onDidChangeDocument,
        addActiveWebview,
        removeActiveWebview,
        stageDocumentSelection,
        onInspectorSessionUpdate,
        onInspectorSessionDispose,
        workspaceFolderUri,
        projectRootUri,
        projectIndex,
        state,
        documentSession,
        resolveLiveSettings,
        postMessage,
        mapDefsForWebview,
        buildDocumentSessionMessage,
        enqueueMainDocumentOperation,
    } = context;
    let pendingInitialRevealTarget = initialRevealTarget;
    const inspectorSync = createSessionInspectorSync(context);
    const {
        buildInspectorVarsMessage,
        fanoutDocumentSnapshot,
        notifyInspectorSessionUpdate,
        refreshLatestVarDeclsFromContent,
    } = inspectorSync;
    const subtreeTracking = createSessionSubtreeTracking(context, inspectorSync);
    const {
        invalidateSubtreeRefs,
        refreshTrackedSubtreeRefs,
        scheduleTrackedSubtreeRefresh,
        flushTrackedSubtreeRefresh,
        clearSubtreeRefreshTimer,
    } = subtreeTracking;

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

    const activeWebviewEntry: ActiveTreeEditorWebview = {
        workspaceFsPath: workspaceFolderUri.fsPath,
        documentUri: document.uri.toString(),
        postMessage,
        dispatchMessage: async (message, reply = postMessage) => {
            await dispatchEditorMessage(message, reply, "external");
        },
    };
    addActiveWebview(activeWebviewEntry);
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
                    ? translateRuntimeMessage(
                          state.currentSettings.language,
                          "runtime.nodeCheckRuntimeHasErrors"
                      )
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

    const pruneReachableSubtreeOverrides = (tree: ReturnType<typeof parsePersistedTreeContent>) =>
        normalizeReachableSubtreeOverrides({
            tree,
            projectRootFsPath: projectRootUri.fsPath,
            readWorkspaceFileContent,
        });

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
        const content = document.content;

        updateFileVersionState(content, { showWarning: true });

        await Promise.all([refreshLatestVarDeclsFromContent(content), refreshTrackedSubtreeRefs()]);

        await reply(inspectorSync.buildInitMessage({ content }));

        await reply(buildInspectorVarsMessage());
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
                    error: translateRuntimeMessage(
                        state.currentSettings.language,
                        "mutation.saveSelectedAsSubtreeRootDenied"
                    ),
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
                    error: translateRuntimeMessage(
                        state.currentSettings.language,
                        "mutation.saveSelectedAsSubtreeMissingTarget"
                    ),
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
                    error: translateRuntimeMessage(
                        state.currentSettings.language,
                        "runtime.invalidSavedSubtreePath"
                    ),
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
                    error: translateRuntimeMessage(
                        state.currentSettings.language,
                        "mutation.saveSelectedAsSubtreePostSaveMissingTarget"
                    ),
                },
            };
        }

        nextTargetNode.path = savedPath;
        nextTargetNode.children = undefined;
        await pruneReachableSubtreeOverrides(nextTree);
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
                    error: translateRuntimeMessage(
                        state.currentSettings.language,
                        "runtime.unsupportedDocumentMutation"
                    ),
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
                await pruneReachableSubtreeOverrides(reduced.tree);
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
        clearSubtreeRefreshTimer();
        projectIndex.clear();
        removeActiveWebview(activeWebviewEntry);
        onInspectorSessionDispose(document.uri.toString());
        disposeAll(sessionDisposables);
    });
}
