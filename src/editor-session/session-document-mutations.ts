import { normalizeTreeContentForWrite } from "./document/document-sync";
import type { FileVersionGuard } from "./document/file-version-guard";
import {
    mutationMayAffectSubtreeOverrideReachability,
    normalizeReachableSubtreeOverrides,
} from "./document/subtree-overrides";
import { readWorkspaceFileContent } from "./files/paths";
import { buildHostSelectionFromMutationSelection } from "./session-messages";
import type { SessionInspectorSync } from "./session-inspector-sync";
import type {
    HostMessageSink,
    MessageSource,
    TreeEditorSessionContext,
} from "./session-context";
import type { SessionSelectionSync } from "./session-selection-sync";
import type { SessionSubtreeTracking } from "./session-subtree-tracking";
import {
    type DocumentMutationSelection,
    formatDocumentMutationReducerError,
    isReducibleDocumentMutation,
    reduceDocumentMutation,
} from "../../webview/shared/document";
import type { EditorToHostMessage, HostToEditorMessage } from "../../webview/shared/message-protocol";
import { parseWorkdirRelativeJsonPath } from "../../webview/shared/protocol";
import {
    clonePersistedNode,
    clonePersistedTree,
    findPersistedNodeByStableId,
    parsePersistedTreeContent,
    serializePersistedTree,
} from "../../webview/shared/tree";
import { VERSION } from "../../webview/shared/b3type";
import { translateRuntimeMessage } from "../../webview/shared/runtime-i18n";

export interface SessionDocumentMutationFileRequests {
    saveSubtreeContentAs(
        content: string,
        suggestedBaseName: string
    ): Promise<{ savedPath: string | null; error?: string }>;
}

export interface SessionDocumentMutations {
    handleMutateDocumentMessage(
        msg: Extract<EditorToHostMessage, { type: "mutateDocument" }>,
        reply?: HostMessageSink,
        source?: MessageSource
    ): Promise<void>;
}

export function createSessionDocumentMutations(
    context: TreeEditorSessionContext,
    inspectorSync: SessionInspectorSync,
    subtreeTracking: SessionSubtreeTracking,
    fileVersionGuard: FileVersionGuard,
    selectionSync: SessionSelectionSync,
    fileRequests: SessionDocumentMutationFileRequests
): SessionDocumentMutations {
    const {
        document,
        projectRootUri,
        state,
        documentSession,
        postMessage,
        onDidChangeDocument,
        enqueueMainDocumentOperation,
    } = context;
    const { fanoutDocumentSnapshot } = inspectorSync;
    const { invalidateSubtreeRefs, refreshTrackedSubtreeRefs } = subtreeTracking;
    const { updateFileVersionState, blockEditingForNewerFile } = fileVersionGuard;
    const { updateSharedSelection } = selectionSync;

    const pruneReachableSubtreeOverrides = (tree: ReturnType<typeof parsePersistedTreeContent>) =>
        normalizeReachableSubtreeOverrides({
            tree,
            projectRootFsPath: projectRootUri.fsPath,
            readWorkspaceFileContent,
        });

    /**
     * Normalize webview JSON before it becomes the document source of truth.
     * This is the earliest point where we can refresh subtree tracking and
     * file-version state for subsequent watcher/save logic.
     */
    const applyContentFromWebview = (content: string): boolean => {
        const normalizedContent = normalizeTreeContentForWrite(content, document.uri.fsPath);
        if (document.content === normalizedContent) {
            return false;
        }

        const changed = document.updateContent(normalizedContent, { markDirty: true });
        if (!changed) {
            return false;
        }

        state.inspectorContentSyncKind = "update";
        documentSession.applyCommittedSnapshot(normalizedContent);
        invalidateSubtreeRefs();
        void refreshTrackedSubtreeRefs();
        updateFileVersionState(normalizedContent);
        onDidChangeDocument(document);
        return true;
    };

    const handleSaveSelectedAsSubtreeMutation = async (
        msg: Extract<EditorToHostMessage, { type: "mutateDocument" }>
    ): Promise<
        | {
              kind: "handled";
              reply: Extract<HostToEditorMessage, { type: "mutateDocumentResult" }>;
          }
        | { kind: "skip" }
    > => {
        if (msg.mutation.type !== "saveSelectedAsSubtree") {
            return { kind: "skip" };
        }

        // This mutation crosses the file-system boundary, so it stays host-side instead of reducer-only.
        const currentTree = parsePersistedTreeContent(document.content, document.uri.fsPath);
        if (currentTree.root.uuid === msg.mutation.payload.target.structuralStableId) {
            return {
                kind: "handled",
                reply: {
                    type: "mutateDocumentResult",
                    requestId: msg.requestId,
                    success: false,
                    error: translateRuntimeMessage(
                        state.currentSettings.language,
                        "mutation.saveSelectedAsSubtreeRootDenied"
                    ),
                },
            };
        }

        const targetNode = findPersistedNodeByStableId(
            currentTree.root,
            msg.mutation.payload.target.structuralStableId
        );
        if (!targetNode || targetNode.path) {
            return {
                kind: "handled",
                reply: {
                    type: "mutateDocumentResult",
                    requestId: msg.requestId,
                    success: false,
                    error: translateRuntimeMessage(
                        state.currentSettings.language,
                        "mutation.saveSelectedAsSubtreeMissingTarget"
                    ),
                },
            };
        }

        const subtreeModel = {
            version: VERSION,
            name: "subtree",
            prefix: "",
            desc: msg.mutation.payload.subtreeRoot.desc,
            export: true,
            group: [],
            variables: {
                imports: [],
                locals: [],
            },
            custom: {},
            overrides: {},
            root: clonePersistedNode(msg.mutation.payload.subtreeRoot),
        };

        const saveResult = await fileRequests.saveSubtreeContentAs(
            serializePersistedTree(subtreeModel),
            msg.mutation.payload.suggestedBaseName
        );
        if (saveResult.error) {
            return {
                kind: "handled",
                reply: {
                    type: "mutateDocumentResult",
                    requestId: msg.requestId,
                    success: false,
                    error: saveResult.error,
                },
            };
        }

        if (!saveResult.savedPath) {
            return {
                kind: "handled",
                reply: {
                    type: "mutateDocumentResult",
                    requestId: msg.requestId,
                    success: true,
                },
            };
        }

        const savedPath = parseWorkdirRelativeJsonPath(saveResult.savedPath);
        if (!savedPath) {
            return {
                kind: "handled",
                reply: {
                    type: "mutateDocumentResult",
                    requestId: msg.requestId,
                    success: false,
                    error: translateRuntimeMessage(
                        state.currentSettings.language,
                        "runtime.invalidSavedSubtreePath"
                    ),
                },
            };
        }

        const nextTree = clonePersistedTree(currentTree);
        const nextTargetNode = findPersistedNodeByStableId(
            nextTree.root,
            msg.mutation.payload.target.structuralStableId
        );
        if (!nextTargetNode) {
            return {
                kind: "handled",
                reply: {
                    type: "mutateDocumentResult",
                    requestId: msg.requestId,
                    success: false,
                    error: translateRuntimeMessage(
                        state.currentSettings.language,
                        "mutation.saveSelectedAsSubtreePostSaveMissingTarget"
                    ),
                },
            };
        }

        nextTargetNode.path = savedPath;
        nextTargetNode.children = undefined;
        await pruneReachableSubtreeOverrides(nextTree);
        const nextSelection: DocumentMutationSelection = {
            kind: "node",
            structuralStableId: nextTargetNode.uuid,
        };
        const changed = applyContentFromWebview(serializePersistedTree(nextTree));
        if (changed) {
            updateSharedSelection(buildHostSelectionFromMutationSelection(nextSelection));
            await fanoutDocumentSnapshot({
                syncKind: "update",
            });
        }

        return {
            kind: "handled",
            reply: {
                type: "mutateDocumentResult",
                requestId: msg.requestId,
                success: true,
            },
        };
    };

    const handleMutateDocumentMessage = async (
        msg: Extract<EditorToHostMessage, { type: "mutateDocument" }>,
        reply: HostMessageSink = postMessage,
        _source: MessageSource = "editor"
    ): Promise<void> => {
        await enqueueMainDocumentOperation(async () => {
            // All persisted mutations are serialized to keep undo history, file watchers, and selection aligned.
            const editBlockedMessage = blockEditingForNewerFile();
            if (editBlockedMessage) {
                await reply({
                    type: "mutateDocumentResult",
                    requestId: msg.requestId,
                    success: false,
                    error: editBlockedMessage,
                } satisfies HostToEditorMessage);
                return;
            }

            const saveSelectedAsSubtreeResult = await handleSaveSelectedAsSubtreeMutation(msg);
            if (saveSelectedAsSubtreeResult.kind === "handled") {
                await reply(saveSelectedAsSubtreeResult.reply);
                return;
            }

            if (!isReducibleDocumentMutation(msg.mutation)) {
                await reply({
                    type: "mutateDocumentResult",
                    requestId: msg.requestId,
                    success: false,
                    error: translateRuntimeMessage(
                        state.currentSettings.language,
                        "runtime.unsupportedDocumentMutation"
                    ),
                } satisfies HostToEditorMessage);
                return;
            }

            let reduced: ReturnType<typeof reduceDocumentMutation>;
            let currentTree: ReturnType<typeof parsePersistedTreeContent> | null = null;
            try {
                currentTree = parsePersistedTreeContent(document.content, document.uri.fsPath);
                reduced = reduceDocumentMutation(msg.mutation, {
                    tree: currentTree,
                    nodeDefs: state.nodeDefs,
                });
            } catch (error) {
                await reply({
                    type: "mutateDocumentResult",
                    requestId: msg.requestId,
                    success: false,
                    error: String(error),
                } satisfies HostToEditorMessage);
                return;
            }

            if (reduced.status === "error") {
                await reply({
                    type: "mutateDocumentResult",
                    requestId: msg.requestId,
                    success: false,
                    error: formatDocumentMutationReducerError(
                        reduced.error,
                        state.currentSettings.language
                    ),
                } satisfies HostToEditorMessage);
                return;
            }

            if (reduced.status === "noop") {
                await reply({
                    type: "mutateDocumentResult",
                    requestId: msg.requestId,
                    success: true,
                } satisfies HostToEditorMessage);
                return;
            }

            if (
                currentTree &&
                mutationMayAffectSubtreeOverrideReachability(msg.mutation, currentTree)
            ) {
                await pruneReachableSubtreeOverrides(reduced.tree);
            }

            const changed = applyContentFromWebview(serializePersistedTree(reduced.tree));
            if (changed) {
                if (reduced.nextSelection) {
                    updateSharedSelection(
                        buildHostSelectionFromMutationSelection(reduced.nextSelection)
                    );
                }
                await fanoutDocumentSnapshot({
                    syncKind: "update",
                });
            }

            await reply({
                type: "mutateDocumentResult",
                requestId: msg.requestId,
                success: true,
            } satisfies HostToEditorMessage);
        });
    };

    return {
        handleMutateDocumentMessage,
    };
}
