import { isDocumentVersionNewer } from "../../webview/shared/document";
import { translateRuntimeMessage } from "../../webview/shared/runtime-i18n";
import type { EditorLanguage } from "./session-settings";

export function getTreeFileVersion(content: string): string | undefined {
    try {
        const fileData = JSON.parse(content) as { version?: unknown };
        return typeof fileData.version === "string" ? fileData.version : undefined;
    } catch {
        return undefined;
    }
}

export function getNewerFileVersion(content: string): string | undefined {
    const fileVersion = getTreeFileVersion(content);
    return fileVersion && isDocumentVersionNewer(fileVersion) ? fileVersion : undefined;
}

export function getNewerVersionMessage(
    language: EditorLanguage,
    fileVersion: string,
    mode: "warn" | "edit"
): string {
    if (mode === "warn") {
        return translateRuntimeMessage(language, "alertNewVersion", {
            version: fileVersion,
        });
    }

    return translateRuntimeMessage(language, "editor.newerVersionEditDenied", {
        version: fileVersion,
    });
}

export function getNewerFileEditMessage(language: EditorLanguage, content: string): string | null {
    const fileVersion = getNewerFileVersion(content);
    return fileVersion ? getNewerVersionMessage(language, fileVersion, "edit") : null;
}
