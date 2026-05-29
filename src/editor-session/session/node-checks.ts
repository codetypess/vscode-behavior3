import {
    collectNodeArgCheckDiagnostics,
    resolveNodeArgVisibility,
} from "../../../webview/shared/b3build";
import type { NodeData, TreeData } from "../../../webview/shared/b3type";
import type { EditorToHostMessage } from "../../../webview/shared/message-protocol";
import { translateRuntimeMessage } from "../../../webview/shared/runtime-i18n";
import { readWorkspaceFileContent } from "../files/paths";
import {
    createSessionBuildScriptEnv,
    createSessionNodeCheckRuntime,
} from "../project/node-check-runtime";
import type { HostMessageSink, TreeEditorSessionContext } from "./context";

export interface SessionNodeChecks {
    handleValidateNodeChecksMessage(
        msg: Extract<EditorToHostMessage, { type: "validateNodeChecks" }>,
        reply?: HostMessageSink
    ): Promise<void>;
    handleResolveNodeArgVisibilityMessage(
        msg: Extract<EditorToHostMessage, { type: "resolveNodeArgVisibility" }>,
        reply?: HostMessageSink
    ): Promise<void>;
}

const toNodeData = (node: unknown): NodeData => node as NodeData;

export function createSessionNodeChecks(context: TreeEditorSessionContext): SessionNodeChecks {
    const { document, workspaceFolderUri, state, postMessage } = context;

    const createNodeCheckRuntime = async () => {
        // Custom checkers run in the extension host so they can use fs/path and workspace scripts.
        return createSessionNodeCheckRuntime({
            documentUri: document.uri,
            workspaceFolderUri,
            nodeDefs: state.nodeDefs,
            readWorkspaceFileContent,
        });
    };

    const handleValidateNodeChecksMessage = async (
        msg: Extract<EditorToHostMessage, { type: "validateNodeChecks" }>,
        reply: HostMessageSink = postMessage
    ): Promise<void> => {
        try {
            const runtimeResult = await createNodeCheckRuntime();
            const tree = JSON.parse(msg.content) as TreeData;
            const diagnostics = collectNodeArgCheckDiagnostics({
                tree,
                treePath: msg.treePath || runtimeResult.treePath,
                env: createSessionBuildScriptEnv(runtimeResult.treePath, state.nodeDefs),
                checkers: runtimeResult.buildScriptRuntime.nodeArgCheckers,
                targets: msg.nodes.map((entry) => ({
                    instanceKey: entry.instanceKey,
                    treePath: entry.treePath,
                    node: toNodeData(entry.node),
                })),
            });
            await reply({
                type: "validateNodeChecksResult",
                requestId: msg.requestId,
                diagnostics: diagnostics
                    .filter(
                        (diagnostic): diagnostic is typeof diagnostic & { instanceKey: string } =>
                            typeof diagnostic.instanceKey === "string"
                    )
                    .map((diagnostic) => ({
                        instanceKey: diagnostic.instanceKey,
                        argName: diagnostic.argName,
                        checker: diagnostic.checker,
                        message: diagnostic.message,
                    })),
                error: runtimeResult.buildScriptRuntime.hasError
                    ? translateRuntimeMessage(
                          state.currentSettings.language,
                          "runtime.nodeCheckRuntimeHasErrors"
                      )
                    : undefined,
            });
        } catch (error) {
            await reply({
                type: "validateNodeChecksResult",
                requestId: msg.requestId,
                diagnostics: [],
                error: String(error),
            });
        }
    };

    const handleResolveNodeArgVisibilityMessage = async (
        msg: Extract<EditorToHostMessage, { type: "resolveNodeArgVisibility" }>,
        reply: HostMessageSink = postMessage
    ): Promise<void> => {
        try {
            const runtimeResult = await createNodeCheckRuntime();
            const tree = JSON.parse(msg.content) as TreeData;
            const visibility = resolveNodeArgVisibility({
                tree,
                treePath: msg.treePath || runtimeResult.treePath,
                env: createSessionBuildScriptEnv(runtimeResult.treePath, state.nodeDefs),
                visibles: runtimeResult.nodeArgVisibleHandlers,
                target: toNodeData(msg.target.node),
                targetTreePath: msg.target.treePath,
            });
            await reply({
                type: "resolveNodeArgVisibilityResult",
                requestId: msg.requestId,
                visibility,
            });
        } catch (error) {
            await reply({
                type: "resolveNodeArgVisibilityResult",
                requestId: msg.requestId,
                visibility: {},
                error: String(error),
            });
        }
    };

    return {
        handleValidateNodeChecksMessage,
        handleResolveNodeArgVisibilityMessage,
    };
}
