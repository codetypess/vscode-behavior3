import {
    CanvasEvent as G6CanvasEvent,
    Graph as G6Graph,
    GraphEvent as G6GraphEvent,
    type IEvent as G6Event,
    type IPointerEvent as G6PointerEvent,
    NodeEvent as G6NodeEvent,
    treeToGraphData,
    type GraphData as G6GraphData,
    type NodeData as G6NodeData,
} from "@antv/g6";
import type {
    DropIntent,
    GraphEventHandlers,
    GraphHighlightState,
    GraphNodeVM,
    GraphSearchState,
    GraphSelectionState,
    GraphViewport,
    NodeInstanceRef,
    ResolvedGraphModel,
} from "../../shared/contracts";
import type { GraphAdapter, GraphRenderOptions } from "../../shared/graph-contracts";
import {
    G6_GRAPH_NODE_H_GAP,
    G6_GRAPH_NODE_MIN_HEIGHT,
    G6_GRAPH_NODE_V_GAP,
    G6_GRAPH_NODE_WIDTH,
    G6_GRAPH_NODE_TYPE,
    getGraphThemeColor,
    getGraphNodeStateStyle,
    type GraphNodeDatum,
    type GraphNodeState,
    measureGraphNode,
    registerGraphNode,
} from "./g6-graph-node";
import {
    readG6CanvasPoint,
    isRenderedG6Graph,
    readG6EventTargetId,
    readG6NodeDisplayId,
    readG6Viewport,
    readG6NodeDatum,
    setG6EdgeOptions,
    setG6NodeOptions,
    toG6ElementState,
    toG6NodeDataRecord,
} from "./g6-compat";
import {
    expandCollapsedAncestorsForNode,
    getVisibleChildKeys,
    isCollapsedNodeRef,
    isSameNodeIdentity,
    pruneCollapsedNodeRefs,
    toggleCollapsedNodeRefs,
} from "./graph-collapse-state";
import { eventHasShapeClass } from "./graph-event-shape";
import { handleNativeWheelZoom } from "./g6-wheel-zoom";

const DEFAULT_VIEWPORT: GraphViewport = { zoom: 1, x: 0, y: 0 };
const DEFAULT_PORTS = [
    { key: "right", placement: "right" as const },
    { key: "left", placement: "left" as const },
];

const createNodeOptions = (): any => ({
    type: G6_GRAPH_NODE_TYPE,
    style: {
        ports: DEFAULT_PORTS,
    },
    state: toG6ElementState(getGraphNodeStateStyle()),
});

const createEdgeOptions = (): any => ({
    type: "cubic-horizontal",
    style: {
        lineWidth: 2,
        stroke: getGraphThemeColor("--b3-graph-edge", "#A3B1BF"),
    },
});

type DragIntentState = {
    sourceKey: string | null;
    targetKey: string | null;
    position: DropIntent["position"] | null;
};

type TreeDatum = {
    id: string;
    nodeData: G6NodeData;
    children: TreeDatum[];
};

type ViewportAnchorCandidate = {
    ref: NodeInstanceRef;
    viewportPosition: [number, number];
};

type ViewportAnchor = {
    candidates: ViewportAnchorCandidate[];
};

const isDefaultViewport = (viewport: GraphViewport) =>
    viewport.zoom === DEFAULT_VIEWPORT.zoom &&
    viewport.x === DEFAULT_VIEWPORT.x &&
    viewport.y === DEFAULT_VIEWPORT.y;

const toDragState = (position: DropIntent["position"] | null): GraphNodeState | null => {
    if (position === "before") {
        return "dragup";
    }
    if (position === "after") {
        return "dragdown";
    }
    if (position === "child") {
        return "dragright";
    }
    return null;
};

const getLayoutOrder = (node: G6NodeData): number => {
    const displayId = readG6NodeDisplayId(node);
    const order = Number(displayId ?? node.id);
    return Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER;
};

const compareLayoutOrder = (nodeA: G6NodeData, nodeB: G6NodeData): number => {
    const diff = getLayoutOrder(nodeA) - getLayoutOrder(nodeB);
    if (diff !== 0) {
        return diff;
    }
    return String(nodeA.id).localeCompare(String(nodeB.id));
};

/**
 * G6 boundary implementation.
 * It receives resolved graph/view state from the controller and keeps G6
 * layout, viewport, drag, and visual selection details out of domain code.
 */
export class G6GraphAdapter implements GraphAdapter {
    private container: HTMLElement | null = null;
    private handlers: GraphEventHandlers | null = null;
    private graph: G6Graph | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private resizeRestoreFrame: number | null = null;
    private model: ResolvedGraphModel | null = null;
    private selection: GraphSelectionState = { selectedNodeKey: null };
    private highlights: GraphHighlightState = { activeVariableNames: [], variableHits: {} };
    private search: GraphSearchState = {
        query: "",
        mode: "content",
        caseSensitive: false,
        focusOnly: true,
        resultKeys: [],
        activeResultIndex: 0,
    };
    private focusedNodeKey: string | null = null;
    private viewport: GraphViewport = { ...DEFAULT_VIEWPORT };
    private dragIntent: DragIntentState = {
        sourceKey: null,
        targetKey: null,
        position: null,
    };
    private collapsedNodeRefs: NodeInstanceRef[] = [];
    private suppressTransformSync = false;

    private syncThemeOptions() {
        if (!this.graph) {
            return;
        }

        setG6NodeOptions(this.graph, createNodeOptions());
        setG6EdgeOptions(this.graph, createEdgeOptions());
    }

    private readonly handleGraphTransform = () => {
        if (this.suppressTransformSync || !this.graph) {
            return;
        }
        this.syncViewportFromGraph();
    };

    private getWheelViewportOrigin(event: WheelEvent): [number, number] | undefined {
        const container = this.container;
        if (!container) {
            return undefined;
        }

        const rect = container.getBoundingClientRect();
        return [event.clientX - rect.left, event.clientY - rect.top];
    }

    private readonly applyWheelZoom = async (
        ratio: number,
        origin: [number, number] | undefined
    ) => {
        if (!this.graph || !this.isGraphRendered()) {
            return;
        }

        await this.graph.zoomTo(this.graph.getZoom() * ratio, false, origin);
        this.syncViewportFromGraph();
    };

    private readonly handleNativeWheel = (event: WheelEvent) => {
        handleNativeWheelZoom({
            event,
            isEnabled: () => Boolean(this.graph && this.isGraphRendered()),
            getOrigin: () => this.getWheelViewportOrigin(event),
            zoomTo: (ratio, origin) => this.applyWheelZoom(ratio, origin),
        });
    };

    private isGraphRendered() {
        return isRenderedG6Graph(this.graph);
    }

    private readViewportFromGraph(): GraphViewport | null {
        return readG6Viewport(this.graph);
    }

    private readViewportAnchorCandidate(nodeKey: string): ViewportAnchorCandidate | null {
        if (!this.graph?.hasNode(nodeKey)) {
            return null;
        }
        const node = this.getNodeVM(nodeKey);
        if (!node) {
            return null;
        }
        try {
            const canvasPosition = this.graph.getElementPosition(nodeKey);
            const viewportPosition = this.graph.getViewportByCanvas(canvasPosition);
            const x = viewportPosition[0];
            const y = viewportPosition[1];
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                return null;
            }
            return {
                ref: node.ref,
                viewportPosition: [x, y],
            };
        } catch {
            return null;
        }
    }

    private readViewportAnchor(
        nodeKey: string | null | undefined,
        opts?: { skipMissingCandidates?: boolean }
    ): ViewportAnchor | null {
        if (!nodeKey || !this.graph || !this.isGraphRendered()) {
            return null;
        }

        const candidates: ViewportAnchorCandidate[] = [];
        let currentKey: string | null = nodeKey;
        while (currentKey) {
            // Save the node and its ancestors so a surviving parent can anchor after collapse/rebuild.
            const candidate = this.readViewportAnchorCandidate(currentKey);
            if (!candidate && !opts?.skipMissingCandidates) {
                break;
            }
            if (candidate) {
                candidates.push(candidate);
            }
            currentKey = this.getNodeVM(currentKey)?.parentKey ?? null;
        }

        return candidates.length > 0 ? { candidates } : null;
    }

    private readViewportCenterAnchor(): ViewportAnchor | null {
        if (!this.graph || !this.model || !this.isGraphRendered()) {
            return null;
        }

        const width = this.container?.clientWidth ?? 0;
        const height = this.container?.clientHeight ?? 0;
        if (width <= 0 || height <= 0) {
            return null;
        }

        const center: [number, number] = [width / 2, height / 2];
        let best: { nodeKey: string; distance: number } | null = null;
        for (const node of this.model.nodes) {
            const nodeKey = node.ref.instanceKey;
            if (!this.graph.hasNode(nodeKey)) {
                continue;
            }
            try {
                const canvasPosition = this.graph.getElementPosition(nodeKey);
                const viewportPosition = this.graph.getViewportByCanvas(canvasPosition);
                const distance = Math.hypot(
                    viewportPosition[0] - center[0],
                    viewportPosition[1] - center[1]
                );
                if (!best || distance < best.distance) {
                    best = { nodeKey, distance };
                }
            } catch {
                /* Try the next node. */
            }
        }

        return best ? this.readViewportAnchor(best.nodeKey) : null;
    }

    private resolveViewportAnchorCandidate(anchor: ViewportAnchor): {
        candidate: ViewportAnchorCandidate;
        nodeKey: string;
    } | null {
        for (const candidate of anchor.candidates) {
            // Resolve by logical identity because instance keys can change after graph rebuilds.
            const node = this.model?.nodes.find((entry) =>
                isSameNodeIdentity(entry.ref, candidate.ref)
            );
            if (node?.ref.instanceKey && this.graph?.hasNode(node.ref.instanceKey)) {
                return { candidate, nodeKey: node.ref.instanceKey };
            }
        }
        return null;
    }

    private async applyAnchorViewportCompensation(anchor: ViewportAnchor | null): Promise<void> {
        const resolved = anchor ? this.resolveViewportAnchorCandidate(anchor) : null;
        if (
            !anchor ||
            !resolved ||
            !this.graph ||
            !this.isGraphRendered() ||
            !this.graph.hasNode(resolved.nodeKey)
        ) {
            return;
        }

        let deltaX = 0;
        let deltaY = 0;
        try {
            const canvasPosition = this.graph.getElementPosition(resolved.nodeKey);
            const viewportPosition = this.graph.getViewportByCanvas(canvasPosition);
            deltaX = resolved.candidate.viewportPosition[0] - viewportPosition[0];
            deltaY = resolved.candidate.viewportPosition[1] - viewportPosition[1];
        } catch {
            return;
        }

        if (Math.abs(deltaX) < 0.01 && Math.abs(deltaY) < 0.01) {
            return;
        }

        this.suppressTransformSync = true;
        try {
            await this.graph.translateBy([deltaX, deltaY], false);
            this.syncViewportFromGraph();
        } finally {
            this.suppressTransformSync = false;
        }
    }

    private getNodeVM(nodeKey: string): GraphNodeVM | null {
        return this.model?.nodes.find((node) => node.ref.instanceKey === nodeKey) ?? null;
    }

    private async handleCollapseToggle(node: GraphNodeVM): Promise<void> {
        const anchor = this.readViewportAnchor(node.ref.instanceKey);
        this.collapsedNodeRefs = toggleCollapsedNodeRefs(this.collapsedNodeRefs, node.ref);
        await this.renderGraphData(anchor);
    }

    private async ensureNodeVisible(nodeKey: string): Promise<void> {
        if (!this.graph || !this.model || this.graph.hasNode(nodeKey)) {
            return;
        }

        const nextCollapsedNodeRefs = expandCollapsedAncestorsForNode(
            this.collapsedNodeRefs,
            this.model,
            nodeKey
        );
        if (nextCollapsedNodeRefs.length === this.collapsedNodeRefs.length) {
            return;
        }

        const anchor = this.readViewportAnchor(nodeKey, { skipMissingCandidates: true });
        this.collapsedNodeRefs = nextCollapsedNodeRefs;
        await this.renderGraphData(anchor);
    }

    private getNodeDatum(node: GraphNodeVM): GraphNodeDatum {
        const size = measureGraphNode(node);
        return {
            vm: node,
            width: size.width,
            height: size.height,
        };
    }

    private getNodeStates(node: GraphNodeVM): GraphNodeState[] {
        const states: GraphNodeState[] = [];
        const nodeKey = node.ref.instanceKey;
        const variableHits = this.highlights.variableHits[nodeKey] ?? [];
        const shouldGrayForVariableHighlight =
            this.highlights.activeVariableNames.length > 0 && variableHits.length === 0;
        const shouldGrayForSearch =
            this.search.focusOnly &&
            this.search.query.length > 0 &&
            !this.search.resultKeys.includes(nodeKey);

        if (this.selection.selectedNodeKey === nodeKey) {
            states.push("selected");
        }
        if (this.focusedNodeKey === nodeKey) {
            states.push("focused");
        }
        if (shouldGrayForVariableHighlight || shouldGrayForSearch) {
            states.push("highlightgray");
        }

        if (variableHits.includes("args")) {
            states.push("highlightargs");
        }
        if (variableHits.includes("input")) {
            states.push("highlightinput");
        }
        if (variableHits.includes("output")) {
            states.push("highlightoutput");
        }

        if (this.dragIntent.sourceKey === nodeKey) {
            states.push("dragsrc");
        }
        if (this.dragIntent.targetKey === nodeKey) {
            const dragState = toDragState(this.dragIntent.position);
            if (dragState) {
                states.push(dragState);
            }
        }

        return states;
    }

    private refreshNodeStates() {
        if (!this.graph || !this.model || !this.isGraphRendered()) {
            return;
        }

        for (const node of this.model.nodes) {
            if (!this.graph.hasNode(node.ref.instanceKey)) {
                continue;
            }
            this.graph.setElementState(node.ref.instanceKey, this.getNodeStates(node));
        }
    }

    private buildTreeDatum(nodeKey: string): TreeDatum | null {
        const node = this.getNodeVM(nodeKey);
        if (!node) {
            return null;
        }

        const datum = this.getNodeDatum(node);
        const collapsed = isCollapsedNodeRef(this.collapsedNodeRefs, node.ref);
        const visibleChildKeys = getVisibleChildKeys(node, this.collapsedNodeRefs);
        return {
            id: nodeKey,
            nodeData: {
                id: node.ref.instanceKey,
                type: G6_GRAPH_NODE_TYPE,
                data: toG6NodeDataRecord(datum),
                style: {
                    size: [datum.width, datum.height],
                    cursor: "pointer",
                    collapsed,
                    draggable: !node.subtreeNode,
                    ports: DEFAULT_PORTS,
                },
                children: visibleChildKeys,
                depth: node.depth,
            },
            children: visibleChildKeys
                .map((childKey) => this.buildTreeDatum(childKey))
                .filter((child): child is TreeDatum => Boolean(child)),
        };
    }

    private buildGraphData(model: ResolvedGraphModel): G6GraphData | null {
        const root = this.buildTreeDatum(model.rootKey);
        if (!root) {
            return null;
        }

        return treeToGraphData(root, {
            getNodeData: (entry) => entry.nodeData,
            getEdgeData: (source, target) => ({
                id: `${source.id}->${target.id}`,
                source: source.id,
                sourcePort: "right",
                target: target.id,
                targetPort: "left",
            }),
            getChildren: (entry) => entry.children ?? [],
        });
    }

    private async rerenderWithStableViewport(viewport: GraphViewport | null): Promise<void> {
        if (!this.graph) {
            return;
        }

        if (!viewport) {
            await this.graph.render();
            return;
        }

        this.suppressTransformSync = true;
        try {
            if (!this.isGraphRendered()) {
                await this.graph.render();
            }
            await this.graph.zoomTo(1, false);
            await this.graph.translateTo([0, 0], false);
            await this.graph.render();
            await this.applyViewportSnapshot(viewport);
        } finally {
            this.suppressTransformSync = false;
        }
    }

    private async renderGraphData(anchor: ViewportAnchor | null = null): Promise<void> {
        if (!this.graph) {
            return;
        }

        this.cancelPendingResizeRestore();

        if (!this.model || this.model.nodes.length === 0) {
            await this.graph.clear();
            return;
        }

        const data = this.buildGraphData(this.model);
        if (!data) {
            await this.graph.clear();
            return;
        }

        // Preserve the last requested viewport exactly as-is. Reading it back from G6 on every
        // rerender can accumulate tiny coordinate errors and cause the canvas to drift.
        const viewport = { ...this.viewport };
        await this.graph.clear();
        this.graph.setData(data);
        await this.rerenderWithStableViewport(viewport);
        await this.applyAnchorViewportCompensation(anchor);
        if (isDefaultViewport(this.viewport)) {
            this.syncViewportFromGraph();
        }
        this.refreshNodeStates();
    }

    private async applyViewportSnapshot(viewport: GraphViewport): Promise<void> {
        if (!this.graph || !this.isGraphRendered()) {
            this.viewport = { ...viewport };
            return;
        }

        await this.graph.zoomTo(viewport.zoom, false);
        await this.graph.translateTo([viewport.x, viewport.y], false);
        this.viewport = { ...viewport };
    }

    private async applyViewport(viewport: GraphViewport): Promise<void> {
        if (!this.graph) {
            return;
        }

        if (!this.isGraphRendered()) {
            this.viewport = { ...viewport };
            return;
        }

        this.suppressTransformSync = true;
        try {
            await this.applyViewportSnapshot(viewport);
        } finally {
            this.suppressTransformSync = false;
        }
    }

    private scheduleResizeViewportRestore(viewport: GraphViewport, anchor: ViewportAnchor | null) {
        this.cancelPendingResizeRestore();
        this.resizeRestoreFrame = window.requestAnimationFrame(() => {
            this.resizeRestoreFrame = null;
            void (async () => {
                await this.applyViewport(viewport);
                await this.applyAnchorViewportCompensation(anchor);
            })();
        });
    }

    private cancelPendingResizeRestore() {
        if (this.resizeRestoreFrame == null) {
            return;
        }
        window.cancelAnimationFrame(this.resizeRestoreFrame);
        this.resizeRestoreFrame = null;
    }

    private syncViewportFromGraph() {
        const viewport = this.readViewportFromGraph();
        if (viewport) {
            this.viewport = viewport;
        }
    }

    private updateDragIntent(targetKey: string | null, position: DropIntent["position"] | null) {
        if (this.dragIntent.targetKey === targetKey && this.dragIntent.position === position) {
            return;
        }

        this.dragIntent = {
            ...this.dragIntent,
            targetKey,
            position,
        };
        this.refreshNodeStates();
    }

    private clearDragIntent() {
        const hadDragIntent =
            this.dragIntent.sourceKey !== null ||
            this.dragIntent.targetKey !== null ||
            this.dragIntent.position !== null;

        this.dragIntent = {
            sourceKey: null,
            targetKey: null,
            position: null,
        };

        if (hadDragIntent) {
            this.refreshNodeStates();
        }
    }

    private readonly handleCanvasClick = () => {
        this.handlers?.onCanvasSelected();
    };

    private readonly handleNodeContextMenu = (event: G6PointerEvent<any>) => {
        const nodeKey = readG6EventTargetId(event);
        if (!nodeKey) {
            return;
        }

        const node = this.getNodeVM(nodeKey);
        if (node) {
            this.handlers?.onNodeSelected(node.ref, { via: "contextMenu" });
        }
    };

    private readonly handleNodeClick = (event: G6PointerEvent<any>) => {
        const nodeKey = readG6EventTargetId(event);
        if (!nodeKey) {
            return;
        }

        const node = this.getNodeVM(nodeKey);
        if (!node) {
            return;
        }

        if (eventHasShapeClass(event, "collapse")) {
            void this.handleCollapseToggle(node);
            return;
        }

        let keepVariableFocus = false;
        if (eventHasShapeClass(event, "input-text")) {
            const variableNames = node.inputs
                .map((entry) => entry.variable)
                .filter((value): value is string => Boolean(value));
            if (variableNames.length > 0) {
                keepVariableFocus = true;
                this.handlers?.onVariableHotspotClicked(node.ref, {
                    kind: "input",
                    variableNames,
                });
            }
        } else if (eventHasShapeClass(event, "output-text")) {
            const variableNames = node.outputs
                .map((entry) => entry.variable)
                .filter((value): value is string => Boolean(value));
            if (variableNames.length > 0) {
                keepVariableFocus = true;
                this.handlers?.onVariableHotspotClicked(node.ref, {
                    kind: "output",
                    variableNames,
                });
            }
        }

        this.handlers?.onNodeSelected(node.ref, {
            via: "click",
            clearVariableFocus: !keepVariableFocus,
        });
    };

    private readonly handleNodeDoubleClick = (event: G6PointerEvent<any>) => {
        const nodeKey = readG6EventTargetId(event);
        if (!nodeKey) {
            return;
        }

        const node = this.getNodeVM(nodeKey);
        if (node) {
            this.handlers?.onNodeDoubleClicked(node.ref);
        }
    };

    private readonly handleNodeDragStart = (event: G6PointerEvent<any>) => {
        const nodeKey = readG6EventTargetId(event);
        if (!nodeKey) {
            return;
        }

        const node = this.getNodeVM(nodeKey);
        if (!node || node.subtreeNode) {
            return;
        }

        this.dragIntent = {
            sourceKey: nodeKey,
            targetKey: null,
            position: null,
        };
        this.refreshNodeStates();
    };

    private readonly handleNodeDragEnd = () => {
        this.clearDragIntent();
    };

    private readonly handleNodeDragEnter = (event: G6PointerEvent<any>) => {
        if (!this.dragIntent.sourceKey) {
            return;
        }

        const nodeKey = readG6EventTargetId(event);
        if (!nodeKey || nodeKey === this.dragIntent.sourceKey) {
            return;
        }

        this.updateDragIntent(nodeKey, this.dragIntent.position);
    };

    private readonly handleNodeDragLeave = (event: G6PointerEvent<any>) => {
        const nodeKey = readG6EventTargetId(event);
        if (!nodeKey || nodeKey === this.dragIntent.sourceKey) {
            return;
        }

        if (this.dragIntent.targetKey === nodeKey) {
            this.updateDragIntent(null, null);
        }
    };

    private readonly handleNodeDrag = (event: G6PointerEvent<any>) => {
        if (!this.graph || !this.dragIntent.sourceKey || !this.dragIntent.targetKey) {
            return;
        }

        const targetKey = this.dragIntent.targetKey;
        const targetDatum = this.graph.getNodeData(targetKey);
        const data = readG6NodeDatum(targetDatum);
        if (!data) {
            return;
        }

        const position = this.graph.getElementPosition(targetKey);
        const canvas = readG6CanvasPoint(event);
        if (!position || !canvas) {
            return;
        }

        const x = canvas[0] - position[0];
        const y = canvas[1] - position[1];
        // Left half drops around the target; right half nests as a child.
        const nextPosition: DropIntent["position"] =
            x > data.width / 2 ? "child" : y > data.height / 2 ? "after" : "before";

        this.updateDragIntent(targetKey, nextPosition);
    };

    private readonly handleNodeDrop = async (event: G6PointerEvent<any>) => {
        if (!this.dragIntent.sourceKey || !this.dragIntent.position) {
            return;
        }

        const targetKey = this.dragIntent.targetKey ?? readG6EventTargetId(event);
        const sourceKey = this.dragIntent.sourceKey;
        const position = this.dragIntent.position;

        this.clearDragIntent();

        if (!targetKey || sourceKey === targetKey) {
            return;
        }

        const source = this.getNodeVM(sourceKey);
        const target = this.getNodeVM(targetKey);
        if (!source || !target) {
            return;
        }

        await this.handlers?.onDropCommitted({
            source: source.ref,
            target: target.ref,
            position,
        });
    };

    async mount(container: HTMLElement, handlers: GraphEventHandlers): Promise<void> {
        this.container = container;
        this.handlers = handlers;
        registerGraphNode();

        const graph = new G6Graph({
            container,
            animation: false,
            zoomRange: [0.25, 2],
            // Wheel zoom is handled locally; G6 zoom-canvas can keep stale modifier keys after editor hotkeys.
            behaviors: ["drag-canvas"],
            node: createNodeOptions(),
            edge: createEdgeOptions(),
            layout: {
                type: "compact-box",
                direction: "LR",
                sortBy: compareLayoutOrder,
                getHeight: (datum: G6NodeData) =>
                    Number(
                        (datum.data as { height?: number } | undefined)?.height ??
                            G6_GRAPH_NODE_MIN_HEIGHT
                    ),
                getWidth: (datum: G6NodeData) =>
                    Number(
                        (datum.data as { width?: number } | undefined)?.width ??
                            G6_GRAPH_NODE_WIDTH
                    ),
                getVGap: () => G6_GRAPH_NODE_V_GAP,
                getHGap: () => G6_GRAPH_NODE_H_GAP,
            },
        });

        graph.on(G6CanvasEvent.CLICK, this.handleCanvasClick);
        graph.on(G6NodeEvent.CONTEXT_MENU, this.handleNodeContextMenu);
        graph.on(G6NodeEvent.CLICK, this.handleNodeClick);
        graph.on(G6NodeEvent.DBLCLICK, this.handleNodeDoubleClick);
        graph.on(G6NodeEvent.DRAG_START, this.handleNodeDragStart);
        graph.on(G6NodeEvent.DRAG_END, this.handleNodeDragEnd);
        graph.on(G6NodeEvent.DRAG_ENTER, this.handleNodeDragEnter);
        graph.on(G6NodeEvent.DRAG_LEAVE, this.handleNodeDragLeave);
        graph.on(G6NodeEvent.DRAG, this.handleNodeDrag);
        graph.on(G6NodeEvent.DROP, this.handleNodeDrop);
        graph.on(G6GraphEvent.AFTER_TRANSFORM, this.handleGraphTransform);
        container.addEventListener("wheel", this.handleNativeWheel, { passive: false });

        this.graph = graph;

        this.resizeObserver = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry || !this.graph) {
                return;
            }

            const viewport = { ...this.viewport };
            // G6 can shift zoomed content during container resize, so keep both the requested
            // viewport and a visible anchor stable across the resize.
            const anchor = this.readViewportCenterAnchor();
            const width = Math.max(1, Math.round(entry.contentRect.width));
            const height = Math.max(1, Math.round(entry.contentRect.height));
            this.graph.resize(width, height);
            this.viewport = { ...viewport };
            this.scheduleResizeViewportRestore(viewport, anchor);
        });
        this.resizeObserver.observe(container);

        await this.renderGraphData();
    }

    unmount(): void {
        this.cancelPendingResizeRestore();
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.container?.removeEventListener("wheel", this.handleNativeWheel);
        this.graph?.destroy();
        this.graph = null;
        this.container = null;
        this.handlers = null;
        this.clearDragIntent();
    }

    async render(model: ResolvedGraphModel, opts?: GraphRenderOptions): Promise<void> {
        const anchor = opts?.anchorNodeKey
            ? this.readViewportAnchor(opts.anchorNodeKey, { skipMissingCandidates: true }) ??
              this.readViewportCenterAnchor()
            : this.readViewportCenterAnchor();
        this.model = model;
        this.collapsedNodeRefs = pruneCollapsedNodeRefs(this.collapsedNodeRefs, model);
        this.clearDragIntent();
        this.syncThemeOptions();
        await this.renderGraphData(anchor);
    }

    pickNearestNodeAnchor(sourceNodeKey: string, candidateNodeKeys: string[]): string | null {
        const source = this.readViewportAnchorCandidate(sourceNodeKey);
        if (!source) {
            return null;
        }

        let best: { nodeKey: string; distance: number } | null = null;
        const seen = new Set<string>();
        for (const nodeKey of candidateNodeKeys) {
            if (nodeKey === sourceNodeKey || seen.has(nodeKey)) {
                continue;
            }
            seen.add(nodeKey);

            const candidate = this.readViewportAnchorCandidate(nodeKey);
            if (!candidate) {
                continue;
            }

            const distance = Math.hypot(
                candidate.viewportPosition[0] - source.viewportPosition[0],
                candidate.viewportPosition[1] - source.viewportPosition[1]
            );
            if (!best || distance < best.distance) {
                best = { nodeKey, distance };
            }
        }

        return best?.nodeKey ?? null;
    }

    async applySelection(selection: GraphSelectionState): Promise<void> {
        this.selection = selection;
        this.refreshNodeStates();
    }

    async applyHighlights(highlights: GraphHighlightState): Promise<void> {
        this.highlights = highlights;
        this.refreshNodeStates();
    }

    async applySearch(search: GraphSearchState): Promise<void> {
        this.search = search;
        if (!search.query || search.resultKeys.length === 0) {
            this.focusedNodeKey = null;
        }
        this.refreshNodeStates();
    }

    async focusNode(nodeKey: string): Promise<void> {
        this.focusedNodeKey = nodeKey;
        await this.ensureNodeVisible(nodeKey);
        this.refreshNodeStates();
        if (this.graph?.hasNode(nodeKey) && this.isGraphRendered()) {
            await this.graph.focusElement(nodeKey, false);
            this.syncViewportFromGraph();
        }
    }

    async restoreViewport(viewport: GraphViewport): Promise<void> {
        this.viewport = { ...viewport };
        await this.applyViewport(viewport);
    }

    getViewport(): GraphViewport {
        return { ...this.viewport };
    }
}

export const createG6GraphAdapter = () => new G6GraphAdapter();
