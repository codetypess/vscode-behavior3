import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { NodeDef } from "./types";

/** True if `dir` is the workspace root or a subdirectory of it. */
function dirIsInWorkspaceTree(workspaceRoot: string, dir: string): boolean {
  const root = path.resolve(workspaceRoot);
  const d = path.resolve(dir);
  const rel = path.relative(root, d);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Walk from the opened file's directory up to the workspace root; return the first `*.b3-setting` found.
 * Matches desktop / monorepo layouts where the config lives in e.g. `sample/` while trees are under `sample/workdir/`.
 */
export function findB3SettingPath(
  documentUri: vscode.Uri,
  workspaceFolder: vscode.Uri | undefined
): string | undefined {
  const root = workspaceFolder?.fsPath;
  let dir = path.resolve(path.dirname(documentUri.fsPath));

  while (true) {
    if (root && !dirIsInWorkspaceTree(root, dir)) {
      break;
    }
    try {
      const names = fs.readdirSync(dir);
      const hit = names.filter((n) => n.endsWith(".b3-setting")).sort();
      if (hit.length > 0) {
        return path.join(dir, hit[0]);
      }
    } catch {
      /* ignore */
    }
    if (root && path.resolve(dir) === path.resolve(root)) {
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * Load node definitions from `.b3-setting`.
 *
 * Priority:
 *   1. `behavior3.settingFile` relative to workspace folder (if set and readable)
 *   2. Walk upward from the opened tree file's directory to workspace root; first `*.b3-setting` per directory
 *   3. Any `*.b3-setting` directly in the workspace folder (legacy)
 */
export async function resolveNodeDefs(
  workspaceFolder: vscode.Uri,
  documentUri?: vscode.Uri
): Promise<NodeDef[]> {
  const config = vscode.workspace.getConfiguration("behavior3");
  const settingFileRel = config.get<string>("settingFile", "");

  if (settingFileRel) {
    const uri = vscode.Uri.joinPath(workspaceFolder, settingFileRel);
    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(raw).toString("utf-8");
      return JSON.parse(text) as NodeDef[];
    } catch {
      // fall through to search from file / root
    }
  }

  if (documentUri) {
    const wf = vscode.workspace.getWorkspaceFolder(documentUri);
    const foundFs = findB3SettingPath(documentUri, wf?.uri);
    if (foundFs) {
      try {
        const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(foundFs));
        const text = Buffer.from(raw).toString("utf-8");
        return JSON.parse(text) as NodeDef[];
      } catch (e) {
        console.error("[behavior3] failed to load setting file:", foundFs, e);
      }
    }
  }

  const pattern = new vscode.RelativePattern(workspaceFolder.fsPath, "*.b3-setting");
  const found = await vscode.workspace.findFiles(pattern, null, 1);
  if (found.length > 0) {
    try {
      const raw = await vscode.workspace.fs.readFile(found[0]);
      const text = Buffer.from(raw).toString("utf-8");
      return JSON.parse(text) as NodeDef[];
    } catch (e) {
      console.error("[behavior3] failed to load setting file:", found[0].fsPath, e);
    }
  }

  return [];
}

/**
 * Watch any `*.b3-setting` under the workspace folder so nested configs (e.g. `sample/*.b3-setting`) trigger reload.
 */
export function watchSettingFile(
  workspaceFolder: vscode.Uri,
  documentUri: vscode.Uri | undefined,
  callback: (defs: NodeDef[]) => void
): vscode.Disposable {
  const pattern = new vscode.RelativePattern(workspaceFolder.fsPath, "**/*.b3-setting");
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);

  const handler = async () => {
    const defs = await resolveNodeDefs(workspaceFolder, documentUri);
    callback(defs);
  };

  watcher.onDidChange(handler);
  watcher.onDidCreate(handler);
  watcher.onDidDelete(handler);

  return watcher;
}
