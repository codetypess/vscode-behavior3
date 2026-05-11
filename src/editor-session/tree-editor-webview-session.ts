import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { createFileVersionGuard } from "./document/file-version-guard";
import {
    logAsyncRuntimeError,
    logRuntimeError,
    writeWebviewLogMessage,
} from "./runtime/logging";
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
import { createSessionDocumentMutations } from "./session-document-mutations";
import { createSessionInspectorSync } from "./session-inspector-sync";
import { createSessionNodeChecks } from "./session-node-checks";
import { createSessionReadyHandshake } from "./session-ready-handshake";
import { createSessionSelectionSync } from "./session-selection-sync";
import { createSessionSettingsSync } from "./session-settings-sync";
import { createSessionSubtreeTracking } from "./session-subtree-tracking";
import { watchSettingFile, watchWorkspaceFile } from "../setting-resolver";
import type { EditorToHostMessage } from "../../webview/shared/message-protocol";
import { setFs } from "../../webview/shared/b3fs";

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
        addActiveWebview,
        removeActiveWebview,
        stageDocumentSelection,
        onInspectorSessionDispose,
        workspaceFolderUri,
        projectRootUri,
        projectIndex,
        postMessage,
    } = context;
    const inspectorSync = createSessionInspectorSync(context);
    const subtreeTracking = createSessionSubtreeTracking(context, inspectorSync);
    const {
        scheduleTrackedSubtreeRefresh,
        flushTrackedSubtreeRefresh,
        clearSubtreeRefreshTimer,
    } = subtreeTracking;
    const fileVersionGuard = createFileVersionGuard(context);
    const {
        getActiveNewerFileEditMessage,
        getExistingNewerFileEditMessage,
    } = fileVersionGuard;
    const { refreshSettings } = createSessionSettingsSync(context, inspectorSync);
    const selectionSync = createSessionSelectionSync(context, inspectorSync);
    const { handleSelectTreeMessage, handleSelectNodeMessage } = selectionSync;
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

    const fileRequestHandlers = createSessionFileRequestHandlers({
        projectRootUri,
        viewType,
        stageDocumentSelection,
        writeDocumentContentToDisk,
        getActiveNewerFileEditMessage,
        getExistingNewerFileEditMessage,
    });
    const { handleMutateDocumentMessage } = createSessionDocumentMutations(
        context,
        inspectorSync,
        subtreeTracking,
        fileVersionGuard,
        selectionSync,
        fileRequestHandlers
    );

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
