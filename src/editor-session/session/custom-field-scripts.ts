import type * as vscode from "vscode";
import type { CustomFieldResolveReason } from "../../../webview/shared/b3build-model";
import type { CustomFieldDefs } from "../../../webview/shared/b3type";
import type { PersistedTreeModel } from "../../../webview/shared/contracts";
import {
    hasScriptCustomFields,
    resolveScriptCustomFields,
    treeNeedsScriptCustomFields,
} from "../../../webview/shared/custom-field-scripts";
import { logger } from "../../../webview/shared/logger";
import type { NodeDef } from "../../../webview/shared/message-protocol";
import { readWorkspaceFileContent } from "../files/paths";
import {
    createSessionBuildScriptEnv,
    createSessionNodeCheckRuntime,
} from "../project/node-check-runtime";

export interface RunCustomFieldScriptsParams {
    tree: PersistedTreeModel;
    reason: CustomFieldResolveReason;
    /** A node's id before save renumbering. */
    previousNodeId?: (node: { id: string }) => string | undefined;
    customFields: CustomFieldDefs | undefined;
    /** Real file used to locate `.b3-workspace` and its scripts. */
    documentUri: vscode.Uri;
    workspaceFolderUri: vscode.Uri;
    nodeDefs: NodeDef[];
    language?: string;
}

/**
 * Run `@behavior3.customField` resolvers on the tree in place. Scripts are loaded only when a
 * declared field needs them; any failure is logged and never blocks the edit or the save.
 */
export async function runCustomFieldScripts(params: RunCustomFieldScriptsParams): Promise<boolean> {
    const defs = params.customFields?.condition ?? [];
    if (!hasScriptCustomFields(defs)) {
        return false;
    }
    if (params.reason === "create" && !treeNeedsScriptCustomFields(params.tree, defs)) {
        return false;
    }
    try {
        const runtime = await createSessionNodeCheckRuntime({
            documentUri: params.documentUri,
            workspaceFolderUri: params.workspaceFolderUri,
            nodeDefs: params.nodeDefs,
            language: params.language,
            readWorkspaceFileContent,
        });
        const env = createSessionBuildScriptEnv(
            runtime.treePath,
            params.nodeDefs,
            runtime.allowNewFunction,
            params.language
        );
        return resolveScriptCustomFields({
            tree: params.tree,
            defs,
            reason: params.reason,
            resolvers: runtime.customFieldResolvers,
            previousNodeId: params.previousNodeId,
            treePath: runtime.treePath,
            env,
            report: (level, message) => env.logger[level](message),
        });
    } catch (error) {
        logger.error("[behavior3] customField scripts failed:", error);
        return false;
    }
}
