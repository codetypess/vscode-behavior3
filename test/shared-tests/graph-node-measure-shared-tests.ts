import assert from "node:assert/strict";
import { G6_GRAPH_NODE_ROW_HEIGHT } from "../../webview/adapters/graph/g6-graph-node-constants";
import {
    getGraphNodeMetadataSectionLayout,
    toBreakWord,
} from "../../webview/adapters/graph/g6-graph-node-measure";
import { defineSharedTests } from "../shared-test-types";

const withMockTextMeasure = (run: (fonts: string[]) => void) => {
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    const previousGetComputedStyle = Object.getOwnPropertyDescriptor(
        globalThis,
        "getComputedStyle"
    );
    const fonts: string[] = [];
    const measureContext = {
        font: "",
        wordSpacing: "",
        letterSpacing: "",
        measureText(text: string) {
            fonts.push(this.font);
            return { width: text.length };
        },
    };

    Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {
            body: {},
            documentElement: {},
            querySelector() {
                return null;
            },
            createElement(tag: string) {
                assert.equal(tag, "canvas");
                return {
                    getContext(type: string) {
                        assert.equal(type, "2d");
                        return measureContext;
                    },
                };
            },
        },
    });
    Object.defineProperty(globalThis, "getComputedStyle", {
        configurable: true,
        value: () => {
            throw new Error("graph text measurement should not read host CSS fonts");
        },
    });

    try {
        run(fonts);
    } finally {
        if (previousDocument) {
            Object.defineProperty(globalThis, "document", previousDocument);
        } else {
            Reflect.deleteProperty(globalThis, "document");
        }

        if (previousGetComputedStyle) {
            Object.defineProperty(globalThis, "getComputedStyle", previousGetComputedStyle);
        } else {
            Reflect.deleteProperty(globalThis, "getComputedStyle");
        }
    }
};

export const graphNodeMeasureSharedTests = defineSharedTests([
    {
        name: "wraps graph node metadata on natural delimiters",
        run() {
            withMockTextMeasure(() => {
                const wrapped = toBreakWord(
                    "args: {check:'1',name:'1',open:true,status:'RUNNING',time:1}",
                    42
                );

                assert.deepEqual(wrapped.str.split("\n"), [
                    "args: {check:'1',name:'1',open:true,",
                    "status:'RUNNING',time:1}",
                ]);
                assert.equal(wrapped.line, 2);
            });
        },
    },
    {
        name: "hard-breaks graph node metadata when no delimiter fits",
        run() {
            withMockTextMeasure(() => {
                const wrapped = toBreakWord("abcdefghijklmnop", 5);

                assert.deepEqual(wrapped.str.split("\n"), ["abcde", "fghij", "klmno", "p"]);
                assert.equal(wrapped.line, 4);
            });
        },
    },
    {
        name: "measures graph node metadata with AntV text defaults",
        run() {
            withMockTextMeasure((fonts) => {
                toBreakWord("unique-font-check", 8);

                assert.equal(
                    fonts.every((font) => font.includes("sans-serif")),
                    true
                );
            });
        },
    },
    {
        name: "uses one vertical rhythm for wrapped graph node metadata",
        run() {
            const descTop = 28;
            const argsLayout = getGraphNodeMetadataSectionLayout(descTop, 2);
            const inputLayout = getGraphNodeMetadataSectionLayout(argsLayout.nextSectionTop, 1);

            assert.equal(argsLayout.textTop - descTop, G6_GRAPH_NODE_ROW_HEIGHT);
            assert.equal(argsLayout.nextSectionTop - argsLayout.textTop, G6_GRAPH_NODE_ROW_HEIGHT);
            assert.equal(
                inputLayout.textTop - argsLayout.nextSectionTop,
                G6_GRAPH_NODE_ROW_HEIGHT
            );
        },
    },
]);
