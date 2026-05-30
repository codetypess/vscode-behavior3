import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { NodeDef } from "../../../webview/shared/message-protocol";
import { createNodeDefMap } from "../../../webview/shared/node-utils";
import { parseWorkspaceModelContent } from "../../../webview/shared/schema";
import b3path from "../../../webview/shared/b3path";
import {
    createBuildScriptRuntime,
    createBuildScriptRuntimeWithCheckModules,
    createNodeFieldVisibleRuntimeWithCheckModules,
    loadRuntimeModule,
    resolveCheckScriptPaths,
    type BuildEnv,
    type BuildScriptRuntime,
    type CheckScriptModule,
    type NodeFieldVisible,
} from "../../../webview/shared/b3build";
import { findB3WorkspacePath } from "../../setting-resolver";
import { createBuildScriptLogger } from "../runtime/logging";

export interface SessionNodeCheckRuntimeResult {
    buildScriptRuntime: BuildScriptRuntime;
    nodeFieldVisibleHandlers: Map<string, NodeFieldVisible>;
    treePath: string;
}

interface CreateSessionNodeCheckRuntimeParams {
    documentUri: vscode.Uri;
    workspaceFolderUri: vscode.Uri;
    nodeDefs: NodeDef[];
    readWorkspaceFileContent: (fileUri: vscode.Uri) => Promise<string>;
}

export function createSessionBuildScriptEnv(workdir: string, nodeDefs: NodeDef[]): BuildEnv {
    return {
        fs,
        path: b3path,
        workdir,
        nodeDefs: createNodeDefMap(nodeDefs),
        logger: createBuildScriptLogger(),
    };
}

export async function createSessionNodeCheckRuntime({
    documentUri,
    workspaceFolderUri,
    nodeDefs,
    readWorkspaceFileContent,
}: CreateSessionNodeCheckRuntimeParams): Promise<SessionNodeCheckRuntimeResult> {
    const workspaceFile = findB3WorkspacePath(documentUri, workspaceFolderUri);
    if (!workspaceFile) {
        return {
            buildScriptRuntime: createBuildScriptRuntime(
                null,
                createSessionBuildScriptEnv(workspaceFolderUri.fsPath, nodeDefs)
            ),
            nodeFieldVisibleHandlers: new Map(),
            treePath: workspaceFolderUri.fsPath,
        };
    }

    const workspaceText = await readWorkspaceFileContent(vscode.Uri.file(workspaceFile));
    const workspaceModel = parseWorkspaceModelContent(workspaceText);
    const buildScript = workspaceModel.settings.buildScript;
    const checkScripts = workspaceModel.settings.checkScripts ?? [];
    const workdir = path.dirname(workspaceFile).replace(/\\/g, "/");
    const env = createSessionBuildScriptEnv(workdir, nodeDefs);

    let buildScriptModule: unknown = null;
    let hasRuntimeLoadError = false;
    if (buildScript) {
        const scriptPath = path.join(workdir, buildScript);
        buildScriptModule = await loadRuntimeModule(scriptPath, { debug: false });
        hasRuntimeLoadError = !buildScriptModule;
    }

    const checkScriptModules: CheckScriptModule[] = [];
    const checkScriptPaths = resolveCheckScriptPaths(workdir, checkScripts);
    hasRuntimeLoadError = hasRuntimeLoadError || checkScriptPaths.missingPatterns.length > 0;
    for (const pattern of checkScriptPaths.missingPatterns) {
        env.logger.error(`checkScripts pattern matched no files: ${pattern}`);
    }
    for (const scriptPath of checkScriptPaths.paths) {
        const moduleExports = await loadRuntimeModule(scriptPath, { debug: false });
        if (!moduleExports) {
            env.logger.error(`'${scriptPath}' is not a valid check script`);
            hasRuntimeLoadError = true;
            continue;
        }
        checkScriptModules.push({ path: scriptPath, moduleExports });
    }

    const buildScriptRuntime = createBuildScriptRuntimeWithCheckModules(
        buildScriptModule,
        checkScriptModules,
        env
    );
    const visibleRuntime = createNodeFieldVisibleRuntimeWithCheckModules(
        buildScriptModule,
        checkScriptModules,
        env
    );
    return {
        buildScriptRuntime: {
            ...buildScriptRuntime,
            hasError: buildScriptRuntime.hasError || hasRuntimeLoadError,
        },
        nodeFieldVisibleHandlers: visibleRuntime.nodeFieldVisibles,
        treePath: workdir,
    };
}
