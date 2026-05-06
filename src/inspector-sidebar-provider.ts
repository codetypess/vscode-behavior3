import * as vscode from "vscode";
import type { EditorToHostMessage } from "../webview/shared/message-protocol";
import { InspectorSidebarCoordinator } from "./inspector-sidebar-coordinator";
import { configureBehaviorWebview } from "./webview-html";

export class InspectorSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly containerId = "behavior3InspectorContainer";
    public static readonly viewId = "behavior3.inspectorView";

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly coordinator: InspectorSidebarCoordinator
    ) {}

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void | Thenable<void> {
        const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri ?? this.extensionUri;
        this.coordinator.attachView(webviewView);

        configureBehaviorWebview(webviewView.webview, this.extensionUri, workspaceUri, {
            title: "",
            mode: "inspector-sidebar",
        });

        webviewView.webview.onDidReceiveMessage((message: EditorToHostMessage) => {
            if (message.type === "ready") {
                this.coordinator.markViewReady();
                return;
            }

            void this.coordinator.dispatchMessage(message, (response) =>
                webviewView.webview.postMessage(response)
            );
        });
        webviewView.onDidDispose(() => {
            this.coordinator.clearView();
        });
    }
}
