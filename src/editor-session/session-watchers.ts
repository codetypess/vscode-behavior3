import * as path from "path";
import * as vscode from "vscode";
import { watchSettingFile, watchWorkspaceFile } from "../setting-resolver";
import type { EditorToHostMessage } from "../../webview/shared/message-protocol";
import {
    logAsyncRuntimeError,
    logRuntimeError,
} from "./runtime/logging";
import { getVSCodeTheme } from "./settings/editor-settings";
import type { ActiveTreeEditorWebview, TreeEditorSessionContext } from "./session-context";
import type { SessionDispatcher } from "./session-dispatcher";
import type { SessionSubtreeTracking } from "./session-subtree-tracking";

interface RegisterSessionWatchersParams {
    context: TreeEditorSessionContext;
    activeWebviewEntry: ActiveTreeEditorWebview;
    dispatchEditorMessage: SessionDispatcher["dispatchEditorMessage"];
    refreshSettings(opts?: { refreshDefs?: boolean }): Promise<void>;
    handleMainDocumentFileChange(): Promise<void>;
    subtreeTracking: SessionSubtreeTracking;
}

function disposeAll(disposables: vscode.Disposable[]): void {
    for (const disposable of disposables) {
        disposable.dispose();
    }
}

export function registerSessionWatchers({
    context,
    activeWebviewEntry,
    dispatchEditorMessage,
    refreshSettings,
    handleMainDocumentFileChange,
    subtreeTracking,
}: RegisterSessionWatchersParams): void {
    const {
        document,
        webviewPanel,
        workspaceFolderUri,
        projectRootUri,
        projectIndex,
        postMessage,
        removeActiveWebview,
        onInspectorSessionDispose,
    } = context;
    const {
        scheduleTrackedSubtreeRefresh,
        flushTrackedSubtreeRefresh,
        clearSubtreeRefreshTimer,
    } = subtreeTracking;

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
