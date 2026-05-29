import assert from "node:assert/strict";
import {
    createHostRequestTimeoutResponse,
    resolveHostRequestResult,
} from "../../webview/shared/host-request-spec";
import { parseWorkdirRelativeJsonPath } from "../../webview/shared/protocol";
import { defineSharedTests } from "../shared-test-types";

export const hostRequestSpecSharedTests = defineSharedTests([
    {
        name: "creates host request timeout fallbacks through the shared registry",
        run() {
            assert.deepEqual(createHostRequestTimeoutResponse("readFile"), { content: null });
            assert.deepEqual(createHostRequestTimeoutResponse("saveDocument"), {
                success: false,
                error: "Host request 'saveDocument' timed out",
            });
            assert.deepEqual(createHostRequestTimeoutResponse("validateNodeChecks"), {
                diagnostics: [],
                error: "Host request 'validateNodeChecks' timed out",
            });
            assert.deepEqual(createHostRequestTimeoutResponse("resolveNodeArgVisibility"), {
                visibility: {},
                error: "Host request 'resolveNodeArgVisibility' timed out",
            });
        },
    },
    {
        name: "resolves host request results through the shared registry",
        run() {
            const resolved = resolveHostRequestResult(
                {
                    type: "saveSubtreeAsResult",
                    requestId: "req-1",
                    savedPath: "sub/tree.json",
                },
                {
                    parseWorkdirRelativeJsonPath,
                }
            );

            assert.deepEqual(resolved, {
                requestId: "req-1",
                type: "saveSubtreeAs",
                value: {
                    savedPath: "sub/tree.json",
                    error: undefined,
                },
            });

            const resolvedVisibility = resolveHostRequestResult(
                {
                    type: "resolveNodeArgVisibilityResult",
                    requestId: "req-visible",
                    visibility: {
                        time: false,
                    },
                },
                {
                    parseWorkdirRelativeJsonPath,
                }
            );

            assert.deepEqual(resolvedVisibility, {
                requestId: "req-visible",
                type: "resolveNodeArgVisibility",
                value: {
                    visibility: {
                        time: false,
                    },
                    error: undefined,
                },
            });
        },
    },
    {
        name: "reports invalid saved subtree paths through the shared registry",
        run() {
            const resolved = resolveHostRequestResult(
                {
                    type: "saveSubtreeAsResult",
                    requestId: "req-2",
                    savedPath: "../escape.json",
                },
                {
                    parseWorkdirRelativeJsonPath,
                }
            );

            assert.deepEqual(resolved, {
                requestId: "req-2",
                type: "saveSubtreeAs",
                value: {
                    savedPath: null,
                    error: "Host returned an invalid saved subtree path",
                },
            });
        },
    },
]);
