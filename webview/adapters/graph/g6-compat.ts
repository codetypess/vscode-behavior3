import type { Graph as G6Graph, IEvent as G6Event, NodeData as G6NodeData } from "@antv/g6";
import type { GraphViewport } from "../../shared/contracts";
import type { VectorTreeNodeDatum, VectorTreeNodeStateStyleMap } from "./g6-vector-tree-node";

type G6GraphInternal = {
    rendered?: boolean;
    destroyed?: boolean;
    context?: { viewport?: unknown };
    getPosition?: () => [number, number];
    getZoom?: () => number;
};

type G6EventTarget = {
    target?: { id?: unknown };
    canvas?: { x?: unknown; y?: unknown };
};

type G6NodeWithVectorDatum = G6NodeData & {
    data?: Partial<VectorTreeNodeDatum>;
};

export const toG6ElementState = (
    state: VectorTreeNodeStateStyleMap
): Record<string, unknown> => state as unknown as Record<string, unknown>;

export const setG6NodeOptions = (graph: G6Graph, options: Record<string, unknown>): void => {
    graph.setNode(options as any);
};

export const setG6EdgeOptions = (graph: G6Graph, options: Record<string, unknown>): void => {
    graph.setEdge(options as any);
};

export const isRenderedG6Graph = (graph: G6Graph | null): boolean => {
    const candidate = graph as unknown as G6GraphInternal | null;
    return Boolean(candidate?.rendered && !candidate?.destroyed);
};

export const readG6Viewport = (graph: G6Graph | null): GraphViewport | null => {
    const candidate = graph as unknown as G6GraphInternal | null;
    if (
        !candidate?.rendered ||
        candidate.destroyed ||
        !candidate.context?.viewport ||
        !candidate.getPosition ||
        !candidate.getZoom
    ) {
        return null;
    }

    try {
        const [x, y] = candidate.getPosition();
        const zoom = candidate.getZoom();
        if (![x, y, zoom].every((value) => Number.isFinite(value))) {
            return null;
        }
        return { zoom, x, y };
    } catch {
        return null;
    }
};

export const readG6EventTargetId = (event: G6Event): string | null => {
    const target = (event as G6EventTarget).target;
    const id = target?.id;
    return typeof id === "string" || typeof id === "number" ? String(id) : null;
};

export const readG6CanvasPoint = (event: G6Event): [number, number] | null => {
    const canvas = (event as G6EventTarget).canvas;
    const x = canvas?.x;
    const y = canvas?.y;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
    }
    return [x, y];
};

export const readG6NodeDisplayId = (node: G6NodeData): string | number | null => {
    const displayId = (node as G6NodeWithVectorDatum).data?.vm?.ref.displayId;
    return typeof displayId === "string" || typeof displayId === "number" ? displayId : null;
};

export const toG6NodeDataRecord = (datum: VectorTreeNodeDatum): Record<string, unknown> => datum;

export const readG6VectorTreeNodeDatum = (
    node: G6NodeData | null | undefined
): VectorTreeNodeDatum | null => {
    const data = (node as G6NodeWithVectorDatum | null | undefined)?.data;
    if (!data || typeof data.width !== "number" || typeof data.height !== "number" || !data.vm) {
        return null;
    }
    return data as VectorTreeNodeDatum;
};
