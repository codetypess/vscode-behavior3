import { normalizeTreeContentForWrite } from "../document/document-sync";
import type { FileVersionGuard } from "./file-version-guard";
import {
    mutationMayAffectSubtreeOverrideReachability,
    normalizeReachableSubtreeOverrides,
} from "../document/subtree-overrides";
import { readWorkspaceFileContent } from "../files/paths";
import { buildHostSelectionFromMutationSelection } from "./messages";
import type { SessionInspectorSync } from "./inspector-sync";
import type { HostMessageSink, MessageSource, TreeEditorSessionContext } from "./context";
import type { SessionSelectionSync } from "./selection-sync";
import type { SessionSubtreeTracking } from "./subtree-tracking";
import {
    type DocumentMutationSelection,
    formatDocumentMutationReducerError,
    isReducibleDocumentMutation,
    reduceDocumentMutation,
} from "../../../webview/shared/document";
import type {
    EditorToHostMessage,
    HostToEditorMessage,
} from "../../../webview/shared/message-protocol";
import { parseWorkdirRelativeJsonPath } from "../../../webview/shared/protocol";
import {
    clonePersistedNode,
    clonePersistedTree,
    findPersistedNodeByStableId,
    parsePersistedTreeContent,
    serializePersistedTree,
} from "../../../webview/shared/tree";
import { DOCUMENT_VERSION } from "../../../webview/shared/b3type";
import { translateRuntimeMessage } from "../../../webview/shared/runtime-i18n";

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

type MutateDocumentMessage = Extract<EditorToHostMessage, { type: "mutateDocument" }>;
type MutateDocumentResultMessage = Extract<HostToEditorMessage, { type: "mutateDocumentResult" }>;
type SaveSelectedAsSubtreeMutationResult =
    | {
          kind: "handled";
          reply: MutateDocumentResultMessage;
      }
    | { kind: "skip" };

interface DocumentMutationRuntimeDeps
    extends
        Pick<
            TreeEditorSessionContext,
            | "document"
            | "projectRootUri"
            | "state"
            | "documentSession"
            | "postMessage"
            | "onDidChangeDocument"
            | "enqueueMainDocumentOperation"
        >,
        Pick<SessionSubtreeTracking, "invalidateSubtreeRefs" | "refreshTrackedSubtreeRefs">,
        Pick<SessionInspectorSync, "fanoutDocumentSnapshot">,
        Pick<FileVersionGuard, "updateFileVersionState" | "blockEditingForNewerFile">,
        Pick<SessionSelectionSync, "updateSharedSelection"> {
    fileRequests: SessionDocumentMutationFileRequests;
}

const pruneReachableSubtreeOverrides = (
    deps: DocumentMutationRuntimeDeps,
    tree: ReturnType<typeof parsePersistedTreeContent>
) =>
    normalizeReachableSubtreeOverrides({
        tree,
        projectRootFsPath: deps.projectRootUri.fsPath,
        readWorkspaceFileContent,
    });

/**
 * Normalize webview JSON before it becomes the document source of truth.
 * This is the earliest point where we can refresh subtree tracking and
 * file-version state for subsequent watcher/save logic.
 */
function applyContentFromWebview(deps: DocumentMutationRuntimeDeps, content: string): boolean {
    const normalizedContent = normalizeTreeContentForWrite(content, deps.document.uri.fsPath);
    if (deps.document.content === normalizedContent) {
        return false;
    }

    const changed = deps.document.updateContent(normalizedContent, { markDirty: true });
    if (!changed) {
        return false;
    }

    deps.state.inspectorContentSyncKind = "update";
    deps.documentSession.applyCommittedSnapshot(normalizedContent);
    deps.invalidateSubtreeRefs();
    void deps.refreshTrackedSubtreeRefs();
    deps.updateFileVersionState(normalizedContent);
    deps.onDidChangeDocument(deps.document);
    return true;
}

async function handleSaveSelectedAsSubtreeMutation(
    deps: DocumentMutationRuntimeDeps,
    msg: MutateDocumentMessage
): Promise<SaveSelectedAsSubtreeMutationResult> {
    if (msg.mutation.type !== "saveSelectedAsSubtree") {
        return { kind: "skip" };
    }

    // This mutation crosses the file-system boundary, so it stays host-side instead of reducer-only.
    const currentTree = parsePersistedTreeContent(deps.document.content, deps.document.uri.fsPath);
    if (currentTree.root.uuid === msg.mutation.payload.target.structuralStableId) {
        return {
            kind: "handled",
            reply: {
                type: "mutateDocumentResult",
                requestId: msg.requestId,
                success: false,
                error: translateRuntimeMessage(
                    deps.state.currentSettings.language,
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
                    deps.state.currentSettings.language,
                    "mutation.saveSelectedAsSubtreeMissingTarget"
                ),
            },
        };
    }

    const subtreeModel = {
        version: DOCUMENT_VERSION,
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

    const saveResult = await deps.fileRequests.saveSubtreeContentAs(
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
                    deps.state.currentSettings.language,
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
                    deps.state.currentSettings.language,
                    "mutation.saveSelectedAsSubtreePostSaveMissingTarget"
                ),
            },
        };
    }

    nextTargetNode.path = savedPath;
    nextTargetNode.children = undefined;
    await pruneReachableSubtreeOverrides(deps, nextTree);
    const nextSelection: DocumentMutationSelection = {
        kind: "node",
        structuralStableId: nextTargetNode.uuid,
    };
    const changed = applyContentFromWebview(deps, serializePersistedTree(nextTree));
    if (changed) {
        deps.updateSharedSelection(buildHostSelectionFromMutationSelection(nextSelection));
        await deps.fanoutDocumentSnapshot({
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
}

async function handleMutateDocumentMessage(
    deps: DocumentMutationRuntimeDeps,
    msg: MutateDocumentMessage,
    reply: HostMessageSink = deps.postMessage,
    _source: MessageSource = "editor"
): Promise<void> {
    await deps.enqueueMainDocumentOperation(async () => {
        // All persisted mutations are serialized to keep undo history, file watchers, and selection aligned.
        const editBlockedMessage = deps.blockEditingForNewerFile();
        if (editBlockedMessage) {
            await reply({
                type: "mutateDocumentResult",
                requestId: msg.requestId,
                success: false,
                error: editBlockedMessage,
            } satisfies HostToEditorMessage);
            return;
        }

        const saveSelectedAsSubtreeResult = await handleSaveSelectedAsSubtreeMutation(deps, msg);
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
                    deps.state.currentSettings.language,
                    "runtime.unsupportedDocumentMutation"
                ),
            } satisfies HostToEditorMessage);
            return;
        }

        let reduced: ReturnType<typeof reduceDocumentMutation>;
        let currentTree: ReturnType<typeof parsePersistedTreeContent> | null = null;
        try {
            currentTree = parsePersistedTreeContent(
                deps.document.content,
                deps.document.uri.fsPath
            );
            reduced = reduceDocumentMutation(msg.mutation, {
                tree: currentTree,
                nodeDefs: deps.state.nodeDefs,
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
                    deps.state.currentSettings.language
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
            await pruneReachableSubtreeOverrides(deps, reduced.tree);
        }

        const changed = applyContentFromWebview(deps, serializePersistedTree(reduced.tree));
        if (changed) {
            if (reduced.nextSelection) {
                deps.updateSharedSelection(
                    buildHostSelectionFromMutationSelection(reduced.nextSelection)
                );
            }
            await deps.fanoutDocumentSnapshot({
                syncKind: "update",
            });
        }

        await reply({
            type: "mutateDocumentResult",
            requestId: msg.requestId,
            success: true,
        } satisfies HostToEditorMessage);
    });
}

export function createSessionDocumentMutations(
    context: TreeEditorSessionContext,
    inspectorSync: SessionInspectorSync,
    subtreeTracking: SessionSubtreeTracking,
    fileVersionGuard: FileVersionGuard,
    selectionSync: SessionSelectionSync,
    fileRequests: SessionDocumentMutationFileRequests
): SessionDocumentMutations {
    const deps: DocumentMutationRuntimeDeps = {
        document: context.document,
        projectRootUri: context.projectRootUri,
        state: context.state,
        documentSession: context.documentSession,
        postMessage: context.postMessage,
        onDidChangeDocument: context.onDidChangeDocument,
        enqueueMainDocumentOperation: context.enqueueMainDocumentOperation,
        fanoutDocumentSnapshot: inspectorSync.fanoutDocumentSnapshot,
        invalidateSubtreeRefs: subtreeTracking.invalidateSubtreeRefs,
        refreshTrackedSubtreeRefs: subtreeTracking.refreshTrackedSubtreeRefs,
        updateFileVersionState: fileVersionGuard.updateFileVersionState,
        blockEditingForNewerFile: fileVersionGuard.blockEditingForNewerFile,
        updateSharedSelection: selectionSync.updateSharedSelection,
        fileRequests,
    };

    return {
        handleMutateDocumentMessage: (msg, reply, source) =>
            handleMutateDocumentMessage(deps, msg, reply, source),
    };
}
