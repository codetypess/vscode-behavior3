import * as vscode from "vscode";
import { getNewerFileEditMessage } from "./session-file-version";
import type { EditorLanguage } from "./session-settings";

export async function readExistingNewerFileEditMessage(
    fileUri: vscode.Uri,
    language: EditorLanguage,
    readFileContent: (fileUri: vscode.Uri) => Promise<string>
): Promise<string | null> {
    try {
        const content = await readFileContent(fileUri);
        return getNewerFileEditMessage(language, content);
    } catch {
        return null;
    }
}
