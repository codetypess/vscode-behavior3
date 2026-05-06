import * as vscode from "vscode";
import type { HostDocumentSessionState, HostDocumentSnapshot } from "../webview/shared/contracts";
import type { EditorToHostMessage, HostToEditorMessage } from "../webview/shared/message-protocol";
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

const isJsonEqual = (left: unknown, right: unknown) =>
    JSON.stringify(left) === JSON.stringify(right);

export class InspectorSidebarCoordinator {
    private readonly sessionSnapshots = new Map<string, InspectorSessionSnapshot>();
    private view: vscode.WebviewView | null = null;
    private viewReady = false;
    private activeDocumentUri: string | null = null;
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

        if (!previous || previous.selectionRevision !== snapshot.selectionRevision) {
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
            this.sessionSnapshots.set(documentUri, {
                ...snapshot,
                initMessage: {
                    ...snapshot.initMessage,
                    content,
                    documentSession,
                },
                documentSnapshot: {
                    content,
                    documentSession,
                    selection: snapshot.documentSnapshot.selection,
                    syncKind: "reload",
                },
            });
        }

        if (documentUri !== this.activeDocumentUri || !this.viewReady) {
            return;
        }
        if (!snapshot) {
            return;
        }

        void this.postMessage({
            type: "documentSnapshotChanged",
            snapshot: {
                content,
                documentSession,
                selection: snapshot.documentSnapshot.selection,
                syncKind: "reload",
            },
        });
    }

    setActiveDocument(documentUri: string | null): void {
        const previousDocumentUri = this.activeDocumentUri;
        this.activeDocumentUri = documentUri;

        if (documentUri && documentUri !== previousDocumentUri) {
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
        const {
            content: prevContent,
            documentSession: prevDocumentSession,
            selection: prevSelection,
            ...prevInitWithoutContent
        } = previous.initMessage;
        const {
            content: nextContent,
            documentSession: nextDocumentSession,
            selection: nextSelection,
            ...nextInitWithoutContent
        } = next.initMessage;
        void prevContent;
        void nextContent;
        void prevDocumentSession;
        void nextDocumentSession;
        void prevSelection;
        void nextSelection;
        return isJsonEqual(prevInitWithoutContent, nextInitWithoutContent);
    }

    private async postActiveSnapshot(): Promise<void> {
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
            case "focusVariable":
            case "requestSetting":
            case "build":
            case "webviewLog":
                return;
        }
    }
}
