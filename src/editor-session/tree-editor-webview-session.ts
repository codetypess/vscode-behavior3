import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { normalizeTreeContentForWrite } from "./document/document-sync";
import { createFileVersionGuard } from "./document/file-version-guard";
import {
    logAsyncRuntimeError,
    logRuntimeError,
    writeWebviewLogMessage,
} from "./runtime/logging";
import { readWorkspaceFileContent } from "./files/paths";
import { getVSCodeTheme } from "./settings/editor-settings";
import { createSessionFileRequestHandlers } from "./files/file-request-handlers";
import {
    createTreeEditorSessionContext,
    type ActiveTreeEditorWebview,
    type HostMessageSink,
    type MessageSource,
    type ResolveTreeEditorSessionParams,
} from "./session-context";
import { createSessionDocumentLifecycle } from "./session-document-lifecycle";
import { createSessionInspectorSync } from "./session-inspector-sync";
import { createSessionNodeChecks } from "./session-node-checks";
import { createSessionReadyHandshake } from "./session-ready-handshake";
import { createSessionSelectionSync } from "./session-selection-sync";
import { createSessionSettingsSync } from "./session-settings-sync";
import { createSessionSubtreeTracking } from "./session-subtree-tracking";
import { buildHostSelectionFromMutationSelection } from "./session-messages";
import {
    mutationMayAffectSubtreeOverrideReachability,
    normalizeReachableSubtreeOverrides,
} from "./document/subtree-overrides";
import { watchSettingFile, watchWorkspaceFile } from "../setting-resolver";
import type { EditorToHostMessage, HostToEditorMessage } from "../../webview/shared/message-protocol";
import {
    type DocumentMutationSelection,
    formatDocumentMutationReducerError,
    isReducibleDocumentMutation,
    reduceDocumentMutation,
} from "../../webview/shared/document";
import { parseWorkdirRelativeJsonPath } from "../../webview/shared/protocol";
import {
    clonePersistedNode,
    clonePersistedTree,
    findPersistedNodeByStableId,
    parsePersistedTreeContent,
    serializePersistedTree,
} from "../../webview/shared/tree";
import { setFs } from "../../webview/shared/b3fs";
import { VERSION } from "../../webview/shared/b3type";
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

export async function resolveTreeEditorSession(
    params: ResolveTreeEditorSessionParams
): Promise<void> {
    const context = await createTreeEditorSessionContext(params);
    const {
        document,
        webviewPanel,
        viewType,
        writeDocumentContentToDisk,
        onDidChangeDocument,
        addActiveWebview,
        removeActiveWebview,
        stageDocumentSelection,
        onInspectorSessionDispose,
        workspaceFolderUri,
        projectRootUri,
        projectIndex,
        state,
        documentSession,
        postMessage,
        enqueueMainDocumentOperation,
    } = context;
    const inspectorSync = createSessionInspectorSync(context);
    const { fanoutDocumentSnapshot } = inspectorSync;
    const subtreeTracking = createSessionSubtreeTracking(context, inspectorSync);
    const {
        invalidateSubtreeRefs,
        refreshTrackedSubtreeRefs,
        scheduleTrackedSubtreeRefresh,
        flushTrackedSubtreeRefresh,
        clearSubtreeRefreshTimer,
    } = subtreeTracking;
    const fileVersionGuard = createFileVersionGuard(context);
    const {
        updateFileVersionState,
        getActiveNewerFileEditMessage,
        blockEditingForNewerFile,
        getExistingNewerFileEditMessage,
    } = fileVersionGuard;
    const { refreshSettings } = createSessionSettingsSync(context, inspectorSync);
    const {
        updateSharedSelection,
        handleSelectTreeMessage,
        handleSelectNodeMessage,
    } = createSessionSelectionSync(context, inspectorSync);
    const { handleReadyMessage } = createSessionReadyHandshake(
        context,
        inspectorSync,
        subtreeTracking,
        fileVersionGuard
    );
    const {
        handleSaveDocumentMessage,
        handleHistoryNavigationMessage,
        handleRevertDocumentMessage,
        handleMainDocumentFileChange,
    } = createSessionDocumentLifecycle(context, inspectorSync, subtreeTracking, fileVersionGuard);

    const activeWebviewEntry: ActiveTreeEditorWebview = {
        workspaceFsPath: workspaceFolderUri.fsPath,
        documentUri: document.uri.toString(),
        postMessage,
        dispatchMessage: async (message, reply = postMessage) => {
            await dispatchEditorMessage(message, reply, "external");
        },
    };
    addActiveWebview(activeWebviewEntry);
    const { handleValidateNodeChecksMessage } = createSessionNodeChecks(context);

    const pruneReachableSubtreeOverrides = (tree: ReturnType<typeof parsePersistedTreeContent>) =>
        normalizeReachableSubtreeOverrides({
            tree,
            projectRootFsPath: projectRootUri.fsPath,
            readWorkspaceFileContent,
        });

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

    const fileRequestHandlers = createSessionFileRequestHandlers({
        projectRootUri,
        viewType,
        stageDocumentSelection,
        writeDocumentContentToDisk,
        getActiveNewerFileEditMessage,
        getExistingNewerFileEditMessage,
    });

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
