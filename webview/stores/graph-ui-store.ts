import { createStore, type StoreApi } from "zustand/vanilla";
import type { GraphUiSearchState, GraphUiState } from "../shared/contracts";

export const createInitialGraphUiSearchState = (): GraphUiSearchState => ({
    open: false,
    mode: "content",
    query: "",
    caseSensitive: false,
    focusOnly: true,
    results: [],
    index: 0,
});

export const patchGraphUiSearchState = (
    store: StoreApi<GraphUiState>,
    patch: Partial<GraphUiSearchState>
): void => {
    store.setState((state) => ({
        ...state,
        search: {
            ...state.search,
            ...patch,
        },
    }));
};

export const resetGraphUiSearchState = (store: StoreApi<GraphUiState>): void => {
    store.setState((state) => ({
        ...state,
        search: createInitialGraphUiSearchState(),
    }));
};

export const createInitialGraphUiState = (): GraphUiState => ({
    activeVariableNames: [],
    selectionVisualHint: null,
    search: createInitialGraphUiSearchState(),
});

export const createGraphUiStore = (): StoreApi<GraphUiState> => {
    return createStore<GraphUiState>(() => createInitialGraphUiState());
};
