import {
    useDocumentStore,
    useGraphUiStore,
    useSelectionStore,
} from "../../app/runtime";

export const useGraphPaneState = () => {
    const selectedNode = useSelectionStore((state) => state.selectedNodeSnapshot);
    const selectedNodeRef = useSelectionStore((state) => state.selectedNodeRef);
    const searchOpen = useGraphUiStore((state) => state.search.open);
    const rootStableId = useDocumentStore((state) => state.persistedTree?.root.uuid ?? null);

    return {
        selectedNode,
        selectedNodeRef,
        searchOpen,
        rootStableId,
    };
};
