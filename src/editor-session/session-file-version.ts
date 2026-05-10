import { isDocumentVersionNewer } from "../../webview/shared/document";
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
        return language === "zh"
            ? `此文件由新版本 Behavior3(${fileVersion}) 创建，请升级到最新版本。`
            : `This file is created by a newer version of Behavior3(${fileVersion}), please upgrade to the latest version.`;
    }

    return language === "zh"
        ? `此文件由新版本 Behavior3(${fileVersion}) 创建，请升级到最新版本后再编辑。`
        : `This file is created by a newer version of Behavior3(${fileVersion}). Please upgrade to the latest version.`;
}

export function getNewerFileEditMessage(language: EditorLanguage, content: string): string | null {
    const fileVersion = getNewerFileVersion(content);
    return fileVersion ? getNewerVersionMessage(language, fileVersion, "edit") : null;
}
