import {
    collectNodeFieldCheckDiagnostics,
    resolveNodeFieldVisibility,
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
    handleValidateNodeFieldsMessage(
        msg: Extract<EditorToHostMessage, { type: "validateNodeFields" }>,
        reply?: HostMessageSink
    ): Promise<void>;
    handleResolveNodeFieldVisibilityMessage(
        msg: Extract<EditorToHostMessage, { type: "resolveNodeFieldVisibility" }>,
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

    const handleValidateNodeFieldsMessage = async (
        msg: Extract<EditorToHostMessage, { type: "validateNodeFields" }>,
        reply: HostMessageSink = postMessage
    ): Promise<void> => {
        try {
            const runtimeResult = await createNodeCheckRuntime();
            const tree = JSON.parse(msg.content) as TreeData;
            const diagnostics = collectNodeFieldCheckDiagnostics({
                tree,
                treePath: msg.treePath || runtimeResult.treePath,
                env: createSessionBuildScriptEnv(runtimeResult.treePath, state.nodeDefs),
                checkers: runtimeResult.buildScriptRuntime.nodeFieldCheckers,
                targets: msg.nodes.map((entry) => ({
                    instanceKey: entry.instanceKey,
                    treePath: entry.treePath,
                    node: toNodeData(entry.node),
                })),
            });
            await reply({
                type: "validateNodeFieldsResult",
                requestId: msg.requestId,
                diagnostics: diagnostics
                    .filter(
                        (diagnostic): diagnostic is typeof diagnostic & { instanceKey: string } =>
                            typeof diagnostic.instanceKey === "string"
                    )
                    .map((diagnostic) => ({
                        instanceKey: diagnostic.instanceKey,
                        fieldKind: diagnostic.fieldKind,
                        fieldName: diagnostic.fieldName,
                        fieldIndex: diagnostic.fieldIndex,
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
                type: "validateNodeFieldsResult",
                requestId: msg.requestId,
                diagnostics: [],
                error: String(error),
            });
        }
    };

    const handleResolveNodeFieldVisibilityMessage = async (
        msg: Extract<EditorToHostMessage, { type: "resolveNodeFieldVisibility" }>,
        reply: HostMessageSink = postMessage
    ): Promise<void> => {
        try {
            const runtimeResult = await createNodeCheckRuntime();
            const tree = JSON.parse(msg.content) as TreeData;
            const visibility = resolveNodeFieldVisibility({
                tree,
                treePath: msg.treePath || runtimeResult.treePath,
                env: createSessionBuildScriptEnv(runtimeResult.treePath, state.nodeDefs),
                visibles: runtimeResult.nodeFieldVisibleHandlers,
                target: toNodeData(msg.target.node),
                targetTreePath: msg.target.treePath,
            });
            await reply({
                type: "resolveNodeFieldVisibilityResult",
                requestId: msg.requestId,
                visibility,
            });
        } catch (error) {
            await reply({
                type: "resolveNodeFieldVisibilityResult",
                requestId: msg.requestId,
                visibility: { args: {}, input: {}, output: {} },
                error: String(error),
            });
        }
    };

    return {
        handleValidateNodeFieldsMessage,
        handleResolveNodeFieldVisibilityMessage,
    };
}
