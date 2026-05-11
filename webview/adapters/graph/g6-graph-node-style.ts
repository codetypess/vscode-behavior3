import type { NodeStyle } from "@antv/g6/lib/spec/element/node";
import { getGraphNodePalette } from "./g6-graph-node-theme";

export type GraphNodeState =
    | "dragdown"
    | "dragright"
    | "dragsrc"
    | "dragup"
    | "focused"
    | "highlightargs"
    | "highlightgray"
    | "highlightinput"
    | "highlightoutput"
    | "selected";

export type GraphNodeShapeName =
    | "args-bg"
    | "args-text"
    | "debug"
    | "desc-text"
    | "disabled"
    | "collapse"
    | "drag-down"
    | "drag-right"
    | "drag-src"
    | "drag-up"
    | "focus-halo"
    | "icon"
    | "id-text"
    | "input-bg"
    | "input-text"
    | "key-shape"
    | "name-bg"
    | "name-line"
    | "name-text"
    | "override-bar"
    | "output-bg"
    | "output-text"
    | "path-text"
    | "selection-halo"
    | "status"
    | "subtree";

export type GraphNodeStateStyleMap = {
    [s in GraphNodeState]?: { [n in GraphNodeShapeName]?: NodeStyle };
};

export const getGraphNodeStateStyle = (): GraphNodeStateStyleMap => {
    const palette = getGraphNodePalette();

    return {
        dragsrc: {
            "drag-src": { visibility: "visible" },
        },
        dragup: {
            "drag-up": { visibility: "visible" },
        },
        dragdown: {
            "drag-down": { visibility: "visible" },
        },
        dragright: {
            "drag-right": { visibility: "visible" },
        },
        focused: {
            "focus-halo": { visibility: "visible" },
        },
        highlightargs: {
            "args-bg": { visibility: "visible" },
            "args-text": { fill: palette.highlightText },
        },
        highlightinput: {
            "input-bg": { visibility: "visible" },
            "input-text": { fill: palette.highlightText },
        },
        highlightoutput: {
            "output-bg": { visibility: "visible" },
            "output-text": { fill: palette.highlightText },
        },
        highlightgray: {
            collapse: { opacity: 0.45 },
            "desc-text": { fill: palette.grayText },
            debug: { opacity: 0.45 },
            disabled: { opacity: 0.45 },
            icon: { opacity: 0.45 },
            "id-text": { fill: palette.grayText, stroke: palette.idStroke },
            "input-text": { fill: palette.grayText },
            "key-shape": { fill: palette.grayFill, stroke: palette.grayBorder },
            "name-bg": { fill: palette.grayRail },
            "name-line": { stroke: palette.divider },
            "name-text": { fill: palette.grayText },
            "override-bar": { opacity: 0.45 },
            "output-text": { fill: palette.grayText },
            "path-text": { fill: palette.grayText },
            status: { opacity: 0.45 },
            "args-text": { fill: palette.grayText },
        },
        selected: {
            "selection-halo": { visibility: "visible" },
        },
    };
};
