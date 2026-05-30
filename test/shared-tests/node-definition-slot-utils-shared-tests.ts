import assert from "node:assert/strict";
import {
    createNodeDefMap,
    deriveGroupDefs,
    findNodeDef,
    parseSlotDefinition,
} from "../../webview/shared/node-utils";
import { defineSharedTests } from "../shared-test-types";

export const nodeDefinitionSlotUtilsSharedTests = defineSharedTests([
    {
        name: "creates shared node definition maps and finds definitions by name",
        run() {
            const wait = {
                name: "Wait",
                type: "Action",
                desc: "",
            };
            const nodeDefMap = createNodeDefMap([
                wait,
                {
                    name: "Sequence",
                    type: "Composite",
                    desc: "",
                    children: -1,
                },
            ]);

            assert.equal(findNodeDef(nodeDefMap, "Wait"), wait);
            assert.equal(findNodeDef(nodeDefMap, "Missing"), null);
            assert.equal(findNodeDef(nodeDefMap, null), null);
        },
    },
    {
        name: "derives sorted unique group definitions from node definitions",
        run() {
            assert.deepEqual(
                deriveGroupDefs([
                    {
                        name: "Wait",
                        type: "Action",
                        desc: "",
                        group: ["combat", "core"],
                    },
                    {
                        name: "Log",
                        type: "Action",
                        desc: "",
                        group: ["core"],
                    },
                ]),
                ["combat", "core"]
            );
        },
    },
    {
        name: "parses slot definitions for label cleanup and optional markers",
        run() {
            assert.deepEqual(parseSlotDefinition("target?"), {
                raw: "target?",
                name: "target",
                label: "target",
                required: false,
                variadic: false,
                checker: undefined,
                visible: undefined,
            });
            assert.deepEqual(parseSlotDefinition("output"), {
                raw: "output",
                name: "output",
                label: "output",
                required: true,
                variadic: false,
                checker: undefined,
                visible: undefined,
            });
        },
    },
    {
        name: "treats variadic slots as valid only at the last slot index",
        run() {
            assert.equal(parseSlotDefinition("child...", ["child..."], 0).variadic, true);
            assert.equal(
                parseSlotDefinition("child...", ["child...", "sibling"], 0).variadic,
                false
            );
            assert.equal(parseSlotDefinition("child...").variadic, true);
        },
    },
    {
        name: "cleans optional variadic slot labels while preserving broad optional semantics",
        run() {
            assert.deepEqual(parseSlotDefinition("target?...", ["target?..."], 0), {
                raw: "target?...",
                name: "target",
                label: "target",
                required: false,
                variadic: true,
                checker: undefined,
                visible: undefined,
            });
        },
    },
]);
