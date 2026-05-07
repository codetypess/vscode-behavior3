import * as path from "path";
import * as vscode from "vscode";
import { parseWorkdirRelativeJsonPath } from "../../webview/shared/protocol";

export function getWorkdir(documentUri: vscode.Uri): vscode.Uri {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
    if (workspaceFolder) {
        return workspaceFolder.uri;
    }
    return vscode.Uri.file(path.dirname(documentUri.fsPath));
}

export async function readWorkspaceFileContent(fileUri: vscode.Uri): Promise<string> {
    const openDoc = vscode.workspace.textDocuments.find(
        (doc) => doc.uri.fsPath === fileUri.fsPath || doc.uri.toString() === fileUri.toString()
    );

    if (openDoc) {
        return openDoc.getText();
    }

    const raw = await vscode.workspace.fs.readFile(fileUri);
    return Buffer.from(raw).toString("utf-8");
}

export function uriToWorkdirRelative(
    uri: vscode.Uri,
    workdir: vscode.Uri
): string | undefined {
    if (uri.scheme !== "file") {
        return undefined;
    }

    const rel = path.relative(workdir.fsPath, uri.fsPath).replace(/\\/g, "/");
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
        return undefined;
    }
    return parseWorkdirRelativeJsonPath(rel) ?? undefined;
}

export function resolvePathInWorkdir(
    inputPath: string,
    workdir: vscode.Uri,
    options?: { mustBeJson?: boolean }
): vscode.Uri | undefined {
    const parsedPath = parseWorkdirRelativeJsonPath(inputPath);
    if (!parsedPath) {
        return undefined;
    }

    const candidate = path.join(workdir.fsPath, parsedPath);
    if (options?.mustBeJson && path.extname(candidate).toLowerCase() !== ".json") {
        return undefined;
    }

    const rel = path.relative(workdir.fsPath, candidate).replace(/\\/g, "/");
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
        return undefined;
    }
    return vscode.Uri.file(candidate);
}
