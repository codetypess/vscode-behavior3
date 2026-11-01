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
    G6_GRAPH_CONDITION_TAB_HEIGHT,
    G6_GRAPH_NODE_CONTENT_X,
    G6_GRAPH_NODE_METADATA_BG_WIDTH,
    G6_GRAPH_NODE_MIN_HEIGHT,
    G6_GRAPH_NODE_ROW_HEIGHT,
    G6_GRAPH_NODE_TEXT_WRAP_WIDTH,
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
    getArgsText,
    getGraphNodeMetadataSectionLayout,
    getInputText,
    getOutputText,
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

const CONTENT_Y = 28;
const LEFT_RAIL_WIDTH = 40;
const RADIUS = 4;

// The condition card stacks flush on the node like a Scratch block: a trapezoid tab hangs
// from the card's bottom edge into the node's left rail.
const CONDITION_TAB_LEFT = 8;
const CONDITION_TAB_WIDTH = 24;
const CONDITION_TAB_DEPTH = 6;
const CONDITION_TAB_SLANT = 5;
const CONDITION_TAB_CORNER = 3;
const CONDITION_CARD_TINT = 0.22;

type PathCommand = [string, ...number[]];

const toPathString = (commands: PathCommand[]) =>
    commands.map((command) => command.join(" ")).join(" ");

type Point = [number, number];

/**
 * Line through `corners` from `from` to `to`, rounding each corner with a quadratic curve.
 * The rounding never takes more than half of a side, so short sides stay well formed.
 */
const roundedPolyline = (from: Point, corners: Point[], to: Point, radius: number) => {
    const points = [from, ...corners, to];
    const toward = (a: Point, b: Point): Point => {
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const t = length > 0 ? Math.min(radius / length, 0.5) : 0;
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    };
    const commands: PathCommand[] = [];
    for (let i = 1; i < points.length - 1; i += 1) {
        const corner = points[i];
        commands.push(["L", ...toward(corner, points[i - 1])]);
        commands.push(["Q", ...corner, ...toward(corner, points[i + 1])]);
    }
    commands.push(["L", ...to]);
    return commands;
};

const parseColor = (value: string): [number, number, number] | undefined => {
    const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
    if (hex) {
        const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
        return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
    }
    const rgb = value.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
    return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : undefined;
};

/** `fg` at `alpha` over `bg` as one opaque color, so the card can cover the rail beneath its tab. */
const mixColor = (fg: string, bg: string, alpha: number): string | undefined => {
    const front = parseColor(fg);
    const back = parseColor(bg);
    if (!front || !back) {
        return undefined;
    }
    const mixed = front.map((channel, i) => Math.round(channel * alpha + back[i] * (1 - alpha)));
    return `rgb(${mixed.join(", ")})`;
};

const getMetadataHighlightHeight = (line: number) =>
    Math.max(G6_GRAPH_NODE_ROW_HEIGHT, line * G6_GRAPH_NODE_ROW_HEIGHT - 2);

let didRegisterGraphNode = false;

class GraphNode extends Rect {
    private width = G6_GRAPH_NODE_WIDTH;
    private contentWidth = G6_GRAPH_NODE_WIDTH;
    private height = G6_GRAPH_NODE_MIN_HEIGHT;
    private bodyTop = 0;
    private bodyHeight = G6_GRAPH_NODE_MIN_HEIGHT;
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
            style.y = this.bodyTop;
        }
        return style;
    }

    protected override getHaloStyle(attributes: Required<RectStyleProps>) {
        const style = super.getHaloStyle(attributes);
        if (style) {
            style.x = 0;
            style.y = this.bodyTop;
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
            size: [this.width, this.bodyHeight] as [number, number],
            lineWidth: 2,
            radius: this.bodyTop > 0 ? [0, 0, this.radius, this.radius] : this.radius,
        };
        this.applyStyle("key-shape", style);
        this.drawKeyShape(style as Required<RectStyleProps>, container);
    }

    private drawNameBackground(container: Group) {
        this.upsert(
            "name-bg",
            GRect,
            {
                y: this.bodyTop,
                width: LEFT_RAIL_WIDTH,
                height: this.bodyHeight,
                fill: this.accent,
                radius:
                    this.bodyTop > 0
                        ? [0, 0, 0, this.radius]
                        : [this.radius, 0, 0, this.radius],
            },
            container
        );

        this.upsert(
            "name-line",
            GPath,
            {
                d: [
                    ["M", G6_GRAPH_NODE_CONTENT_X, this.bodyTop + 23],
                    ["L", this.contentWidth - 40, this.bodyTop + 23],
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
                y: this.bodyTop + this.bodyHeight / 2 - 8,
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
                y: this.bodyTop + this.bodyHeight / 2 - 16,
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
                x: this.contentWidth - 18,
                y: this.bodyTop + 3,
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
                x: this.contentWidth - 30,
                y: this.bodyTop + 4,
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
                x: this.contentWidth - 30 - (this.node.debug ? 18 : 0),
                y: this.bodyTop + 4,
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
                x: this.contentWidth - 17,
                y: this.bodyTop + 1,
                width: 16,
                height: this.bodyHeight - 2,
                fill: this.palette.overrideBar,
                lineWidth: 2,
                opacity: 1,
                radius: [
                    0,
                    this.bodyTop > 0 ? 0 : this.radius - 1,
                    this.radius - 1,
                    0,
                ],
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
                x: G6_GRAPH_NODE_CONTENT_X,
                y: this.bodyTop + (isMacos ? 3 : 2),
            },
            container
        );
    }

    private drawDescText(container: Group) {
        const text = this.node.subtitle
            ? cutWordTo(
                  `${i18n.t("regnode.mark")}${this.node.subtitle}`,
                  G6_GRAPH_NODE_TEXT_WRAP_WIDTH,
                  "12px"
              )
            : "";

        this.upsert(
            "desc-text",
            GText,
            {
                fill: this.palette.nodeText,
                fontSize: 12,
                fontWeight: "bolder",
                lineHeight: G6_GRAPH_NODE_ROW_HEIGHT,
                text: text,
                textBaseline: "top",
                x: G6_GRAPH_NODE_CONTENT_X,
                y: this.contentY,
                visibility: text ? "visible" : "hidden",
            },
            container
        );
    }

    private drawArgsText(container: Group) {
        const { str, line } = getArgsText(this.node);
        const layout = getGraphNodeMetadataSectionLayout(this.contentY, line);

        this.upsert(
            "args-bg",
            GRect,
            {
                x: G6_GRAPH_NODE_CONTENT_X - 2,
                y: layout.highlightTop,
                width: G6_GRAPH_NODE_METADATA_BG_WIDTH,
                height: getMetadataHighlightHeight(line),
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
                lineHeight: G6_GRAPH_NODE_ROW_HEIGHT,
                text: str,
                textBaseline: "top",
                x: G6_GRAPH_NODE_CONTENT_X,
                y: layout.textTop,
                visibility: str ? "visible" : "hidden",
            },
            container
        );

        this.contentY = layout.nextSectionTop;
    }

    private drawInputText(container: Group) {
        const { str, line } = getInputText(this.node);
        const layout = getGraphNodeMetadataSectionLayout(this.contentY, line);

        this.upsert(
            "input-bg",
            GRect,
            {
                fill: this.palette.highlightBg,
                height: getMetadataHighlightHeight(line),
                radius: this.radius,
                visibility: "hidden",
                width: G6_GRAPH_NODE_METADATA_BG_WIDTH,
                x: G6_GRAPH_NODE_CONTENT_X - 2,
                y: layout.highlightTop,
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
                lineHeight: G6_GRAPH_NODE_ROW_HEIGHT,
                text: str,
                textBaseline: "top",
                x: G6_GRAPH_NODE_CONTENT_X,
                y: layout.textTop,
                visibility: str ? "visible" : "hidden",
            },
            container
        );

        this.contentY = layout.nextSectionTop;
    }

    private drawOutputText(container: Group) {
        const { str, line } = getOutputText(this.node);
        const layout = getGraphNodeMetadataSectionLayout(this.contentY, line);

        this.upsert(
            "output-bg",
            GRect,
            {
                fill: this.palette.highlightBg,
                height: getMetadataHighlightHeight(line),
                radius: this.radius,
                visibility: "hidden",
                width: G6_GRAPH_NODE_METADATA_BG_WIDTH,
                x: G6_GRAPH_NODE_CONTENT_X - 2,
                y: layout.highlightTop,
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
                lineHeight: G6_GRAPH_NODE_ROW_HEIGHT,
                text: str,
                textBaseline: "top",
                x: G6_GRAPH_NODE_CONTENT_X,
                y: layout.textTop,
                visibility: str ? "visible" : "hidden",
            },
            container
        );

        this.contentY = layout.nextSectionTop;
    }

    private drawSubtreeText(container: Group) {
        const isSubtree = Boolean(this.node.subtreePath) && this.id !== "1";
        const text = isSubtree
            ? cutWordTo(
                  `${i18n.t("regnode.subtree")}${this.node.subtreePath}`,
                  G6_GRAPH_NODE_TEXT_WRAP_WIDTH,
                  "12px"
              )
            : "";
        const layout = getGraphNodeMetadataSectionLayout(this.contentY, text ? 1 : 0);

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
                lineHeight: G6_GRAPH_NODE_ROW_HEIGHT,
                text,
                textBaseline: "top",
                x: G6_GRAPH_NODE_CONTENT_X,
                y: layout.textTop,
                visibility: text ? "visible" : "hidden",
            },
            container
        );

        this.contentY = layout.nextSectionTop;
    }

    private drawConditionTab(container: Group) {
        // Left: "condition: <root name>", right: the abort mode.
        const label = this.node.attachedConditionName
            ? `${i18n.t("condition.adornment")}: ${this.node.attachedConditionName}`
            : "";
        const abortType = label ? (this.node.attachedConditionAbort ?? "") : "";
        const abortReserve = abortType ? 48 : 0;
        const adornment = this.upsert(
            "condition-adornment",
            GPath,
            label
                ? {
                      d: toPathString(this.getConditionCardPath()),
                      ...this.getConditionCardFill(),
                      stroke: this.accent,
                      lineWidth: 2,
                      lineJoin: "round",
                      cursor: "pointer",
                  }
                : false,
            container
        );
        if (adornment) {
            adornment.className = "condition-adornment";
        }
        const adornmentLabel = this.upsert(
            "condition-label",
            GText,
            label
                ? {
                      x: 8,
                      y: G6_GRAPH_CONDITION_TAB_HEIGHT / 2,
                      text: cutWordTo(label, this.width - 16 - abortReserve, "12px"),
                      fontSize: 12,
                      textAlign: "left",
                      textBaseline: "middle",
                      fill: "#ffffff",
                      cursor: "pointer",
                  }
                : false,
            container
        );
        if (adornmentLabel) {
            adornmentLabel.className = "condition-label";
        }
        const abortLabel = this.upsert(
            "condition-abort",
            GText,
            abortType
                ? {
                      x: this.width - 8,
                      y: G6_GRAPH_CONDITION_TAB_HEIGHT / 2,
                      text: abortType,
                      fontSize: 12,
                      textAlign: "right",
                      textBaseline: "middle",
                      fill: "#ffffff",
                      cursor: "pointer",
                  }
                : false,
            container
        );
        if (abortLabel) {
            abortLabel.className = "condition-label";
        }
    }

    private getConditionCardFill() {
        const fill = mixColor(this.accent, this.palette.graphBg, CONDITION_CARD_TINT);
        return fill
            ? { fill, fillOpacity: 1 }
            : { fill: this.accent, fillOpacity: CONDITION_CARD_TINT };
    }

    /** Card flush on the node body, with a trapezoid tab dropping into the left rail. */
    private getConditionCardPath(): PathCommand[] {
        const w = this.width;
        const h = G6_GRAPH_CONDITION_TAB_HEIGHT;
        const r = this.radius;
        const tabLeft = CONDITION_TAB_LEFT;
        const tabRight = CONDITION_TAB_LEFT + CONDITION_TAB_WIDTH;
        const tabBottom = h + CONDITION_TAB_DEPTH;
        return [
            ["M", r, 0],
            ["L", w - r, 0],
            ["A", r, r, 0, 0, 1, w, r],
            ["L", w, h],
            ...roundedPolyline(
                [w, h],
                [
                    [tabRight, h],
                    [tabRight - CONDITION_TAB_SLANT, tabBottom],
                    [tabLeft + CONDITION_TAB_SLANT, tabBottom],
                    [tabLeft, h],
                ],
                [0, h],
                CONDITION_TAB_CORNER
            ),
            ["L", 0, r],
            ["A", r, r, 0, 0, 1, r, 0],
            ["Z"],
        ];
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
                x: this.contentWidth,
                y: this.bodyTop + this.bodyHeight / 2,
            },
            container
        );
    }

    private drawDragShapes(container: Group) {
        const topRadius = this.bodyTop > 0 ? 0 : this.radius;
        this.upsert(
            "drag-src",
            GRect,
            {
                y: this.bodyTop,
                width: this.width,
                height: this.bodyHeight,
                lineWidth: 0,
                fillOpacity: 0.8,
                fill: this.palette.dragSource,
                radius: this.bodyTop > 0 ? [0, 0, this.radius, this.radius] : this.radius,
                visibility: "hidden",
            },
            container
        );

        this.upsert(
            "drag-up",
            GRect,
            {
                y: this.bodyTop,
                width: this.width,
                height: this.bodyHeight / 2,
                lineWidth: 2,
                stroke: this.palette.dropChild,
                strokeOpacity: 0.8,
                fill: this.palette.dropChild,
                fillOpacity: 0.8,
                radius: [topRadius, topRadius, 0, 0],
                visibility: "hidden",
            },
            container
        );

        this.upsert(
            "drag-down",
            GRect,
            {
                y: this.bodyTop + this.bodyHeight / 2,
                width: this.width,
                height: this.bodyHeight / 2,
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
                y: this.bodyTop,
                width: this.width / 2,
                height: this.bodyHeight,
                lineWidth: 2,
                stroke: this.palette.dropChild,
                strokeOpacity: 0.8,
                fill: this.palette.dropChild,
                fillOpacity: 0.8,
                radius: [0, topRadius, this.radius, 0],
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
        this.contentWidth = data.width;
        this.height = data.height;
        this.bodyTop = this.node.attachedConditionName ? G6_GRAPH_CONDITION_TAB_HEIGHT : 0;
        this.bodyHeight = Math.max(G6_GRAPH_NODE_MIN_HEIGHT, data.height - this.bodyTop);
        this.accent =
            this.node.accentColor ??
            accentColorMap[this.node.nodeStyleKind] ??
            accentColorMap.Other;
        this.contentY = this.bodyTop + CONTENT_Y;
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
        this.drawConditionTab(container);
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
