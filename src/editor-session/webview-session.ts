import * as fs from "fs";
import { createSessionFileRequestHandlers } from "./files/file-request-handlers";
import {
    createTreeEditorSessionContext,
    type ActiveTreeEditorWebview,
    type ResolveTreeEditorSessionParams,
} from "./session/context";
import { createSessionDocumentLifecycle } from "./session/document-lifecycle";
import { createSessionDocumentMutations } from "./session/document-mutations";
import { createSessionDispatcher } from "./session/dispatcher";
import { createFileVersionGuard } from "./session/file-version-guard";
import { createSessionInspectorSync } from "./session/inspector-sync";
import { createSessionNodeChecks } from "./session/node-checks";
import { createSessionReadyHandshake } from "./session/ready-handshake";
import { createSessionSelectionSync } from "./session/selection-sync";
import { createSessionSettingsSync } from "./session/settings-sync";
import { createSessionSubtreeTracking } from "./session/subtree-tracking";
import { registerSessionWatchers } from "./session/watchers";
import { setFs } from "../../webview/shared/b3fs";

export type { ActiveTreeEditorWebview } from "./session/context";

setFs(fs as Parameters<typeof setFs>[0]);

export async function resolveTreeEditorSession(
    params: ResolveTreeEditorSessionParams
): Promise<void> {
    // Composition root for one editor webview; behavior stays in the focused session modules below.
    const context = await createTreeEditorSessionContext(params);
    const {
        document,
        webviewPanel,
        viewType,
        writeDocumentContentToDisk,
        addActiveWebview,
        stageDocumentSelection,
        workspaceFolderUri,
        projectRootUri,
        postMessage,
    } = context;
    const inspectorSync = createSessionInspectorSync(context);
    const subtreeTracking = createSessionSubtreeTracking(context, inspectorSync);
    const fileVersionGuard = createFileVersionGuard(context);
    const { getActiveNewerFileEditMessage, getExistingNewerFileEditMessage } = fileVersionGuard;
    const { refreshSettings } = createSessionSettingsSync(context, inspectorSync);
    const selectionSync = createSessionSelectionSync(context, inspectorSync);
    const { handleSelectTreeMessage, handleSelectNodeMessage } = selectionSync;
    const { handleReadyMessage } = createSessionReadyHandshake(
        context,
        inspectorSync,
        subtreeTracking,
        fileVersionGuard
    );
    const {
        handleSaveDocumentMessage,
        handleHistoryNavigationMessage,
        handleRevertDocumentMessage,
        handleMainDocumentFileChange,
    } = createSessionDocumentLifecycle(context, inspectorSync, subtreeTracking, fileVersionGuard);
    const { handleValidateNodeFieldsMessage, handleResolveNodeFieldVisibilityMessage } =
        createSessionNodeChecks(context);

    const fileRequestHandlers = createSessionFileRequestHandlers({
        projectRootUri,
        viewType,
        stageDocumentSelection,
        writeDocumentContentToDisk,
        getActiveNewerFileEditMessage,
        getExistingNewerFileEditMessage,
    });
    const { handleMutateDocumentMessage } = createSessionDocumentMutations(
        context,
        inspectorSync,
        subtreeTracking,
        fileVersionGuard,
        selectionSync,
        fileRequestHandlers
    );
    const { dispatchEditorMessage } = createSessionDispatcher({
        postMessage,
        handleReadyMessage,
        handleHistoryNavigationMessage,
        handleSelectTreeMessage,
        handleSelectNodeMessage,
        handleMutateDocumentMessage,
        handleSaveDocumentMessage,
        handleRevertDocumentMessage,
        refreshSettings,
        handleValidateNodeFieldsMessage,
        handleResolveNodeFieldVisibilityMessage,
        fileRequestHandlers,
    });

    const activeWebviewEntry: ActiveTreeEditorWebview = {
        workspaceFsPath: workspaceFolderUri.fsPath,
        documentUri: document.uri.toString(),
        postMessage,
        dispatchMessage: async (message, reply = postMessage) => {
            await dispatchEditorMessage(message, reply, "external");
        },
    };
    addActiveWebview(activeWebviewEntry);

    registerSessionWatchers({
        context,
        activeWebviewEntry,
        dispatchEditorMessage,
        refreshSettings,
        handleMainDocumentFileChange,
        subtreeTracking,
    });
}
