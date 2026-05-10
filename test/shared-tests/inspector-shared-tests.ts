import assert from "node:assert/strict";
import {
    formatArgInitialValue,
    parseArgSubmitValue,
    validateInspectorArgValue,
} from "../../webview/features/inspector/inspector-arg-values";
import {
    buildTreeCustomRecord,
    getTreeCustomValueKind,
} from "../../webview/features/inspector/tree-custom-metadata";
import { normalizeNodeDefCollection, parseNodeDefsContent } from "../../webview/shared/schema";
import { defineSharedTests } from "../shared-test-types";

export const inspectorSharedTests = defineSharedTests([
    {
        name: "normalizes legacy node definitions",
        run() {
            const defs = normalizeNodeDefCollection({
                nodes: [
                    {
                        name: "Check",
                        type: "Condition",
                        desc: "legacy",
                        args: [{ name: "value", type: "code?", desc: "expr" }],
                    },
                ],
            });

            assert.equal(defs.length, 1);
            assert.equal(defs[0]?.args?.[0]?.type, "expr?");
        },
    },
    {
        name: "normalizes boolean node arg alias",
        run() {
            const defs = normalizeNodeDefCollection([
                {
                    name: "Flag",
                    type: "Action",
                    desc: "",
                    args: [{ name: "enabled", type: "boolean?", desc: "" }],
                },
            ]);

            assert.equal(defs[0]?.args?.[0]?.type, "bool?");
        },
    },
    {
        name: "preserves node arg checker names in node definitions",
        run() {
            const defs = parseNodeDefsContent(
                JSON.stringify([
                    {
                        name: "Wait",
                        type: "Action",
                        desc: "",
                        args: [
                            {
                                name: "time",
                                type: "float",
                                desc: "",
                                checker: "positive",
                            },
                        ],
                    },
                ])
            );

            assert.equal(defs[0]?.args?.[0]?.checker, "positive");
            assert.throws(
                () =>
                    parseNodeDefsContent(
                        JSON.stringify([
                            {
                                name: "Wait",
                                type: "Action",
                                desc: "",
                                args: [
                                    {
                                        name: "time",
                                        type: "float",
                                        desc: "",
                                        checker: "",
                                    },
                                ],
                            },
                        ])
                    ),
                /checker.*non-empty string/
            );
        },
    },
    {
        name: "keeps required inspector arg initial values unset",
        run() {
            assert.equal(
                formatArgInitialValue({ name: "text", type: "string", desc: "" }, undefined),
                undefined
            );
            assert.equal(
                formatArgInitialValue({ name: "expr", type: "expr", desc: "" }, undefined),
                undefined
            );
            assert.equal(
                formatArgInitialValue({ name: "count", type: "int", desc: "" }, undefined),
                undefined
            );
            assert.equal(
                formatArgInitialValue({ name: "enabled", type: "bool", desc: "" }, undefined),
                undefined
            );
            assert.equal(
                formatArgInitialValue(
                    {
                        name: "status",
                        type: "string",
                        desc: "",
                        options: [],
                    },
                    undefined
                ),
                undefined
            );
        },
    },
    {
        name: "formats optional inspector arg initial values",
        run() {
            assert.equal(
                formatArgInitialValue({ name: "text", type: "string?", desc: "" }, undefined),
                ""
            );
            assert.equal(
                formatArgInitialValue({ name: "enabled", type: "bool?", desc: "" }, undefined),
                false
            );
        },
    },
    {
        name: "does not coerce unset required inspector args into serialized values",
        run() {
            assert.equal(
                parseArgSubmitValue({ name: "text", type: "string", desc: "" }, undefined),
                undefined
            );
            assert.equal(
                parseArgSubmitValue({ name: "expr", type: "expr", desc: "" }, undefined),
                undefined
            );
            assert.equal(
                parseArgSubmitValue({ name: "count", type: "int", desc: "" }, undefined),
                undefined
            );
            assert.equal(
                parseArgSubmitValue({ name: "enabled", type: "bool", desc: "" }, undefined),
                undefined
            );
            assert.equal(
                parseArgSubmitValue(
                    {
                        name: "status",
                        type: "string",
                        desc: "",
                        options: [],
                    },
                    undefined
                ),
                undefined
            );
        },
    },
    {
        name: "preserves explicit inspector arg values during serialization",
        run() {
            assert.equal(
                parseArgSubmitValue({ name: "enabled", type: "bool", desc: "" }, false),
                false
            );
            assert.equal(
                parseArgSubmitValue({ name: "enabled", type: "bool?", desc: "" }, false),
                false
            );
            assert.equal(parseArgSubmitValue({ name: "count", type: "int", desc: "" }, 0), 0);
            assert.equal(
                parseArgSubmitValue(
                    {
                        name: "status",
                        type: "string",
                        desc: "",
                        options: [],
                    },
                    "RUNNING"
                ),
                "RUNNING"
            );
        },
    },
    {
        name: "accepts valid integer array inspector args",
        run() {
            assert.equal(
                validateInspectorArgValue({
                    arg: { name: "option", type: "int[]?", desc: "选项" },
                    rawValue: "[1,2]",
                    usingVars: null,
                    checkExpr: true,
                }),
                null
            );
        },
    },
    {
        name: "accepts valid float array inspector args",
        run() {
            assert.equal(
                validateInspectorArgValue({
                    arg: { name: "weights", type: "float[]?", desc: "权重" },
                    rawValue: "[1,2.5]",
                    usingVars: null,
                    checkExpr: true,
                }),
                null
            );
        },
    },
    {
        name: "rejects invalid integer array inspector args",
        run() {
            const error = validateInspectorArgValue({
                arg: { name: "option", type: "int[]?", desc: "选项" },
                rawValue: "[1,2.5]",
                usingVars: null,
                checkExpr: true,
            });
            assert.equal(typeof error, "string");
            assert.match(error ?? "", /选项/);
            assert.match(error ?? "", /integer|整数/);
        },
    },
    {
        name: "parses tree custom inspector rows into persisted custom values",
        run() {
            assert.deepEqual(
                buildTreeCustomRecord([
                    { key: "label", value: "hello" },
                    { key: "literal", value: "null" },
                    { key: "count", value: "42" },
                    { key: "enabled", value: "true" },
                    { key: "quoted", value: '"true"' },
                ]),
                {
                    label: "hello",
                    literal: "null",
                    count: 42,
                    enabled: true,
                    quoted: "true",
                }
            );
        },
    },
    {
        name: "rejects invalid tree custom inspector literals",
        run() {
            assert.throws(
                () => buildTreeCustomRecord([{ key: "object", value: "{ nested: true }" }]),
                /invalid tree custom value/
            );
            assert.throws(
                () => buildTreeCustomRecord([{ key: "array", value: "[1, 2, 3]" }]),
                /invalid tree custom value/
            );
        },
    },
    {
        name: "infers tree custom value kinds from inspector input",
        run() {
            assert.equal(getTreeCustomValueKind("hello"), "string");
            assert.equal(getTreeCustomValueKind("42"), "number");
            assert.equal(getTreeCustomValueKind("false"), "boolean");
            assert.equal(getTreeCustomValueKind('"quoted"'), "string");
            assert.equal(getTreeCustomValueKind("{ nested: true }"), "invalid");
        },
    },
]);
