import type { HostSelectionState } from "../../../webview/shared/contracts";
import type { DocumentMutationSelection } from "../../../webview/shared/document";
import type { HostToEditorMessage, NodeDef } from "../../../webview/shared/message-protocol";
import type { DocumentSessionSnapshot } from "../document/document-session-state";
import type { VarDeclResult } from "../project/project-index";
import { buildPendingSelectionRef } from "./selection-state";
import type { EditorTheme } from "../settings/editor-settings";
import type { EditorLiveSettings } from "../settings/live-settings";

export type VarDeclLoadedMessage = Extract<HostToEditorMessage, { type: "varDeclLoaded" }>;
export type DocumentSnapshotChangedMessage = Extract<
    HostToEditorMessage,
    { type: "documentSnapshotChanged" }
>;
export type InitMessage = Extract<HostToEditorMessage, { type: "init" }>;

export function buildVarDeclLoadedMessage(
    result: VarDeclResult,
    allFiles?: string[]
): VarDeclLoadedMessage {
    return {
        type: "varDeclLoaded",
        usingVars: Object.values(result.usingVars),
        allFiles,
        importDecls: result.importDecls,
        subtreeDecls: result.subtreeDecls,
    };
}

export function buildDocumentSnapshotChangedMessage(params: {
    content: string;
    documentSession: DocumentSessionSnapshot;
    selection: HostSelectionState;
    syncKind: "update" | "reload";
}): DocumentSnapshotChangedMessage {
    return {
        type: "documentSnapshotChanged",
        snapshot: {
            content: params.content,
            documentSession: params.documentSession,
            selection: params.selection,
            syncKind: params.syncKind,
        },
    };
}

export function buildHostSelectionFromMutationSelection(
    selection: DocumentMutationSelection
): HostSelectionState {
    return selection.kind === "tree"
        ? { kind: "tree" }
        : {
              kind: "node",
              ref: buildPendingSelectionRef(selection.structuralStableId),
          };
}

export function buildInitMessage(params: {
    content: string;
    filePath: string;
    workdir: string;
    nodeDefs: NodeDef[];
    settings: EditorLiveSettings;
    theme: EditorTheme;
    allFiles: string[];
    documentSession: DocumentSessionSnapshot;
    selection: HostSelectionState;
}): InitMessage {
    return {
        type: "init",
        content: params.content,
        filePath: params.filePath,
        workdir: params.workdir,
        nodeDefs: params.nodeDefs,
        allowNewFunction: params.settings.allowNewFunction,
        checkExpr: params.settings.checkExpr,
        subtreeEditable: params.settings.subtreeEditable,
        language: params.settings.language,
        theme: params.theme,
        inspectorMode: params.settings.inspectorMode,
        allFiles: params.allFiles,
        nodeColors: params.settings.nodeColors,
        documentSession: params.documentSession,
        selection: params.selection,
    };
}
