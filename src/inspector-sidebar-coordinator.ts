import * as vscode from "vscode";
import type {
    HostDocumentSessionState,
    HostDocumentSnapshot,
    HostSelectionState,
} from "../webview/shared/contracts";
import type { EditorToHostMessage, HostToEditorMessage } from "../webview/shared/message-protocol";
import { isJsonEqual } from "../webview/shared/json";
import { InspectorSidebarProvider } from "./inspector-sidebar-provider";

type InitMessage = Extract<HostToEditorMessage, { type: "init" }>;
type VarsMessage = Extract<HostToEditorMessage, { type: "varDeclLoaded" }>;

export interface InspectorSessionSnapshot {
    documentUri: string;
    initMessage: InitMessage;
    varsMessage: VarsMessage;
    documentSnapshot: HostDocumentSnapshot;
    selectionRevision: number;
}

const buildReloadDocumentSnapshot = (
    content: string,
    documentSession: HostDocumentSessionState,
    selection: HostSelectionState
): HostDocumentSnapshot => ({
    content,
    documentSession,
    selection,
    syncKind: "reload",
});

// content/documentSession/selection replay through documentSnapshotChanged; the rest
// of init must stay equal for incremental sidebar updates to be safe.
const stripSnapshotTransportFields = (
    initMessage: InspectorSessionSnapshot["initMessage"]
): Omit<InspectorSessionSnapshot["initMessage"], "content" | "documentSession" | "selection"> => {
    const { content, documentSession, selection, ...rest } = initMessage;
    void content;
    void documentSession;
    void selection;
    return rest;
};

const buildEmbeddedModeSettingsMessage = (
    snapshot: InspectorSessionSnapshot | null
): Extract<HostToEditorMessage, { type: "settingLoaded" }> => ({
    type: "settingLoaded",
    nodeDefs: snapshot?.initMessage.nodeDefs ?? [],
    settings: {
        checkExpr: snapshot?.initMessage.checkExpr,
        subtreeEditable: snapshot?.initMessage.subtreeEditable,
        language: snapshot?.initMessage.language,
        inspectorMode: "embedded",
        nodeColors: snapshot?.initMessage.nodeColors,
    },
});

export class InspectorSidebarCoordinator {
    private readonly sessionSnapshots = new Map<string, InspectorSessionSnapshot>();
    private view: vscode.WebviewView | null = null;
    private viewReady = false;
    private activeDocumentUri: string | null = null;
    private inspectorMode: "sidebar" | "embedded" = "sidebar";
    private revealInFlight = false;
    private sessionMessageDispatcher:
        | ((
              documentUri: string,
              message: EditorToHostMessage,
              reply: (message: HostToEditorMessage) => Thenable<boolean>
          ) => boolean | Promise<boolean>)
        | null = null;

    setMessageDispatcher(
        dispatcher: (
            documentUri: string,
            message: EditorToHostMessage,
            reply: (message: HostToEditorMessage) => Thenable<boolean>
        ) => boolean | Promise<boolean>
    ): void {
        this.sessionMessageDispatcher = dispatcher;
    }

    attachView(view: vscode.WebviewView): void {
        this.view = view;
        this.viewReady = false;
    }

    markViewReady(): void {
        this.viewReady = true;
        void this.postActiveSnapshot();
    }

    clearView(): void {
        this.view = null;
        this.viewReady = false;
    }

    toggleNodeJsonView(): void {
        if (this.inspectorMode !== "sidebar") {
            return;
        }

        const snapshot =
            (this.activeDocumentUri && this.sessionSnapshots.get(this.activeDocumentUri)) ?? null;
        if (!snapshot || snapshot.documentSnapshot.selection.kind !== "node") {
            return;
        }

        void this.postMessage({ type: "toggleInspectorNodeJson" });
    }

    setInspectorMode(mode: "sidebar" | "embedded"): void {
        this.inspectorMode = mode;
        if (!this.viewReady) {
            return;
        }
        void this.postActiveSnapshot();
    }

    setTheme(theme: "dark" | "light"): void {
        for (const [documentUri, snapshot] of this.sessionSnapshots) {
            this.sessionSnapshots.set(documentUri, {
                ...snapshot,
                initMessage: {
                    ...snapshot.initMessage,
                    theme,
                },
            });
        }

        if (!this.viewReady) {
            return;
        }

        void this.postMessage({ type: "themeChanged", theme });
    }

    updateSession(snapshot: InspectorSessionSnapshot): void {
        const previous = this.sessionSnapshots.get(snapshot.documentUri);
        this.sessionSnapshots.set(snapshot.documentUri, snapshot);

        if (snapshot.documentUri !== this.activeDocumentUri) {
            return;
        }

        if (this.inspectorMode === "embedded") {
            if (!this.viewReady) {
                return;
            }
            // Embedded inspector state belongs to the editor webview, so the sidebar only keeps settings.
            void this.postEmbeddedModeState(snapshot);
            return;
        }

        if (
            this.inspectorMode === "sidebar" &&
            (!previous || previous.selectionRevision !== snapshot.selectionRevision)
        ) {
            // selectionRevision only signals an observable selection change that may need reveal/focus.

            void this.revealInspectorView();
        }

        if (!this.viewReady) {
            return;
        }

        if (!previous || !this.canIncrementallyUpdate(previous, snapshot)) {
            void this.postFullSnapshot(snapshot);
            return;
        }

        if (!isJsonEqual(previous.documentSnapshot, snapshot.documentSnapshot)) {
            void this.postMessage({
                type: "documentSnapshotChanged",
                snapshot: snapshot.documentSnapshot,
            });
        }

        if (!isJsonEqual(previous.varsMessage, snapshot.varsMessage)) {
            void this.postMessage(snapshot.varsMessage);
        }
    }

    removeSession(documentUri: string): void {
        this.sessionSnapshots.delete(documentUri);
        if (documentUri === this.activeDocumentUri) {
            void this.postActiveSnapshot();
        }
    }

    notifyDocumentSaved(
        documentUri: string,
        content: string,
        documentSession: HostDocumentSessionState
    ): void {
        const snapshot = this.sessionSnapshots.get(documentUri);
        if (snapshot) {
            const nextSnapshot: InspectorSessionSnapshot = {
                ...snapshot,
                initMessage: {
                    ...snapshot.initMessage,
                    content,
                    documentSession,
                },
                documentSnapshot: buildReloadDocumentSnapshot(
                    content,
                    documentSession,
                    snapshot.documentSnapshot.selection
                ),
            };
            this.sessionSnapshots.set(documentUri, nextSnapshot);
        }

        if (
            this.inspectorMode === "embedded" ||
            documentUri !== this.activeDocumentUri ||
            !this.viewReady
        ) {
            return;
        }
        if (!snapshot) {
            return;
        }

        void this.postMessage({
            type: "documentSnapshotChanged",
            snapshot: buildReloadDocumentSnapshot(
                content,
                documentSession,
                snapshot.documentSnapshot.selection
            ),
        });
    }

    setActiveDocument(documentUri: string | null): void {
        const previousDocumentUri = this.activeDocumentUri;
        this.activeDocumentUri = documentUri;

        if (
            this.inspectorMode === "sidebar" &&
            documentUri &&
            documentUri !== previousDocumentUri
        ) {
            void this.revealInspectorView();
        }

        if (!this.viewReady) {
            return;
        }
        void this.postActiveSnapshot();
    }

    async dispatchMessage(
        message: EditorToHostMessage,
        reply: (message: HostToEditorMessage) => Thenable<boolean>
    ): Promise<void> {
        const documentUri = this.activeDocumentUri;
        if (!documentUri || !this.sessionMessageDispatcher) {
            await this.replyUnavailable(message, reply);
            return;
        }

        const handled = await this.sessionMessageDispatcher(documentUri, message, reply);
        if (!handled) {
            await this.replyUnavailable(message, reply);
        }
    }

    private canIncrementallyUpdate(
        previous: InspectorSessionSnapshot,
        next: InspectorSessionSnapshot
    ): boolean {
        const prevInitWithoutContent = stripSnapshotTransportFields(previous.initMessage);
        const nextInitWithoutContent = stripSnapshotTransportFields(next.initMessage);
        // Incremental reuse is safe only when the non-transport init metadata still matches.
        return isJsonEqual(prevInitWithoutContent, nextInitWithoutContent);
    }

    private async postActiveSnapshot(): Promise<void> {
        if (this.inspectorMode === "embedded") {
            const snapshot = this.activeDocumentUri
                ? this.sessionSnapshots.get(this.activeDocumentUri) ?? null
                : null;
            await this.postEmbeddedModeState(snapshot);
            return;
        }

        const snapshot =
            (this.activeDocumentUri && this.sessionSnapshots.get(this.activeDocumentUri)) ?? null;

        if (!snapshot) {
            await this.postMessage({ type: "inspectorContextCleared" });
            return;
        }

        await this.postFullSnapshot(snapshot);
    }

    private async postFullSnapshot(snapshot: InspectorSessionSnapshot): Promise<void> {
        await this.postMessage(snapshot.initMessage);
        await this.postMessage(snapshot.varsMessage);
    }

    private async postEmbeddedModeState(snapshot: InspectorSessionSnapshot | null): Promise<void> {
        // Keep sidebar settings fresh while clearing document-bound context owned by the editor webview.
        await this.postMessage(buildEmbeddedModeSettingsMessage(snapshot));
        await this.postMessage({ type: "inspectorContextCleared" });
    }

    private async postMessage(message: HostToEditorMessage): Promise<void> {
        if (!this.view || !this.viewReady) {
            return;
        }
        await this.view.webview.postMessage(message);
    }

    private async revealInspectorView(): Promise<void> {
        if (this.revealInFlight) {
            return;
        }

        this.revealInFlight = true;
        try {
            if (!this.view || !this.view.visible) {
                // Focus the contributed view/container, then restore editor focus so typing is not stolen.

                try {
                    await vscode.commands.executeCommand(
                        `${InspectorSidebarProvider.viewId}.focus`
                    );
                } catch {
                    if (!this.view) {
                        try {
                            await vscode.commands.executeCommand(
                                `workbench.view.extension.${InspectorSidebarProvider.containerId}`
                            );
                        } catch {
                            return;
                        }
                    }
                }

                try {
                    await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
                } catch {
                    /* ignore focus restore failures */
                }
                return;
            }

            try {
                this.view.show(true);
                return;
            } catch {
                /* ignore reveal failures; selection syncing still works */
            }
        } finally {
            this.revealInFlight = false;
        }
    }

    private async replyUnavailable(
        message: EditorToHostMessage,
        reply: (message: HostToEditorMessage) => Thenable<boolean>
    ): Promise<void> {
        const error = "No active Behavior3 editor is available.";

        switch (message.type) {
            case "saveDocument":
                await reply({
                    type: "saveDocumentResult",
                    requestId: message.requestId,
                    success: false,
                    error,
                });
                return;

            case "revertDocument":
                await reply({
                    type: "revertDocumentResult",
                    requestId: message.requestId,
                    success: false,
                    error,
                });
                return;

            case "mutateDocument":
                await reply({
                    type: "mutateDocumentResult",
                    requestId: message.requestId,
                    success: false,
                    error,
                });
                return;

            case "readFile":
                await reply({
                    type: "readFileResult",
                    requestId: message.requestId,
                    content: null,
                });
                return;

            case "saveSubtree":
                await reply({
                    type: "saveSubtreeResult",
                    requestId: message.requestId,
                    success: false,
                    error,
                });
                return;

            case "saveSubtreeAs":
                await reply({
                    type: "saveSubtreeAsResult",
                    requestId: message.requestId,
                    savedPath: null,
                    error,
                });
                return;

            case "validateNodeChecks":
                await reply({
                    type: "validateNodeChecksResult",
                    requestId: message.requestId,
                    diagnostics: [],
                    error,
                });
                return;

            case "ready":
            case "undo":
            case "redo":
            case "selectTree":
            case "selectNode":
            case "requestFocusVariable":
            case "requestSetting":
            case "build":
            case "webviewLog":
                return;
        }
    }
}
