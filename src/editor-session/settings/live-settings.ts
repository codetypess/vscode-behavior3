import * as vscode from "vscode";
import type { CustomFieldDefs } from "../../../webview/shared/b3type";
import { scopeCustomFieldDefsForConditionFile } from "../../../webview/shared/custom-fields";
import { resolveWorkspaceFileSettings } from "../../setting-resolver";
import { getEditorLanguage, type EditorLanguage } from "./editor-settings";

export interface EditorLiveSettings {
    allowNewFunction: boolean;
    checkExpr: boolean;
    subtreeEditable: boolean;
    language: EditorLanguage;
    inspectorMode: "sidebar" | "embedded";
    nodeColors?: Record<string, string>;
    /** Always present so a removed declaration clears the webview copy. */
    customFields: CustomFieldDefs;
    /** The document is a condition file: its node ids continue the host's numbering. */
    conditionFile: boolean;
}

export function createLiveSettingsResolver(
    workspaceFolderUri: vscode.Uri,
    documentUri: vscode.Uri,
    opts?: { conditionFile?: boolean }
): () => Promise<EditorLiveSettings> {
    return async () => {
        const config = vscode.workspace.getConfiguration("behavior3");
        const workspaceSettings = await resolveWorkspaceFileSettings(
            workspaceFolderUri,
            documentUri
        );
        const customFields = workspaceSettings?.customFields ?? { tree: [], condition: [] };
        return {
            allowNewFunction: workspaceSettings?.allowNewFunction ?? false,
            checkExpr: config.get<boolean>("checkExpr", true),
            subtreeEditable: config.get<boolean>("subtreeEditable", true),
            language: getEditorLanguage(config.get<string>("language", "auto")),
            inspectorMode: config.get<"sidebar" | "embedded">("inspectorMode", "sidebar"),
            nodeColors: workspaceSettings?.nodeColors,
            customFields: opts?.conditionFile
                ? scopeCustomFieldDefsForConditionFile(customFields)
                : customFields,
            conditionFile: opts?.conditionFile ?? false,
        };
    };
}
