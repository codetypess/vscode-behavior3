import * as path from "path";
import * as vscode from "vscode";
import { getLogger, logger, setLogger, type Logger } from "../../webview/shared/logger";
import { isBehaviorTreeJsonPath } from "../../webview/shared/b3build";
import { batchProcessBehaviorProject } from "./build-cli";
import { getBehavior3OutputChannel } from "../output-channel";
import {
    findBehaviorSettingFileSync,
    findBehaviorWorkspaceFileSync,
} from "../project-path-discovery";

function createBatchScopedLogger(prev: Logger): Logger {
    return {
        log: (...args: unknown[]) => prev.log(...args),
        debug: () => {
            /* suppress noisy shared-runtime debug output */
        },
        info: (...args: unknown[]) => prev.info(...args),
        warn: (...args: unknown[]) => prev.warn(...args),
        error: (...args: unknown[]) => prev.error(...args),
    };
}

const WORKSPACE_STATE_KEY_PREFIX = "behavior3.lastBatchScript:";
const SUPPORTED_BATCH_SCRIPT_EXTENSIONS = new Set([".ts", ".mts", ".js", ".mjs"]);

const getWorkspaceStateKey = (workspaceFile: string): string =>
    WORKSPACE_STATE_KEY_PREFIX + workspaceFile;

const getLastBatchScriptUri = (
    context: vscode.ExtensionContext,
    workspaceFile: string
): vscode.Uri | undefined => {
    const saved = context.workspaceState.get<string>(getWorkspaceStateKey(workspaceFile));
    if (!saved) {
        return undefined;
    }
    return vscode.Uri.file(saved);
};

const saveLastBatchScript = async (
    context: vscode.ExtensionContext,
    workspaceFile: string,
    scriptPath: string
): Promise<void> => {
    await context.workspaceState.update(getWorkspaceStateKey(workspaceFile), scriptPath);
};

const getActiveProjectContextUri = (): vscode.Uri | undefined => {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (tab?.input instanceof vscode.TabInputCustom && tab.input.uri.scheme === "file") {
        return tab.input.uri;
    }
    if (tab?.input instanceof vscode.TabInputText && tab.input.uri.scheme === "file") {
        return tab.input.uri;
    }
    const editorUri = vscode.window.activeTextEditor?.document.uri;
    return editorUri?.scheme === "file" ? editorUri : undefined;
};

const getActiveFileUri = (): vscode.Uri | undefined => {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (tab?.input instanceof vscode.TabInputText && tab.input.uri.scheme === "file") {
        return tab.input.uri;
    }
    const editorUri = vscode.window.activeTextEditor?.document.uri;
    return editorUri?.scheme === "file" ? editorUri : undefined;
};

const isSupportedBatchScriptPath = (filePath: string): boolean =>
    SUPPORTED_BATCH_SCRIPT_EXTENSIONS.has(path.extname(filePath).toLowerCase());

const isPathInside = (rootDir: string, candidatePath: string): boolean => {
    const relative = path.relative(rootDir, candidatePath);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const collectDirtyBehaviorTreeFiles = (projectRoot: string): string[] => {
    const dirtyFiles = new Set<string>();

    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            if (!tab.isDirty) {
                continue;
            }

            let uri: vscode.Uri | undefined;
            if (tab.input instanceof vscode.TabInputCustom) {
                uri = tab.input.uri;
            } else if (tab.input instanceof vscode.TabInputText) {
                uri = tab.input.uri;
            }

            if (!uri || uri.scheme !== "file") {
                continue;
            }
            if (!isBehaviorTreeJsonPath(uri.fsPath) || !isPathInside(projectRoot, uri.fsPath)) {
                continue;
            }

            dirtyFiles.add(uri.fsPath);
        }
    }

    return Array.from(dirtyFiles).sort();
};

const saveDirtyBatchScriptDocument = async (scriptPath: string): Promise<boolean> => {
    const target = path.resolve(scriptPath);
    const document = vscode.workspace.textDocuments.find(
        (entry) => entry.uri.scheme === "file" && path.resolve(entry.uri.fsPath) === target
    );
    if (!document?.isDirty) {
        return true;
    }
    const saved = await document.save();
    if (!saved) {
        void vscode.window.showWarningMessage(
            `Save '${path.basename(scriptPath)}' before running it as a batch script.`
        );
    }
    return saved;
};

const formatBatchSummary = (summary: {
    totalFiles: number;
    writtenFiles: number;
    stagedWriteFiles: number;
    unchangedFiles: number;
    skippedFiles: number;
    failedFiles: number;
}) =>
    `scanned ${summary.totalFiles}, wrote ${summary.writtenFiles}, unchanged ${summary.unchangedFiles}, skipped ${summary.skippedFiles}, failed ${summary.failedFiles}, staged ${summary.stagedWriteFiles}`;

export async function runBatchProcess(
    context: vscode.ExtensionContext,
    resourceUri?: vscode.Uri
): Promise<void> {
    const rawContextUri = resourceUri?.scheme === "file" ? resourceUri : getActiveProjectContextUri();
    const folder =
        (rawContextUri ? vscode.workspace.getWorkspaceFolder(rawContextUri) : undefined) ??
        vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        void vscode.window.showErrorMessage("Open a workspace folder before batch processing.");
        return;
    }

    const workspaceRoot = folder.uri.fsPath;
    const contextUri =
        rawContextUri && vscode.workspace.getWorkspaceFolder(rawContextUri) ? rawContextUri : undefined;
    const searchPath = contextUri?.fsPath ?? workspaceRoot;
    const workspaceFile = findBehaviorWorkspaceFileSync(searchPath, {
        rootDir: workspaceRoot,
    });
    if (!workspaceFile) {
        void vscode.window.showErrorMessage(
            "No .b3-workspace file found. Open a behavior tree project or run the command from a project folder."
        );
        return;
    }

    const settingPath = findBehaviorSettingFileSync(path.dirname(workspaceFile), {
        rootDir: workspaceRoot,
    });
    if (!settingPath) {
        void vscode.window.showErrorMessage(
            "No .b3-setting file found. Place a *.b3-setting next to your behavior trees or in a parent folder."
        );
        return;
    }

    const projectRoot = path.dirname(workspaceFile);
    const dirtyFiles = collectDirtyBehaviorTreeFiles(projectRoot);
    if (dirtyFiles.length) {
        const preview = dirtyFiles.slice(0, 3).map((filePath) => path.basename(filePath)).join(", ");
        const suffix = dirtyFiles.length > 3 ? ` and ${dirtyFiles.length - 3} more` : "";
        void vscode.window.showWarningMessage(
            `Save dirty behavior tree files before batch processing: ${preview}${suffix}`
        );
        return;
    }

    const defaultScriptUri = getLastBatchScriptUri(context, workspaceFile) ?? vscode.Uri.file(projectRoot);
    const picked = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        defaultUri: defaultScriptUri,
        openLabel: "Select batch script",
        title: "Behavior3 Batch Process - Select Script",
        filters: {
            "Behavior3 Batch Scripts": ["ts", "mts", "js", "mjs"],
        },
    });
    if (!picked?.length) {
        return;
    }

    await runBatchProcessWithScript(context, workspaceFile, settingPath, projectRoot, picked[0].fsPath);
}

export async function runBatchProcessScript(
    context: vscode.ExtensionContext,
    resourceUri?: vscode.Uri
): Promise<void> {
    const resourceIsFile = resourceUri?.scheme === "file";
    const resourcePath = resourceIsFile ? resourceUri.fsPath : undefined;
    const explicitScriptUri =
        resourcePath && isSupportedBatchScriptPath(resourcePath)
            ? resourceUri
            : undefined;
    const activeFileUri = getActiveFileUri();
    const activeScriptUri =
        activeFileUri && isSupportedBatchScriptPath(activeFileUri.fsPath) ? activeFileUri : undefined;
    const scriptUri = explicitScriptUri ?? (!resourceUri ? activeScriptUri : undefined);

    if (!scriptUri) {
        await runBatchProcess(context, resourceUri);
        return;
    }

    const folder = vscode.workspace.getWorkspaceFolder(scriptUri) ?? vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        void vscode.window.showErrorMessage("Open a workspace folder before batch processing.");
        return;
    }

    const workspaceRoot = folder.uri.fsPath;
    const workspaceFile = findBehaviorWorkspaceFileSync(scriptUri.fsPath, {
        rootDir: workspaceRoot,
    });
    if (!workspaceFile) {
        void vscode.window.showErrorMessage(
            "No .b3-workspace file found when walking up from the selected script."
        );
        return;
    }

    const settingPath = findBehaviorSettingFileSync(path.dirname(workspaceFile), {
        rootDir: workspaceRoot,
    });
    if (!settingPath) {
        void vscode.window.showErrorMessage(
            "No .b3-setting file found. Place a *.b3-setting next to your behavior trees or in a parent folder."
        );
        return;
    }

    await runBatchProcessWithScript(
        context,
        workspaceFile,
        settingPath,
        path.dirname(workspaceFile),
        scriptUri.fsPath
    );
}

async function runBatchProcessWithScript(
    context: vscode.ExtensionContext,
    workspaceFile: string,
    settingPath: string,
    projectRoot: string,
    scriptPath: string
): Promise<void> {
    const dirtyFiles = collectDirtyBehaviorTreeFiles(projectRoot);
    if (dirtyFiles.length) {
        const preview = dirtyFiles.slice(0, 3).map((filePath) => path.basename(filePath)).join(", ");
        const suffix = dirtyFiles.length > 3 ? ` and ${dirtyFiles.length - 3} more` : "";
        void vscode.window.showWarningMessage(
            `Save dirty behavior tree files before batch processing: ${preview}${suffix}`
        );
        return;
    }
    if (!(await saveDirtyBatchScriptDocument(scriptPath))) {
        return;
    }

    await saveLastBatchScript(context, workspaceFile, scriptPath);

    const config = vscode.workspace.getConfiguration("behavior3");
    const checkExpr = config.get<boolean>("checkExpr", true);
    const out = getBehavior3OutputChannel();
    out.show(true);
    out.info(`Batch script → ${scriptPath}`);
    out.info(`Batch project → ${projectRoot}`);

    const prevLogger = getLogger();
    setLogger(createBatchScopedLogger(prevLogger));
    try {
        const result = await batchProcessBehaviorProject({
            workspaceFile,
            settingFile: settingPath,
            scriptFile: scriptPath,
            checkExpr,
        });

        const summaryText = formatBatchSummary(result.summary);
        if (result.hasError) {
            const resultMessage =
                `Batch processing aborted. No behavior tree files were rewritten; ${summaryText}. ` +
                "See the Output panel for details.";
            logger.error(resultMessage);
            void vscode.window.showErrorMessage(resultMessage);
            return;
        }

        const resultMessage = `Batch processing completed: ${summaryText}.`;
        out.info(resultMessage);
        void vscode.window.showInformationMessage(resultMessage);
    } catch (error) {
        logger.error("batch processing failed:", error);
        const resultMessage = `Batch processing failed: ${error}`;
        void vscode.window.showErrorMessage(resultMessage);
    } finally {
        setLogger(prevLogger);
    }
}
