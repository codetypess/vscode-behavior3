import type { GraphNodeVM } from "../../shared/contracts";
import i18n from "../../shared/i18n";
import { stringifyCompactJson5 } from "../../shared/json";
import {
    G6_GRAPH_NODE_MIN_HEIGHT,
    G6_GRAPH_NODE_ROW_HEIGHT,
    G6_GRAPH_NODE_TEXT_WRAP_WIDTH,
    G6_GRAPH_NODE_WIDTH,
} from "./g6-graph-node-constants";

const METADATA_FONT_SIZE = "12px";
const DEFAULT_FONT_SIZE = "13px";
const DEFAULT_FONT_FAMILY = "sans-serif";

export const getGraphNodeMetadataSectionHeight = (lineCount: number) =>
    lineCount > 0 ? lineCount * G6_GRAPH_NODE_ROW_HEIGHT : 0;

export const getGraphNodeMetadataSectionLayout = (sectionTop: number, lineCount: number) => ({
    highlightTop: sectionTop + G6_GRAPH_NODE_ROW_HEIGHT + 1,
    nextSectionTop: sectionTop + getGraphNodeMetadataSectionHeight(lineCount),
    textTop: sectionTop + G6_GRAPH_NODE_ROW_HEIGHT,
});

let textMeasureContext: CanvasRenderingContext2D | null = null;
const textWidthCache = new Map<string, number>();
const textLineCache = new Map<string, string[]>();

const ensureMeasureStyle = (fontSize?: string) => {
    return {
        fontSize: fontSize ?? DEFAULT_FONT_SIZE,
        fontFamily: DEFAULT_FONT_FAMILY,
    };
};

const calcTextWidth = (text: string, fontSize?: string) => {
    const { fontSize: resolvedFontSize, fontFamily } = ensureMeasureStyle(fontSize);
    const key = `${text}-${resolvedFontSize}-${fontFamily}`;
    const cachedWidth = textWidthCache.get(key);
    if (cachedWidth !== undefined) {
        return cachedWidth;
    }

    textMeasureContext ||=
        typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
    if (!textMeasureContext) {
        const fallbackFontSize = Number.parseFloat(resolvedFontSize) || 13;
        return text.length * fallbackFontSize * 0.62;
    }

    textMeasureContext.font = `${resolvedFontSize} ${fontFamily}`;
    textMeasureContext.wordSpacing = "0px";
    textMeasureContext.letterSpacing = "0px";

    const width = textMeasureContext.measureText(text).width;
    textWidthCache.set(key, width);

    return width;
};

const isNaturalBreakAfter = (char: string) =>
    char === "," ||
    char === ";" ||
    char === " " ||
    char === "\t" ||
    char === "\n" ||
    char === "\r" ||
    char === ")" ||
    char === "]" ||
    char === "}" ||
    char === "，" ||
    char === "；" ||
    char === "、";

const findNaturalBreakIndex = (value: string, maxLength: number) => {
    if (maxLength >= value.length) {
        return value.length;
    }

    const minimumBreakIndex = Math.max(1, Math.floor(maxLength * 0.55));
    for (let index = maxLength; index >= minimumBreakIndex; index -= 1) {
        if (isNaturalBreakAfter(value[index - 1] ?? "")) {
            return index;
        }
    }

    return maxLength;
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
            const breakIndex = findNaturalBreakIndex(remaining, left);
            const line = remaining.slice(0, breakIndex).trimEnd();
            lines.push(line || remaining.slice(0, breakIndex));
            remaining = remaining.slice(breakIndex).trimStart();
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

export const getArgsText = (node: GraphNodeVM) =>
    node.argsText
        ? toBreakWord(
              `${i18n.t("regnode.args")}${node.argsText}`,
              G6_GRAPH_NODE_TEXT_WRAP_WIDTH,
              METADATA_FONT_SIZE
          )
        : { str: "", line: 0 };

export const getInputText = (node: GraphNodeVM) => {
    const labels = node.inputs.map((entry) => entry.label).filter(Boolean);
    if (labels.length === 0) {
        return { str: "", line: 0 };
    }
    return toBreakWord(
        `${i18n.t("regnode.input")}${stringifyCompactJson5(labels) ?? "[]"}`,
        G6_GRAPH_NODE_TEXT_WRAP_WIDTH,
        METADATA_FONT_SIZE
    );
};

export const getOutputText = (node: GraphNodeVM) => {
    const labels = node.outputs.map((entry) => entry.label).filter(Boolean);
    if (labels.length === 0) {
        return { str: "", line: 0 };
    }
    return toBreakWord(
        `${i18n.t("regnode.output")}${stringifyCompactJson5(labels) ?? "[]"}`,
        G6_GRAPH_NODE_TEXT_WRAP_WIDTH,
        METADATA_FONT_SIZE
    );
};

export const measureGraphNode = (node: GraphNodeVM) => {
    let height = 50 + 2;

    if (node.subtreePath) {
        height += getGraphNodeMetadataSectionHeight(1);
    }
    const argsText = getArgsText(node);
    if (argsText.line > 0) {
        height += getGraphNodeMetadataSectionHeight(argsText.line);
    }

    const inputText = getInputText(node);
    if (inputText.line > 0) {
        height += getGraphNodeMetadataSectionHeight(inputText.line);
    }

    const outputText = getOutputText(node);
    if (outputText.line > 0) {
        height += getGraphNodeMetadataSectionHeight(outputText.line);
    }

    return {
        width: G6_GRAPH_NODE_WIDTH,
        height: Math.max(G6_GRAPH_NODE_MIN_HEIGHT, height),
    };
};
