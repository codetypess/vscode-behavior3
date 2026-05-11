import {
    getResolvedB3SettingDir,
    resolveNodeDefs,
} from "../setting-resolver";
import type { SessionInspectorSync } from "./session-inspector-sync";
import type { TreeEditorSessionContext } from "./session-context";

export interface SessionSettingsSync {
    refreshSettings(opts?: { refreshDefs?: boolean }): Promise<void>;
}

export function createSessionSettingsSync(
    context: TreeEditorSessionContext,
    inspectorSync: SessionInspectorSync
): SessionSettingsSync {
    const {
        document,
        workspaceFolderUri,
        state,
        resolveLiveSettings,
        postMessage,
        mapDefsForWebview,
    } = context;
    const { notifyInspectorSessionUpdate } = inspectorSync;

    const refreshSettings = async ({
        refreshDefs = false,
    }: { refreshDefs?: boolean } = {}): Promise<void> => {
        if (refreshDefs) {
            const [freshDefs, freshSettingDir] = await Promise.all([
                resolveNodeDefs(workspaceFolderUri, document.uri),
                getResolvedB3SettingDir(workspaceFolderUri, document.uri),
            ]);
            state.nodeDefs = freshDefs;
            state.settingDir = freshSettingDir;
        }

        state.currentSettings = await resolveLiveSettings();
        await postMessage({
            type: "settingLoaded",
            nodeDefs: mapDefsForWebview(),
            settings: state.currentSettings,
        });
        notifyInspectorSessionUpdate();
    };

    return {
        refreshSettings,
    };
}
