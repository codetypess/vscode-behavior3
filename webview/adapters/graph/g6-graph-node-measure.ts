import type { GraphNodeVM } from "../../shared/contracts";
import i18n from "../../shared/i18n";
import { stringifyCompactJson5 } from "../../shared/json";
import { isMacos } from "../../shared/keys";
import { G6_GRAPH_NODE_MIN_HEIGHT, G6_GRAPH_NODE_WIDTH } from "./g6-graph-node-constants";

const ROW_HEIGHT = 20;

let textMeasureContext: CanvasRenderingContext2D | null = null;
let defaultFontSize = "";
let defaultFontFamily = "";
const textWidthCache = new Map<string, number>();
const textLineCache = new Map<string, string[]>();

const getMeasureHost = (): HTMLElement | null =>
    document.querySelector<HTMLElement>(".b3-shell") ?? document.body;

const ensureMeasureStyle = (fontSize?: string) => {
    const host = getMeasureHost();
    const css = host ? getComputedStyle(host) : null;

    if (!defaultFontSize) {
        defaultFontSize = css?.fontSize || "13px";
    }
    if (!defaultFontFamily) {
        defaultFontFamily = css?.fontFamily || "sans-serif";
    }

    return {
        fontSize: fontSize ?? defaultFontSize,
        fontFamily: defaultFontFamily,
    };
};

const calcTextWidth = (text: string, fontSize?: string) => {
    const { fontSize: resolvedFontSize, fontFamily } = ensureMeasureStyle(fontSize);
    const key = `${text}-${resolvedFontSize}-${fontFamily}`;
    const cachedWidth = textWidthCache.get(key);
    if (cachedWidth !== undefined) {
        return cachedWidth;
    }

    textMeasureContext ||= document.createElement("canvas").getContext("2d");
    if (!textMeasureContext) {
        return text.length * 13;
    }

    textMeasureContext.font = `${resolvedFontSize} ${fontFamily}`;
    textMeasureContext.wordSpacing = "0px";
    textMeasureContext.letterSpacing = "-0.5px";

    let width = textMeasureContext.measureText(text).width;
    width *= isMacos ? 0.88 : 0.98;
    textWidthCache.set(key, width);

    return width;
};

const calcTextLines = (value: string, maxWidth: number, fontSize?: string): string[] => {
    const key = `${value}-${maxWidth}-${fontSize ?? ""}`;
    const cachedLines = textLineCache.get(key);
    if (cachedLines) {
        return cachedLines;
    }

    const lines: string[] = [];
    let remaining = value;

    while (remaining.length > 0) {
        let left = 0;
        let right = remaining.length;

        while (left < right) {
            const middle = Math.floor((left + right + 1) / 2);
            const chunk = remaining.slice(0, middle);
            if (calcTextWidth(chunk, fontSize) <= maxWidth) {
                left = middle;
            } else {
                right = middle - 1;
            }
        }

        if (left > 0) {
            lines.push(remaining.slice(0, left));
            remaining = remaining.slice(left);
            continue;
        }

        lines.push(remaining.slice(0, 1));
        remaining = remaining.slice(1);
    }

    textLineCache.set(key, lines);
    return lines;
};

export const cutWordTo = (value: string, maxWidth: number, fontSize?: string) => {
    const lines = calcTextLines(value, maxWidth, fontSize);
    if (lines.length > 1) {
        return `${lines[0].slice(0, -1)}...`;
    }
    return lines[0] ?? "";
};

export const toBreakWord = (value: string, maxWidth: number, fontSize?: string) => {
    const lines = calcTextLines(value, maxWidth, fontSize);
    return {
        str: lines.join("\n"),
        line: lines.length,
    };
};

export const getInputText = (node: GraphNodeVM) => {
    const labels = node.inputs.map((entry) => entry.label).filter(Boolean);
    if (labels.length === 0) {
        return { str: "", line: 0 };
    }
    return toBreakWord(`${i18n.t("regnode.input")}${stringifyCompactJson5(labels) ?? "[]"}`, 200);
};

export const getOutputText = (node: GraphNodeVM) => {
    const labels = node.outputs.map((entry) => entry.label).filter(Boolean);
    if (labels.length === 0) {
        return { str: "", line: 0 };
    }
    return toBreakWord(`${i18n.t("regnode.output")}${stringifyCompactJson5(labels) ?? "[]"}`, 200);
};

export const measureGraphNode = (node: GraphNodeVM) => {
    let height = 50 + 2;

    if (node.subtreePath) {
        height += ROW_HEIGHT;
    }
    if (node.argsText) {
        height += toBreakWord(`${i18n.t("regnode.args")}${node.argsText}`, 200).line * ROW_HEIGHT;
    }

    const inputText = getInputText(node);
    if (inputText.line > 0) {
        height += inputText.line * ROW_HEIGHT;
    }

    const outputText = getOutputText(node);
    if (outputText.line > 0) {
        height += outputText.line * ROW_HEIGHT;
    }

    return {
        width: G6_GRAPH_NODE_WIDTH,
        height: Math.max(G6_GRAPH_NODE_MIN_HEIGHT, height),
    };
};
