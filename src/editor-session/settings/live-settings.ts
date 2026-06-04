import * as vscode from "vscode";
import { resolveWorkspaceFileSettings } from "../../setting-resolver";
import { getEditorLanguage, type EditorLanguage } from "./editor-settings";

export interface EditorLiveSettings {
    allowNewFunction: boolean;
    checkExpr: boolean;
    subtreeEditable: boolean;
    language: EditorLanguage;
    inspectorMode: "sidebar" | "embedded";
    nodeColors?: Record<string, string>;
}

export function createLiveSettingsResolver(
    workspaceFolderUri: vscode.Uri,
    documentUri: vscode.Uri
): () => Promise<EditorLiveSettings> {
    return async () => {
        const config = vscode.workspace.getConfiguration("behavior3");
        const workspaceSettings = await resolveWorkspaceFileSettings(
            workspaceFolderUri,
            documentUri
        );
        return {
            allowNewFunction: workspaceSettings?.allowNewFunction ?? false,
            checkExpr: config.get<boolean>("checkExpr", true),
            subtreeEditable: config.get<boolean>("subtreeEditable", true),
            language: getEditorLanguage(config.get<string>("language", "auto")),
            inspectorMode: config.get<"sidebar" | "embedded">("inspectorMode", "sidebar"),
            nodeColors: workspaceSettings?.nodeColors,
        };
    };
}
