import assert from "node:assert/strict";
import b3path from "../../webview/shared/b3path";
import {
    normalizeHostDocumentSnapshot,
    parseWorkdirRelativeJsonPath,
} from "../../webview/shared/protocol";
import type { NodeInstanceRef } from "../../webview/shared/contracts";
import { defineSharedTests } from "../shared-test-types";

export const hostProtocolSharedTests = defineSharedTests([
    {
        name: "parses only strict workdir-relative json paths",
        run() {
            assert.equal(parseWorkdirRelativeJsonPath("vars\\test.json"), "vars/test.json");
            assert.equal(parseWorkdirRelativeJsonPath("./sub/tree.json"), "sub/tree.json");
            assert.equal(parseWorkdirRelativeJsonPath("../escape.json"), null);
            assert.equal(parseWorkdirRelativeJsonPath("/absolute.json"), null);
            assert.equal(parseWorkdirRelativeJsonPath("C:\\absolute.json"), null);
            assert.equal(parseWorkdirRelativeJsonPath("tree.txt"), null);
            assert.equal(parseWorkdirRelativeJsonPath("http://example.com/tree.json"), null);
        },
    },
    {
        name: "normalizes host document snapshots without variable focus fields",
        run() {
            const normalized = normalizeHostDocumentSnapshot({
                content: "{}",
                documentSession: {
                    dirty: false,
                    historyIndex: 0,
                    historyLength: 1,
                    lastSavedSnapshot: "{}",
                    alertReload: false,
                    pendingExternalContent: null,
                },
                selection: {
                    kind: "tree",
                    activeVariableNames: ["hp"],
                },
                syncKind: "update",
                activeVariableNames: ["hp"],
            } as any);

            assert.deepEqual(normalized.selection, { kind: "tree" });
            assert.equal(
                Object.prototype.hasOwnProperty.call(normalized, "activeVariableNames"),
                false
            );
            assert.equal(
                Object.prototype.hasOwnProperty.call(normalized.selection, "activeVariableNames"),
                false
            );
        },
    },
    {
        name: "normalizes shared b3 paths without Node path augmentation",
        run() {
            assert.equal(b3path.posixPath("vars\\sub\\../tree.json"), "vars/tree.json");
            assert.equal(b3path.basenameWithoutExt("/work/trees/main.json"), "main");
            assert.equal(b3path.dirname("/work/trees/main.json"), "/work/trees");
            assert.equal(b3path.resolve("/work/trees", "./main.json"), "/work/trees/main.json");
            assert.equal(
                b3path.relative("/work/trees", "/work/scripts/build.ts"),
                "../scripts/build.ts"
            );
            assert.equal(b3path.isAbsolute("C:\\work\\main.json"), true);
        },
    },
    {
        name: "serializes focus-variable request/relay messages and resolves pending host requests on disconnect",
        async run() {
            const testGlobal = globalThis as unknown as {
                window?: unknown;
                acquireVsCodeApi?: unknown;
            };
            const previousWindow = testGlobal.window;
            const previousAcquire = testGlobal.acquireVsCodeApi;
            const posts: unknown[] = [];
            const listeners = new Map<string, Set<EventListener>>();

            testGlobal.window = {
                setTimeout,
                clearTimeout,
                addEventListener(type: string, listener: EventListener) {
                    const entries = listeners.get(type) ?? new Set<EventListener>();
                    entries.add(listener);
                    listeners.set(type, entries);
                },
                removeEventListener(type: string, listener: EventListener) {
                    listeners.get(type)?.delete(listener);
                },
            };
            testGlobal.acquireVsCodeApi = () => ({
                postMessage(message: unknown) {
                    posts.push(message);
                },
                getState() {
                    return undefined;
                },
                setState() {},
            });

            const { getLogger, setLogger } = await import("../../webview/shared/logger");
            const previousLogger = getLogger();
            try {
                const { createVsCodeHostAdapter } =
                    await import("../../webview/adapters/host/vscode-host-adapter");
                const adapter = createVsCodeHostAdapter();
                let relayedNames: string[] | null = null;
                let relayedNode: NodeInstanceRef | null = null;
                const off = adapter.connect((message) => {
                    if (message.type === "focusVariable") {
                        relayedNames = message.names;
                    } else if (message.type === "focusNode") {
                        relayedNode = message.target;
                    }
                });

                adapter.requestFocusVariable(["hp"]);
                assert.equal(
                    (posts[0] as { type?: string } | undefined)?.type,
                    "requestFocusVariable"
                );
                assert.deepEqual(posts[0], {
                    type: "requestFocusVariable",
                    names: ["hp"],
                });

                const messageListeners = listeners.get("message");
                const messageListener = messageListeners ? Array.from(messageListeners)[0] : null;
                assert.ok(messageListener);
                messageListener?.({
                    data: {
                        type: "relayFocusVariable",
                        names: ["mp"],
                    },
                } as MessageEvent);
                assert.deepEqual(relayedNames, ["mp"]);

                messageListener?.({
                    data: {
                        type: "relayFocusNode",
                        target: {
                            instanceKey: "sub-root",
                            displayId: "",
                            structuralStableId: "sub-root",
                            sourceStableId: "sub-root",
                            sourceTreePath: null,
                            subtreeStack: [],
                        },
                    },
                } as MessageEvent);
                assert.deepEqual(relayedNode, {
                    instanceKey: "sub-root",
                    displayId: "",
                    structuralStableId: "sub-root",
                    sourceStableId: "sub-root",
                    sourceTreePath: null,
                    subtreeStack: [],
                });

                const resultPromise = adapter.readFile(
                    parseWorkdirRelativeJsonPath("sub/a.json")!,
                    {
                        openIfSubtree: true,
                        openSelection: {
                            instanceKey: "sub-root",
                            displayId: "",
                            structuralStableId: "sub-root",
                            sourceStableId: "sub-root",
                            sourceTreePath: null,
                            subtreeStack: [],
                        },
                    }
                );

                assert.equal((posts[1] as { type?: string } | undefined)?.type, "readFile");
                assert.equal(
                    (posts[1] as { openIfSubtree?: boolean } | undefined)?.openIfSubtree,
                    true
                );
                assert.deepEqual(
                    (posts[1] as { openSelection?: NodeInstanceRef } | undefined)?.openSelection,
                    {
                        instanceKey: "sub-root",
                        displayId: "",
                        structuralStableId: "sub-root",
                        sourceStableId: "sub-root",
                        sourceTreePath: null,
                        subtreeStack: [],
                    }
                );
                off();

                const result = await resultPromise;
                assert.deepEqual(result, { content: null });
            } finally {
                setLogger(previousLogger);
                testGlobal.window = previousWindow;
                testGlobal.acquireVsCodeApi = previousAcquire;
            }
        },
    },
]);
