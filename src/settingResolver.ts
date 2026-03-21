import * as vscode from "vscode";
import type { NodeDef } from "./types";

/**
 * Finds and loads the .b3-setting node config file.
 * Priority:
 *   1. behavior3.settingFile workspace setting (relative to workspace root)
 *   2. Auto-discover *.b3-setting in workspace root
 */
export async function resolveNodeDefs(workdir: vscode.Uri): Promise<NodeDef[]> {
  const config = vscode.workspace.getConfiguration("behavior3");
  const settingFile = config.get<string>("settingFile", "");

  let settingUri: vscode.Uri | undefined;

  if (settingFile) {
    settingUri = vscode.Uri.joinPath(workdir, settingFile);
  } else {
    // Auto-discover *.b3-setting in workdir
    const pattern = new vscode.RelativePattern(workdir.fsPath, "*.b3-setting");
    const found = await vscode.workspace.findFiles(pattern, null, 1);
    if (found.length > 0) {
      settingUri = found[0];
    }
  }

  if (!settingUri) {
    return [];
  }

  try {
    const raw = await vscode.workspace.fs.readFile(settingUri);
    const text = Buffer.from(raw).toString("utf-8");
    return JSON.parse(text) as NodeDef[];
  } catch (e) {
    console.error("[behavior3] failed to load setting file:", settingUri.fsPath, e);
    return [];
  }
}

/**
 * Watches .b3-setting changes and invokes callback.
 */
export function watchSettingFile(
  workdir: vscode.Uri,
  callback: (defs: NodeDef[]) => void
): vscode.Disposable {
  const pattern = new vscode.RelativePattern(workdir.fsPath, "*.b3-setting");
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);

  const handler = async () => {
    const defs = await resolveNodeDefs(workdir);
    callback(defs);
  };

  watcher.onDidChange(handler);
  watcher.onDidCreate(handler);
  watcher.onDidDelete(handler);

  return watcher;
}
