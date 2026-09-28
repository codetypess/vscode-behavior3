import { createStore, type StoreApi } from "zustand/vanilla";
import type { SelectionState } from "../shared/contracts";

export const createInitialSelectionState = (): SelectionState => ({
    selectedTree: null,
    selectedNodeKey: null,
    selectedNodeRef: null,
    selectedNodeSnapshot: null,
    inspectorSurface: null,
});

export const createSelectionStore = (): StoreApi<SelectionState> => {
    return createStore<SelectionState>(() => createInitialSelectionState());
};
