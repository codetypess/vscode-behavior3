import { createStore, type StoreApi } from "zustand/vanilla";
import type { DocumentState, HostDocumentSessionState } from "../shared/contracts";

export const showDocumentReloadConflict = (
    store: StoreApi<DocumentState>,
    content: string
): void => {
    store.setState((state) => ({
        ...state,
        alertReload: true,
        pendingExternalContent: content,
    }));
};

export const clearDocumentReloadConflict = (store: StoreApi<DocumentState>): void => {
    store.setState((state) => ({
        ...state,
        alertReload: false,
        pendingExternalContent: null,
    }));
};

export const markDocumentSaved = (store: StoreApi<DocumentState>, snapshot: string): void => {
    store.setState((state) => ({
        ...state,
        lastSavedSnapshot: snapshot,
        dirty: false,
        alertReload: false,
        pendingExternalContent: null,
    }));
};

export const applyHostDocumentSession = (
    store: StoreApi<DocumentState>,
    session: HostDocumentSessionState
): void => {
    store.setState((state) => ({
        ...state,
        dirty: session.dirty,
        alertReload: session.alertReload,
        pendingExternalContent: session.pendingExternalContent,
        lastSavedSnapshot: session.lastSavedSnapshot,
        hostHistoryIndex: session.historyIndex,
        hostHistoryLength: session.historyLength,
    }));
};

export const createInitialDocumentState = (): DocumentState => ({
    persistedTree: null,
    dirty: false,
    alertReload: false,
    pendingExternalContent: null,
    history: [],
    historyIndex: -1,
    lastSavedSnapshot: null,
    hostHistoryIndex: -1,
    hostHistoryLength: 0,
});

export const createDocumentStore = (): StoreApi<DocumentState> => {
    return createStore<DocumentState>(() => createInitialDocumentState());
};
