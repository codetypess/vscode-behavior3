import * as vscode from "vscode";
import { uriToWorkdirRelative } from "../files/paths";
import type { SessionInspectorSync } from "./inspector-sync";
import type { TreeEditorSessionContext } from "./context";

export interface SessionSubtreeTracking {
    invalidateSubtreeRefs(): void;
    refreshTrackedSubtreeRefs(): Promise<void>;
    scheduleTrackedSubtreeRefresh(uri: vscode.Uri): void;
    flushTrackedSubtreeRefresh(uri: vscode.Uri): void;
    clearSubtreeRefreshTimer(): void;
}

function clearRefreshTimer(timer: ReturnType<typeof setTimeout> | undefined): undefined {
    if (timer) {
        clearTimeout(timer);
    }
    return undefined;
}

export function createSessionSubtreeTracking(
    context: TreeEditorSessionContext,
    inspectorSync: SessionInspectorSync
): SessionSubtreeTracking {
    const { document, projectIndex, projectRootUri, state, postMessage } = context;
    const {
        buildInspectorVarsMessage,
        notifyInspectorSessionUpdate,
        refreshLatestVarDeclsFromContent,
    } = inspectorSync;

    const invalidateSubtreeRefs = () => {
        state.cachedSubtreeRefs = null;
    };

    /** Cache the transitive subtree closure of the current main document. */
    const refreshTrackedSubtreeRefs = async () => {
        state.cachedSubtreeRefs = await projectIndex.getTransitiveSubtreeRelativePaths(
            document.content
        );
    };

    const isTrackedSubtreeDocument = (uri: vscode.Uri): boolean => {
        const rel = uriToWorkdirRelative(uri, projectRootUri);
        return !!rel && Boolean(state.cachedSubtreeRefs?.has(rel));
    };

    const flushParentSubtreeRefresh = () => {
        void (async () => {
            await refreshLatestVarDeclsFromContent(document.content);
            await postMessage(buildInspectorVarsMessage());
            notifyInspectorSessionUpdate();
            await postMessage({ type: "subtreeFileChanged" });
        })();
    };

    const isMainDocumentUri = (uri: vscode.Uri): boolean =>
        uri.toString() === document.uri.toString();

    const scheduleParentSubtreeRefresh = () => {
        state.subtreeRefreshTimer = clearRefreshTimer(state.subtreeRefreshTimer);
        state.subtreeRefreshTimer = setTimeout(() => {
            state.subtreeRefreshTimer = undefined;
            flushParentSubtreeRefresh();
        }, 450);
    };

    const scheduleTrackedSubtreeRefresh = (uri: vscode.Uri): void => {
        if (isMainDocumentUri(uri) || !isTrackedSubtreeDocument(uri)) {
            return;
        }
        scheduleParentSubtreeRefresh();
    };

    const flushTrackedSubtreeRefresh = (uri: vscode.Uri): void => {
        if (isMainDocumentUri(uri) || !isTrackedSubtreeDocument(uri)) {
            return;
        }
        state.subtreeRefreshTimer = clearRefreshTimer(state.subtreeRefreshTimer);
        flushParentSubtreeRefresh();
    };

    const clearSubtreeRefreshTimer = (): void => {
        state.subtreeRefreshTimer = clearRefreshTimer(state.subtreeRefreshTimer);
    };

    return {
        invalidateSubtreeRefs,
        refreshTrackedSubtreeRefs,
        scheduleTrackedSubtreeRefresh,
        flushTrackedSubtreeRefresh,
        clearSubtreeRefreshTimer,
    };
}
