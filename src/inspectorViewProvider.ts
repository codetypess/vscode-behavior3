import * as vscode from "vscode";
import type { HostToInspectorMessage, InspectorToHostMessage } from "./types";

/**
 * Provides the Inspector sidebar webview.
 * Receives node/tree selection events from the active TreeEditorProvider
 * and allows property editing, which is forwarded back to the editor.
 */
export class InspectorViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "behavior3.inspector";

  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, "dist", "webview"),
        vscode.Uri.joinPath(this._extensionUri, "public"),
      ],
    };

    webviewView.webview.html = this._getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg: InspectorToHostMessage) => {
      switch (msg.type) {
        case "ready":
          // Inspector is ready; nothing to do until an editor becomes active
          break;
        case "propertyChanged":
          // Forward to active editor
          this._onPropertyChanged?.(msg.nodeId, msg.data);
          break;
        case "treePropertyChanged":
          this._onTreePropertyChanged?.(msg.data);
          break;
      }
    });
  }

  /** Callback set by TreeEditorProvider when editor becomes active */
  _onPropertyChanged?: (nodeId: string, data: Record<string, unknown>) => void;
  _onTreePropertyChanged?: (data: Record<string, unknown>) => void;

  /** Send a message to the Inspector webview */
  postMessage(message: HostToInspectorMessage) {
    this._view?.webview.postMessage(message);
  }

  private _getHtml(webview: vscode.Webview): string {
    const baseUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "dist", "webview", "inspector")
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "dist", "webview", "assets", "inspector.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "dist", "webview", "assets", "inspector.css")
    );
    const nonce = getNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
    img-src ${webview.cspSource} data: blob:;
    style-src ${webview.cspSource} 'unsafe-inline';
    script-src 'nonce-${nonce}';
    font-src ${webview.cspSource} data:;
    worker-src blob:;">
  <base href="${baseUri}/">
  <link rel="stylesheet" href="${styleUri}">
  <title>Inspector</title>
</head>
<body style="padding: 0; margin: 0; overflow: hidden;">
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce() {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
