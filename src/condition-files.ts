import * as vscode from "vscode";
import {
    buildConditionFileLocation,
    buildConditionFilePath,
    CONDITION_FILE_SCHEME,
    parseConditionFileLocation,
} from "../webview/shared/condition-file";

/**
 * Condition files are virtual tree files
 * (`behavior3-condition:<host path>/<host uuid>/condition-<condition root uuid>.json`) that edit
 * one condition item of a host node in its own tab. The provider owns the host-document access;
 * this module only maps URIs and bytes.
 */
export const isConditionFileUri = (uri: vscode.Uri): boolean =>
    uri.scheme === CONDITION_FILE_SCHEME;

export const buildConditionFileUri = (
    hostUri: vscode.Uri,
    hostStableId: string,
    rootUuid: string
): vscode.Uri =>
    vscode.Uri.from({
        scheme: CONDITION_FILE_SCHEME,
        ...buildConditionFileLocation(hostUri.path, hostStableId, rootUuid),
    });

export const parseConditionFileUri = (
    uri: vscode.Uri
): { hostUri: vscode.Uri; hostStableId: string; rootUuid: string } | null => {
    if (!isConditionFileUri(uri)) {
        return null;
    }
    const parsed = parseConditionFileLocation(uri);
    return parsed
        ? {
              hostUri: vscode.Uri.from({ scheme: "file", path: parsed.hostFilePath }),
              hostStableId: parsed.hostStableId,
              rootUuid: parsed.rootUuid,
          }
        : null;
};

/** The real file a document lives next to: the host file for condition files, else itself. */
export const resolveBackingFileUri = (uri: vscode.Uri): vscode.Uri =>
    parseConditionFileUri(uri)?.hostUri ?? uri;

/** File path given to the webview: `<host file>/<uuid>/condition-<root uuid>.json` for conditions. */
export const resolveDocumentFsPath = (uri: vscode.Uri): string => {
    const location = parseConditionFileUri(uri);
    return location
        ? buildConditionFilePath(location.hostUri.fsPath, location.hostStableId, location.rootUuid)
        : uri.fsPath;
};

export interface ConditionFileAccess {
    readConditionFile(uri: vscode.Uri): Promise<string>;
    writeConditionFile(uri: vscode.Uri, content: string): Promise<void>;
}

export class ConditionFileSystemProvider implements vscode.FileSystemProvider {
    private readonly changeEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this.changeEmitter.event;

    constructor(private readonly access: ConditionFileAccess) {}

    watch(): vscode.Disposable {
        // Sessions watch the host file and get explicit refreshes from the provider.
        return new vscode.Disposable(() => {});
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const content = await this.access.readConditionFile(uri);
        return {
            type: vscode.FileType.File,
            ctime: 0,
            mtime: Date.now(),
            size: Buffer.byteLength(content, "utf-8"),
        };
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        return Buffer.from(await this.access.readConditionFile(uri), "utf-8");
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
        await this.access.writeConditionFile(uri, Buffer.from(content).toString("utf-8"));
    }

    readDirectory(): [string, vscode.FileType][] {
        throw vscode.FileSystemError.NoPermissions();
    }

    createDirectory(): void {
        throw vscode.FileSystemError.NoPermissions();
    }

    delete(): void {
        throw vscode.FileSystemError.NoPermissions();
    }

    rename(): void {
        throw vscode.FileSystemError.NoPermissions();
    }
}
