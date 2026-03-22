import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { resolveNodeDefs, watchSettingFile } from "./settingResolver";
import type {
  EditorToHostMessage,
  HostToEditorMessage,
  NodeDef,
} from "./types";

/**
 * Read the Vite-generated HTML for the editor webview entry,
 * and rewrite all asset references to proper vscode-webview-resource: URIs.
 */
function buildWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  title?: string
): string {
  const htmlPath = vscode.Uri.joinPath(extensionUri, "dist", "webview", "editor", "index.html");
  let html = fs.readFileSync(htmlPath.fsPath, "utf-8");

  const webviewRootUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview")
  );

  const assetsUri = `${webviewRootUri}/assets`;
  html = html.replace(/\.\.\/assets\//g, `${assetsUri}/`);
  html = html.replace(/(?<!=")\.\/assets\//g, `${assetsUri}/`);

  if (title) {
    html = html.replace(/<title>.*?<\/title>/, `<title>${title}</title>`);
  }

  const baseTag = `<base href="${webviewRootUri}/">`;

  const src = webview.cspSource;
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${src} data: blob:; style-src ${src} 'unsafe-inline'; script-src ${src} 'unsafe-inline'; font-src ${src} data:; worker-src blob:; connect-src ${src};">`;
  html = html.replace("</head>", `  ${baseTag}\n  ${csp}\n</head>`);

  return html;
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

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) {}

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
          const content = document.getText();

          // Compute allFiles and initial usingVars
          const allFiles = await collectAllFiles(workdir);
          let initUsingVars: VarDeclResult | undefined;
          try {
            const treeJson = JSON.parse(content) as TreeLike;
            const uv = await buildUsingVars(workdir, treeJson);
            if (uv) initUsingVars = uv;
          } catch {
            // parse error — send init without usingVars
          }

          const initMsg: HostToEditorMessage = {
            type: "init",
            content,
            filePath: document.uri.fsPath,
            workdir: workdir.fsPath,
            nodeDefs,
            checkExpr,
            theme,
            allFiles,
          };
          webviewPanel.webview.postMessage(initMsg);

          if (initUsingVars) {
            const varMsg: HostToEditorMessage = {
              type: "varDeclLoaded",
              usingVars: initUsingVars.usingVars ? Object.values(initUsingVars.usingVars) : [],
              importDecls: initUsingVars.importDecls,
              subtreeDecls: initUsingVars.subtreeDecls,
            };
            webviewPanel.webview.postMessage(varMsg);
          }
          break;
        }

        case "update": {
          const edit = new vscode.WorkspaceEdit();
          edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), msg.content);
          await vscode.workspace.applyEdit(edit);
          break;
        }

        case "treeSelected": {
          // Recompute usingVars (and optionally refresh allFiles) and send back
          const allFiles = await collectAllFiles(workdir);
          const result = await buildUsingVars(workdir, msg.tree as TreeLike | null);
          if (result) {
            const varMsg: HostToEditorMessage = {
              type: "varDeclLoaded",
              usingVars: Object.values(result.usingVars),
              allFiles,
              importDecls: result.importDecls,
              subtreeDecls: result.subtreeDecls,
            };
            webviewPanel.webview.postMessage(varMsg);
          }
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
          const fileUri = vscode.Uri.file(path.normalize(msg.path));
          try {
            const raw = await vscode.workspace.fs.readFile(fileUri);
            const content = Buffer.from(raw).toString("utf-8");
            if (msg.requestId === "open-subtree") {
              try {
                const doc = await vscode.workspace.openTextDocument(fileUri);
                await vscode.window.showTextDocument(doc, { preview: true });
              } catch {
                /* ignore open failure */
              }
            }
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
    });
  }

  private _getEditorHtml(webview: vscode.Webview): string {
    return buildWebviewHtml(webview, this._extensionUri, "Behavior Tree Editor");
  }
}

interface TreeLike {
  vars?: Array<{ name: string; desc?: string }>;
  import?: string[] | Array<{ path: string; vars?: Array<{ name: string; desc?: string }> }>;
  root?: TreeNodeLike;
}

interface TreeNodeLike {
  path?: string;
  children?: TreeNodeLike[];
}

interface TreeFileLike {
  vars?: Array<{ name: string; desc?: string }>;
  import?: string[];
}

/**
 * Collect all .b3tree / .json files under the workspace directory.
 */
async function collectAllFiles(workdir: vscode.Uri): Promise<string[]> {
  const path = require("path") as typeof import("path");
  const allFiles: string[] = [];
  try {
    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(workdir, "**/*.{b3tree,json}"),
      "**/node_modules/**"
    );
    for (const uri of uris) {
      allFiles.push(path.relative(workdir.fsPath, uri.fsPath).replace(/\\/g, "/"));
    }
    allFiles.sort();
  } catch {
    // workspace may not be open
  }
  return allFiles;
}

function collectSubtreePaths(node: TreeNodeLike | undefined): string[] {
  if (!node) return [];
  const paths: string[] = [];
  const stack: TreeNodeLike[] = [node];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur.path) paths.push(cur.path);
    cur.children?.forEach((c) => stack.push(c));
  }
  return paths;
}


interface VarDeclResult {
  usingVars: Record<string, { name: string; desc: string }>;
  importDecls: Array<{ path: string; vars: Array<{ name: string; desc: string }> }>;
  subtreeDecls: Array<{ path: string; vars: Array<{ name: string; desc: string }> }>;
}

/**
 * Read vars from a single file, returning them as a list (without merging into global map).
 */
function readVarsFromFile(
  relativePath: string,
  workdirFs: string,
  visitedForGlobal: Set<string>,
  globalVars: Record<string, { name: string; desc: string }>
): Array<{ name: string; desc: string }> {
  const localVars: Array<{ name: string; desc: string }> = [];
  if (visitedForGlobal.has(relativePath)) return localVars;
  visitedForGlobal.add(relativePath);

  const fsLib = require("fs") as typeof import("fs");
  const nodePath = require("path") as typeof import("path");
  const fullPath = nodePath.join(workdirFs, relativePath);

  try {
    const raw = fsLib.readFileSync(fullPath, "utf-8");
    const fileTree = JSON.parse(raw) as TreeFileLike;
    for (const v of fileTree.vars ?? []) {
      if (v.name) {
        localVars.push({ name: v.name, desc: v.desc ?? "" });
        if (!globalVars[v.name]) globalVars[v.name] = { name: v.name, desc: v.desc ?? "" };
      }
    }
    // Also recurse into transitive imports for global vars
    for (const imp of fileTree.import ?? []) {
      if (typeof imp === "string") {
        loadVarsFromFile(imp, workdirFs, globalVars, visitedForGlobal);
      }
    }
  } catch {
    // file not found or parse error — silently skip
  }
  return localVars;
}

/**
 * Build the usingVars dictionary + full ImportDecl data for display in Inspector.
 */
async function buildUsingVars(
  workdir: vscode.Uri,
  tree: TreeLike | null
): Promise<VarDeclResult | null> {
  if (!tree) return null;

  const usingVars: Record<string, { name: string; desc: string }> = {};

  for (const v of tree.vars ?? []) {
    if (v.name) usingVars[v.name] = { name: v.name, desc: v.desc ?? "" };
  }

  const visited = new Set<string>();
  const importDecls: Array<{ path: string; vars: Array<{ name: string; desc: string }> }> = [];

  for (const imp of tree.import ?? []) {
    if (typeof imp === "string") {
      const vars = readVarsFromFile(imp, workdir.fsPath, visited, usingVars);
      importDecls.push({ path: imp, vars });
    }
  }

  const subtreePaths = collectSubtreePaths(tree.root);
  const subtreeDecls: Array<{ path: string; vars: Array<{ name: string; desc: string }> }> = [];
  for (const subtreePath of subtreePaths) {
    const vars = readVarsFromFile(subtreePath, workdir.fsPath, visited, usingVars);
    subtreeDecls.push({ path: subtreePath, vars });
  }

  return { usingVars, importDecls, subtreeDecls };
}

function getVSCodeTheme(): "dark" | "light" {
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Light ||
    kind === vscode.ColorThemeKind.HighContrastLight
    ? "light"
    : "dark";
}
