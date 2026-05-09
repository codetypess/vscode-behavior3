import type {
    GraphEventHandlers,
    GraphHighlightState,
    GraphSearchState,
    GraphSelectionState,
    GraphViewport,
    ResolvedGraphModel,
} from "./contracts";

export interface GraphRenderOptions {
    anchorNodeKey?: string | null;
}

export interface GraphAdapter {
    mount(container: HTMLElement, handlers: GraphEventHandlers): Promise<void>;
    unmount(): void;
    render(model: ResolvedGraphModel, opts?: GraphRenderOptions): Promise<void>;
    pickNearestNodeAnchor?(sourceNodeKey: string, candidateNodeKeys: string[]): string | null;
    applySelection(selection: GraphSelectionState): Promise<void>;
    applyHighlights(highlights: GraphHighlightState): Promise<void>;
    applySearch(search: GraphSearchState): Promise<void>;
    focusNode(nodeKey: string): Promise<void>;
    restoreViewport(viewport: GraphViewport): Promise<void>;
    getViewport(): GraphViewport;
}
