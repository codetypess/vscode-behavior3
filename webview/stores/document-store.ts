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

export const applyHostDocumentSession = (
    store: StoreApi<DocumentState>,
    session: HostDocumentSessionState
): void => {
    // The extension host owns dirty/conflict state because it observes VS Code save/reload events.
    store.setState((state) => ({
        ...state,
        dirty: session.dirty,
        alertReload: session.alertReload,
        pendingExternalContent: session.pendingExternalContent,
    }));
};

export const createInitialDocumentState = (): DocumentState => ({
    persistedTree: null,
    dirty: false,
    alertReload: false,
    pendingExternalContent: null,
});

export const createDocumentStore = (): StoreApi<DocumentState> => {
    return createStore<DocumentState>(() => createInitialDocumentState());
};
