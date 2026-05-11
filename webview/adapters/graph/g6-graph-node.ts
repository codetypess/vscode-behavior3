import { Image as GImage, Path as GPath, Rect as GRect, Text as GText } from "@antv/g";
import { DisplayObject, Group } from "@antv/g-lite";
import {
    Badge,
    ExtensionCategory,
    NodeData as G6NodeData,
    Rect,
    RectStyleProps,
    UpsertHooks,
    register,
} from "@antv/g6";
import i18n from "../../shared/i18n";
import { isMacos } from "../../shared/keys";
import type { GraphNodeVM } from "../../shared/contracts";
import {
    G6_GRAPH_NODE_MIN_HEIGHT,
    G6_GRAPH_NODE_WIDTH,
} from "./g6-graph-node-constants";
import {
    accentColorMap,
    debugIconUrl,
    disabledIconUrl,
    fallbackNodeIconMap,
    getGraphNodePalette,
    status000IconUrl,
    statusIconMap,
    type GraphNodePalette,
} from "./g6-graph-node-theme";
import {
    cutWordTo,
    getInputText,
    getOutputText,
    toBreakWord,
} from "./g6-graph-node-measure";
import {
    type GraphNodeShapeName,
    type GraphNodeState,
    type GraphNodeStateStyleMap,
} from "./g6-graph-node-style";

export const G6_GRAPH_NODE_TYPE = "b3-tree-node";
export {
    G6_GRAPH_NODE_H_GAP,
    G6_GRAPH_NODE_MIN_HEIGHT,
    G6_GRAPH_NODE_V_GAP,
    G6_GRAPH_NODE_WIDTH,
} from "./g6-graph-node-constants";
export { getGraphThemeColor } from "./g6-graph-node-theme";
export { measureGraphNode } from "./g6-graph-node-measure";
export {
    getGraphNodeStateStyle,
    type GraphNodeState,
    type GraphNodeStateStyleMap,
} from "./g6-graph-node-style";

export interface GraphNodeDatum extends Record<string, unknown> {
    vm: GraphNodeVM;
    width: number;
    height: number;
}

type ShapeName = GraphNodeShapeName;

type Constructor<T> = new (...args: any[]) => T;

const CONTENT_X = 46;
const CONTENT_Y = 28;
const CONTENT_WIDTH = 220;
const ROW_HEIGHT = 20;
const LEFT_RAIL_WIDTH = 40;
const RADIUS = 4;

let didRegisterGraphNode = false;

class GraphNode extends Rect {
    private width = G6_GRAPH_NODE_WIDTH;
    private height = G6_GRAPH_NODE_MIN_HEIGHT;
    private radius = RADIUS;
    private node!: GraphNodeVM;
    private accent = accentColorMap.Other;
    private contentY = CONTENT_Y;
    private states: GraphNodeState[] = [];
    private palette: GraphNodePalette = getGraphNodePalette();

    protected override getKeyStyle(attributes: Required<RectStyleProps>) {
        const style = super.getKeyStyle(attributes);
        if (style) {
            style.x = 0;
            style.y = 0;
        }
        return style;
    }

    protected override getHaloStyle(attributes: Required<RectStyleProps>) {
        const style = super.getHaloStyle(attributes);
        if (style) {
            style.x = 0;
            style.y = 0;
        }
        return style;
    }

    private drawSelectionHalo(container: Group) {
        this.upsert(
            "selection-halo",
            GRect,
            {
                x: -6,
                y: -6,
                width: this.width + 12,
                height: this.height + 12,
                lineWidth: 6,
                radius: this.radius + 6,
                stroke: this.accent,
                strokeOpacity: 0.28,
                fill: this.accent,
                fillOpacity: 0,
                visibility: "hidden",
            },
            container
        );
    }

    private drawFocusHalo(container: Group) {
        this.upsert(
            "focus-halo",
            GRect,
            {
                x: -8,
                y: -8,
                width: this.width + 16,
                height: this.height + 16,
                lineWidth: 4,
                radius: this.radius + 8,
                stroke: this.palette.focusColor,
                strokeOpacity: this.palette.focusOpacity,
                fill: this.palette.focusColor,
                fillOpacity: 0,
                visibility: "hidden",
            },
            container
        );
    }

    private drawBackground(attributes: Required<RectStyleProps>, container: Group) {
        const style = {
            ...attributes,
            size: [this.width, this.height] as [number, number],
            lineWidth: 2,
            radius: this.radius,
        };
        this.applyStyle("key-shape", style);
        this.drawKeyShape(style as Required<RectStyleProps>, container);
    }

    private drawNameBackground(container: Group) {
        this.upsert(
            "name-bg",
            GRect,
            {
                width: LEFT_RAIL_WIDTH,
                height: this.height,
                fill: this.accent,
                radius: [this.radius, 0, 0, this.radius],
            },
            container
        );

        this.upsert(
            "name-line",
            GPath,
            {
                d: [
                    ["M", 46, 23],
                    ["L", this.width - 40, 23],
                ],
                stroke: this.palette.divider,
                lineWidth: 1,
            },
            container
        );
    }

    private drawIdText(container: Group) {
        this.upsert(
            "id-text",
            GText,
            {
                fill: this.palette.idText,
                fontSize: 20,
                lineHeight: 20,
                lineWidth: 2,
                stroke: this.palette.idStroke,
                text: this.node.renderedIdLabel,
                textAlign: "right",
                textBaseline: "top",
                x: -3,
                y: this.height / 2 - 8,
            },
            container
        );
    }

    private drawTypeIcon(container: Group) {
        this.upsert(
            "icon",
            GImage,
            {
                x: 5,
                y: this.height / 2 - 16,
                height: 30,
                opacity: 1,
                width: 30,
                src: this.node.icon?.trim() || fallbackNodeIconMap[this.node.nodeStyleKind],
            },
            container
        );
    }

    private drawStatusIcon(container: Group) {
        this.upsert(
            "status",
            GImage,
            {
                x: this.width - 18,
                y: 3,
                height: 20,
                opacity: 1,
                width: 20,
                src: statusIconMap[this.node.statusBits] ?? status000IconUrl,
            },
            container
        );
    }

    private drawDebugIcon(container: Group) {
        this.upsert(
            "debug",
            GImage,
            {
                x: this.width - 30,
                y: 4,
                height: 16,
                opacity: 1,
                width: 16,
                src: debugIconUrl,
                visibility: this.node.debug ? "visible" : "hidden",
            },
            container
        );
    }

    private drawDisabledIcon(container: Group) {
        this.upsert(
            "disabled",
            GImage,
            {
                x: this.width - 30 - (this.node.debug ? 18 : 0),
                y: 4,
                height: 16,
                opacity: 1,
                width: 16,
                src: disabledIconUrl,
                visibility: this.node.disabled ? "visible" : "hidden",
            },
            container
        );
    }

    private drawOverrideBar(container: Group) {
        this.upsert(
            "override-bar",
            GRect,
            {
                x: this.width - 17,
                y: 1,
                width: 16,
                height: this.height - 2,
                fill: this.palette.overrideBar,
                lineWidth: 2,
                opacity: 1,
                radius: [0, this.radius - 1, this.radius - 1, 0],
                visibility: this.node.hasOverride ? "visible" : "hidden",
            },
            container
        );
    }

    private drawNameText(container: Group) {
        this.upsert(
            "name-text",
            GText,
            {
                fill: this.palette.nodeText,
                fontSize: 14,
                fontWeight: "bolder",
                text: this.node.title,
                textBaseline: "top",
                x: CONTENT_X,
                y: isMacos ? 3 : 2,
            },
            container
        );
    }

    private drawDescText(container: Group) {
        const text = this.node.subtitle
            ? cutWordTo(`${i18n.t("regnode.mark")}${this.node.subtitle}`, CONTENT_WIDTH - 15)
            : "";

        this.upsert(
            "desc-text",
            GText,
            {
                fill: this.palette.nodeText,
                fontSize: 12,
                fontWeight: "bolder",
                lineHeight: ROW_HEIGHT,
                text: text,
                textBaseline: "top",
                x: CONTENT_X,
                y: this.contentY,
                visibility: text ? "visible" : "hidden",
            },
            container
        );
    }

    private drawArgsText(container: Group) {
        const { str, line } = this.node.argsText
            ? toBreakWord(`${i18n.t("regnode.args")}${this.node.argsText}`, 200)
            : { str: "", line: 0 };

        this.upsert(
            "args-bg",
            GRect,
            {
                x: CONTENT_X - 2,
                y: this.contentY + 21,
                width: CONTENT_WIDTH - 6,
                height: 18,
                fill: this.palette.highlightBg,
                radius: this.radius,
                visibility: "hidden",
            },
            container
        );

        this.upsert(
            "args-text",
            GText,
            {
                fill: this.palette.nodeText,
                fontSize: 12,
                fontWeight: "normal",
                lineHeight: ROW_HEIGHT,
                text: str,
                textBaseline: "top",
                x: CONTENT_X,
                y: this.contentY + ROW_HEIGHT,
                visibility: str ? "visible" : "hidden",
            },
            container
        );

        this.contentY += ROW_HEIGHT * line;
    }

    private drawInputText(container: Group) {
        const { str, line } = getInputText(this.node);

        this.upsert(
            "input-bg",
            GRect,
            {
                fill: this.palette.highlightBg,
                height: 18,
                radius: this.radius,
                visibility: "hidden",
                width: CONTENT_WIDTH - 6,
                x: CONTENT_X - 2,
                y: this.contentY + 21,
            },
            container
        );

        this.upsert(
            "input-text",
            GText,
            {
                fill: this.palette.nodeText,
                fontSize: 12,
                fontWeight: "normal",
                lineHeight: ROW_HEIGHT,
                text: str,
                textBaseline: "top",
                x: CONTENT_X,
                y: this.contentY + ROW_HEIGHT,
                visibility: str ? "visible" : "hidden",
            },
            container
        );

        this.contentY += ROW_HEIGHT * line;
    }

    private drawOutputText(container: Group) {
        const { str, line } = getOutputText(this.node);

        this.upsert(
            "output-bg",
            GRect,
            {
                fill: this.palette.highlightBg,
                height: 18,
                radius: this.radius,
                visibility: "hidden",
                width: CONTENT_WIDTH - 6,
                x: CONTENT_X - 2,
                y: this.contentY + 21,
            },
            container
        );

        this.upsert(
            "output-text",
            GText,
            {
                fill: this.palette.nodeText,
                fontSize: 12,
                fontWeight: "normal",
                lineHeight: ROW_HEIGHT,
                text: str,
                textBaseline: "top",
                x: CONTENT_X,
                y: this.contentY + ROW_HEIGHT,
                visibility: str ? "visible" : "hidden",
            },
            container
        );

        this.contentY += ROW_HEIGHT * line;
    }

    private drawSubtreeText(container: Group) {
        const isSubtree = Boolean(this.node.subtreePath) && this.id !== "1";
        const text = isSubtree
            ? cutWordTo(`${i18n.t("regnode.subtree")}${this.node.subtreePath}`, CONTENT_WIDTH - 15)
            : "";

        this.upsert(
            "subtree",
            GRect,
            {
                x: -10,
                y: -10,
                width: this.width + 20,
                height: this.height + 20,
                stroke: this.palette.subtreeOutline,
                lineWidth: 3,
                lineDash: [10, 5],
                radius: this.radius,
                visibility: isSubtree ? "visible" : "hidden",
            },
            container
        );

        this.upsert(
            "path-text",
            GText,
            {
                fill: this.palette.nodeText,
                fontSize: 12,
                lineHeight: ROW_HEIGHT,
                text,
                textBaseline: "top",
                x: CONTENT_X,
                y: this.contentY + ROW_HEIGHT,
                visibility: text ? "visible" : "hidden",
            },
            container
        );

        this.contentY += text ? ROW_HEIGHT : 0;
    }

    private drawCollapseBadge(attributes: Required<RectStyleProps>, container: Group) {
        this.upsert(
            "collapse",
            Badge,
            {
                backgroundFill: this.palette.collapseBg,
                backgroundHeight: 14,
                backgroundLineWidth: 1,
                backgroundRadius: 7,
                backgroundStroke: this.palette.collapseBorder,
                backgroundWidth: 14,
                cursor: "pointer",
                fill: this.palette.collapseText,
                fontSize: 16,
                opacity: 1,
                text: attributes.collapsed ? "+" : "-",
                textAlign: "center",
                textBaseline: "middle",
                visibility: this.node.childKeys.length > 0 ? "visible" : "hidden",
                x: this.width,
                y: this.height / 2,
            },
            container
        );
    }

    private drawDragShapes(container: Group) {
        this.upsert(
            "drag-src",
            GRect,
            {
                width: this.width,
                height: this.height,
                lineWidth: 0,
                fillOpacity: 0.8,
                fill: this.palette.dragSource,
                radius: this.radius,
                visibility: "hidden",
            },
            container
        );

        this.upsert(
            "drag-up",
            GRect,
            {
                width: this.width,
                height: this.height / 2,
                lineWidth: 2,
                stroke: this.palette.dropChild,
                strokeOpacity: 0.8,
                fill: this.palette.dropChild,
                fillOpacity: 0.8,
                radius: [this.radius, this.radius, 0, 0],
                visibility: "hidden",
            },
            container
        );

        this.upsert(
            "drag-down",
            GRect,
            {
                y: this.height / 2,
                width: this.width,
                height: this.height / 2,
                lineWidth: 2,
                stroke: this.palette.dropChild,
                strokeOpacity: 0.8,
                fill: this.palette.dropChild,
                fillOpacity: 0.8,
                radius: [0, 0, this.radius, this.radius],
                visibility: "hidden",
            },
            container
        );

        this.upsert(
            "drag-right",
            GRect,
            {
                x: this.width / 2,
                width: this.width / 2,
                height: this.height,
                lineWidth: 2,
                stroke: this.palette.dropChild,
                strokeOpacity: 0.8,
                fill: this.palette.dropChild,
                fillOpacity: 0.8,
                radius: [0, this.radius, this.radius, 0],
                visibility: "hidden",
            },
            container
        );
    }

    render(attributes?: Required<RectStyleProps>, container?: Group): void {
        const node = this.context.model.getNodeLikeDatum(this.id) as G6NodeData;
        const data = node.data as unknown as GraphNodeDatum;

        this.node = data.vm;
        this.palette = getGraphNodePalette();
        this.width = data.width;
        this.height = data.height;
        this.accent =
            this.node.accentColor ??
            accentColorMap[this.node.nodeStyleKind] ??
            accentColorMap.Other;
        this.contentY = CONTENT_Y;
        this.states = this.context.graph.getElementState(this.id) as GraphNodeState[];
        this.resetStyle();

        if (!attributes || !container) {
            return;
        }

        attributes.fill = this.palette.nodeBg;
        attributes.stroke = this.accent;

        this.drawSelectionHalo(container);
        this.drawFocusHalo(container);
        this.drawBackground(attributes, container);
        this.drawNameBackground(container);
        this.drawOverrideBar(container);
        this.drawNameText(container);
        this.drawTypeIcon(container);
        this.drawStatusIcon(container);
        this.drawDebugIcon(container);
        this.drawDisabledIcon(container);
        this.drawDescText(container);
        this.drawArgsText(container);
        this.drawInputText(container);
        this.drawOutputText(container);
        this.drawSubtreeText(container);
        this.drawDragShapes(container);
        this.drawCollapseBadge(attributes, container);
        this.drawIdText(container);
    }

    protected upsert<T extends DisplayObject>(
        name: ShapeName,
        Ctor: Constructor<T>,
        style: T["attributes"] | false,
        container: DisplayObject,
        hooks?: UpsertHooks
    ): T | undefined {
        this.applyStyle(name, style);
        return super.upsert(name, Ctor, style, container, hooks);
    }

    private applyStyle(name: ShapeName, style: DisplayObject["attributes"] | false) {
        if (!style) {
            return;
        }

        const shapeStyle =
            ((this.attributes as Record<string, unknown>)[name] as Record<string, unknown>) ?? {};

        for (const key in shapeStyle) {
            (style as Record<string, unknown>)[key] = shapeStyle[key];
        }
    }

    private resetStyle() {
        const style = this.context.graph.getOptions().node?.state as
            | GraphNodeStateStyleMap
            | undefined;
        if (!style) {
            return;
        }

        const keys: Set<string> = new Set();
        Object.keys(style).forEach((state) => {
            for (const key in style[state as GraphNodeState]) {
                keys.add(key);
            }
        });

        this.states.forEach((state) => {
            const stateStyle = style[state];
            if (!stateStyle) {
                return;
            }
            for (const key in stateStyle) {
                keys.delete(key);
            }
        });

        for (const key of keys) {
            (this.attributes as Record<string, unknown>)[key] = undefined;
        }
    }
}

export const registerGraphNode = () => {
    if (didRegisterGraphNode) {
        return;
    }

    register(ExtensionCategory.NODE, G6_GRAPH_NODE_TYPE, GraphNode);
    didRegisterGraphNode = true;
};
