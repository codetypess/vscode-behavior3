import type { HostSelectionState } from "../../webview/shared/contracts";
import type { DocumentSessionSnapshot } from "./document/document-session-state";
import type { VarDeclResult } from "./project/project-index";
import {
    buildDocumentSnapshotChangedMessage,
    buildInitMessage as buildHostInitMessage,
    buildVarDeclLoadedMessage,
    type DocumentSnapshotChangedMessage,
    type InitMessage,
    type VarDeclLoadedMessage,
} from "./session-messages";
import type { TreeEditorSessionContext } from "./session-context";
import { getVSCodeTheme } from "./settings/editor-settings";

async function parseUsingVarsFromContent(
    context: TreeEditorSessionContext,
    content: string
): Promise<VarDeclResult | undefined> {
    try {
        return (await context.projectIndex.buildUsingVars(content)) ?? undefined;
    } catch {
        return undefined;
    }
}

export interface SessionInspectorSync {
    buildInitMessage(opts?: {
        content?: string;
        documentSession?: DocumentSessionSnapshot;
    }): InitMessage;
    buildInspectorVarsMessage(): VarDeclLoadedMessage;
    buildDocumentSnapshotMessage(opts?: {
        content?: string;
        documentSession?: DocumentSessionSnapshot;
        syncKind?: "update" | "reload";
        selection?: HostSelectionState;
    }): DocumentSnapshotChangedMessage;
    notifyInspectorSessionUpdate(): void;
    refreshLatestVarDeclsFromContent(content: string): Promise<void>;
    fanoutDocumentSnapshot(opts?: {
        syncKind?: "update" | "reload";
        refreshVars?: boolean;
    }): Promise<void>;
}

export function createSessionInspectorSync(
    context: TreeEditorSessionContext
): SessionInspectorSync {
    const {
        document,
        projectRootUri,
        state,
        postMessage,
        mapDefsForWebview,
        buildDocumentSessionMessage,
        onInspectorSessionUpdate,
    } = context;

    const buildInspectorVarsMessage = () =>
        buildVarDeclLoadedMessage(state.latestVarDecls, state.latestAllFiles);

    const buildInitMessage = (opts?: {
        content?: string;
        documentSession?: DocumentSessionSnapshot;
    }) =>
        buildHostInitMessage({
            content: opts?.content ?? document.content,
            filePath: document.uri.fsPath,
            workdir: projectRootUri.fsPath,
            nodeDefs: mapDefsForWebview(),
            settings: state.currentSettings,
            theme: getVSCodeTheme(),
            allFiles: state.latestAllFiles,
            documentSession: opts?.documentSession ?? buildDocumentSessionMessage(),
            selection: state.sharedSelection,
        });

    const buildDocumentSnapshotMessage = (opts?: {
        content?: string;
        documentSession?: DocumentSessionSnapshot;
        syncKind?: "update" | "reload";
        selection?: HostSelectionState;
    }) =>
        buildDocumentSnapshotChangedMessage({
            content: opts?.content ?? document.content,
            documentSession: opts?.documentSession ?? buildDocumentSessionMessage(),
            selection: opts?.selection ?? state.sharedSelection,
            syncKind: opts?.syncKind ?? state.inspectorContentSyncKind,
        });

    const notifyInspectorSessionUpdate = () => {
        const documentSession = buildDocumentSessionMessage();
        onInspectorSessionUpdate({
            documentUri: document.uri.toString(),
            initMessage: buildInitMessage({
                documentSession,
            }),
            varsMessage: buildInspectorVarsMessage(),
            documentSnapshot: buildDocumentSnapshotMessage({
                documentSession,
            }).snapshot,
            selectionRevision: state.selectionRevision,
        });
    };

    const refreshLatestVarDeclsFromContent = async (content: string): Promise<void> => {
        // Vars and all-files are paired because inspector path pickers depend on the same index pass.
        const [allFiles, result] = await Promise.all([
            context.projectIndex.getAllFiles(),
            parseUsingVarsFromContent(context, content),
        ]);

        state.latestAllFiles = allFiles;
        state.latestVarDecls = result ?? {
            usingVars: {},
            importDecls: [],
            subtreeDecls: [],
        };
    };

    const fanoutDocumentSnapshot = async (opts?: {
        syncKind?: "update" | "reload";
        refreshVars?: boolean;
    }): Promise<void> => {
        // Editor and sidebar both consume the same host snapshot to avoid divergent dirty/selection state.
        await postMessage(
            buildDocumentSnapshotMessage({
                syncKind: opts?.syncKind,
            })
        );
        if (opts?.refreshVars !== false) {
            await refreshLatestVarDeclsFromContent(document.content);
            await postMessage(buildInspectorVarsMessage());
        }
        notifyInspectorSessionUpdate();
    };

    return {
        buildInitMessage,
        buildInspectorVarsMessage,
        buildDocumentSnapshotMessage,
        notifyInspectorSessionUpdate,
        refreshLatestVarDeclsFromContent,
        fanoutDocumentSnapshot,
    };
}
