import * as vscode from "vscode";
import type { InspectorViewProvider } from "./inspectorViewProvider";
import { resolveNodeDefs, watchSettingFile } from "./settingResolver";
import type {
  EditorToHostMessage,
  HostToEditorMessage,
  HostToInspectorMessage,
  NodeDef,
} from "./types";

function getNonce() {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function getWorkdir(documentUri: vscode.Uri): vscode.Uri {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
  if (workspaceFolder) {
    return workspaceFolder.uri;
  }
  return vscode.Uri.file(require("path").dirname(documentUri.fsPath));
}

export class TreeEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "behavior3.treeEditor";

  private _inspectorProvider?: InspectorViewProvider;

  /** Currently active editor webview panel */
  private _activePanel?: vscode.WebviewPanel;
  private _activeNodeDefs: NodeDef[] = [];
  private _activePanelWorkdir?: vscode.Uri;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) {}

  setInspectorProvider(provider: InspectorViewProvider) {
    this._inspectorProvider = provider;
    // Wire up Inspector → Editor forwarding
    provider._onPropertyChanged = (nodeId, data) => {
      this._activePanel?.webview.postMessage({
        type: "propertyChanged",
        nodeId,
        data,
      } satisfies HostToEditorMessage);
    };
    provider._onTreePropertyChanged = (data) => {
      this._activePanel?.webview.postMessage({
        type: "treePropertyChanged",
        data,
      } satisfies HostToEditorMessage);
    };
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const workdir = getWorkdir(document.uri);
    const nodeDefs = await resolveNodeDefs(workdir);
    const config = vscode.workspace.getConfiguration("behavior3");
    const checkExpr = config.get<boolean>("checkExpr", true);

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, "dist", "webview"),
        vscode.Uri.joinPath(this._extensionUri, "public"),
      ],
    };

    webviewPanel.webview.html = this._getEditorHtml(webviewPanel.webview);

    // When this panel becomes active, make it the "active" editor
    webviewPanel.onDidChangeViewState(() => {
      if (webviewPanel.active) {
        this._activePanel = webviewPanel;
        this._activePanelWorkdir = workdir;
        this._activeNodeDefs = nodeDefs;
      }
    });

    // Watch .b3-setting for changes
    const settingWatcher = watchSettingFile(workdir, (newDefs) => {
      nodeDefs.splice(0, nodeDefs.length, ...newDefs);
      const msg: HostToEditorMessage = { type: "settingLoaded", nodeDefs: newDefs };
      webviewPanel.webview.postMessage(msg);
    });

    // Sync document changes made externally (e.g., git checkout, external editor)
    const docChangeDisposable = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString() && e.contentChanges.length > 0) {
        const msg: HostToEditorMessage = {
          type: "fileChanged",
          content: document.getText(),
        };
        webviewPanel.webview.postMessage(msg);
      }
    });

    // Handle messages from the editor webview
    webviewPanel.webview.onDidReceiveMessage(async (msg: EditorToHostMessage) => {
      switch (msg.type) {
        case "ready": {
          const theme = getVSCodeTheme();
          const initMsg: HostToEditorMessage = {
            type: "init",
            content: document.getText(),
            filePath: document.uri.fsPath,
            workdir: workdir.fsPath,
            nodeDefs,
            checkExpr,
            theme,
          };
          webviewPanel.webview.postMessage(initMsg);
          this._activePanel = webviewPanel;
          this._activePanelWorkdir = workdir;
          this._activeNodeDefs = nodeDefs;
          break;
        }

        case "update": {
          const edit = new vscode.WorkspaceEdit();
          edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), msg.content);
          await vscode.workspace.applyEdit(edit);
          break;
        }

        case "nodeSelected": {
          const inspectorMsg: HostToInspectorMessage = {
            type: "nodeSelected",
            node: msg.node,
            nodeDefs,
            editingTree: null,
            workdir: workdir.fsPath,
            checkExpr,
          };
          this._inspectorProvider?.postMessage(inspectorMsg);
          break;
        }

        case "treeSelected": {
          const inspectorMsg: HostToInspectorMessage = {
            type: "treeSelected",
            tree: msg.tree,
            nodeDefs,
            workdir: workdir.fsPath,
            checkExpr,
          };
          this._inspectorProvider?.postMessage(inspectorMsg);
          break;
        }

        case "requestSetting": {
          const freshDefs = await resolveNodeDefs(workdir);
          nodeDefs.splice(0, nodeDefs.length, ...freshDefs);
          const replyMsg: HostToEditorMessage = { type: "settingLoaded", nodeDefs: freshDefs };
          webviewPanel.webview.postMessage(replyMsg);
          break;
        }

        case "build": {
          vscode.commands.executeCommand("behavior3.build");
          break;
        }

        case "readFile": {
          try {
            const fileUri = vscode.Uri.file(msg.path);
            const raw = await vscode.workspace.fs.readFile(fileUri);
            const content = Buffer.from(raw).toString("utf-8");
            const reply: HostToEditorMessage = {
              type: "readFileResult",
              requestId: msg.requestId,
              content,
            };
            webviewPanel.webview.postMessage(reply);
          } catch {
            const reply: HostToEditorMessage = {
              type: "readFileResult",
              requestId: msg.requestId,
              content: null,
            };
            webviewPanel.webview.postMessage(reply);
          }
          break;
        }

        case "saveSubtree": {
          try {
            const fileUri = vscode.Uri.file(msg.path);
            await vscode.workspace.fs.writeFile(fileUri, Buffer.from(msg.content, "utf-8"));
          } catch (e) {
            vscode.window.showErrorMessage(`Failed to save subtree: ${e}`);
          }
          break;
        }
      }
    });

    webviewPanel.onDidDispose(() => {
      settingWatcher.dispose();
      docChangeDisposable.dispose();
      if (this._activePanel === webviewPanel) {
        this._activePanel = undefined;
        this._activePanelWorkdir = undefined;
      }
    });
  }

  private _getEditorHtml(webview: vscode.Webview): string {
    const baseUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "dist", "webview", "editor")
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "dist", "webview", "assets", "editor.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "dist", "webview", "assets", "editor.css")
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
    worker-src blob:;
    connect-src ${webview.cspSource};">
  <base href="${baseUri}/">
  <link rel="stylesheet" href="${styleUri}">
  <title>Behavior Tree Editor</title>
</head>
<body style="padding: 0; margin: 0; width: 100vw; height: 100vh; overflow: hidden;">
  <div id="root" style="width: 100%; height: 100%;"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getVSCodeTheme(): "dark" | "light" {
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Light ||
    kind === vscode.ColorThemeKind.HighContrastLight
    ? "light"
    : "dark";
}
