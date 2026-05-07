import * as vscode from "vscode";

export type EditorLanguage = "zh" | "en";
export type EditorTheme = "dark" | "light";

export function getEditorLanguage(setting: string): EditorLanguage {
    if (setting === "zh" || setting === "en") {
        return setting;
    }

    const envLanguage = vscode.env.language.toLowerCase();
    return envLanguage.startsWith("zh") ? "zh" : "en";
}

export function getVSCodeTheme(): EditorTheme {
    const kind = vscode.window.activeColorTheme.kind;
    return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight
        ? "light"
        : "dark";
}
