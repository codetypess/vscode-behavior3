import type { EditorToHostMessage, HostToEditorMessage } from "../../shared/message-protocol";
import {
    createHostRequestTimeoutResponse,
    isHostRequestResultMessage,
    resolveHostRequestResult,
    type PendingRequestMap,
    type PendingRequestType,
} from "../../shared/host-request-spec";
import { composeLoggers, createConsoleLogger, setLogger, type Logger } from "../../shared/logger";
import type {
    HostAdapter,
    DocumentMutationResponse,
    ReadFileResponse,
    RevertDocumentResponse,
    SaveDocumentResponse,
    SaveSubtreeAsResponse,
    SaveSubtreeResponse,
    ValidateNodeChecksResponse,
    WorkdirRelativeJsonPath,
} from "../../shared/contracts";
import {
    normalizeHostDocumentSnapshot,
    normalizeHostInitMessage,
    normalizeHostVarsMessage,
    normalizeNodeInstanceRef,
    parseWorkdirRelativeJsonPath,
} from "../../shared/protocol";

declare function acquireVsCodeApi(): {
    postMessage(message: EditorToHostMessage): void;
    getState(): unknown;
    setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

type PendingRequest = {
    [K in PendingRequestType]: {
        type: K;
        timeout: number;
        resolve(value: PendingRequestMap[K]): void;
    };
}[PendingRequestType];

const pendingRequests = new Map<string, PendingRequest>();
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

let requestSequence = 0;

const createRequestId = (): string => {
    requestSequence = (requestSequence + 1) % Number.MAX_SAFE_INTEGER;
    const sequence = requestSequence.toString(36);
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) {
        return `req-${sequence}-${uuid}`;
    }
    return `req-${Date.now().toString(36)}-${sequence}`;
};

const formatLogArg = (value: unknown): string => {
    if (typeof value === "string") {
        return value;
    }
    if (value instanceof Error) {
        return value.stack ?? value.message;
    }
    try {
        if (value && typeof value === "object") {
            return JSON.stringify(value);
        }
    } catch {
        // ignore serialization failure
    }
    return String(value);
};

const formatRuntimeError = (value: unknown): string => {
    if (value instanceof Error) {
        return value.stack ?? value.message;
    }
    return formatLogArg(value);
};

const postMessage = (message: EditorToHostMessage) => {
    vscode.postMessage(message);
};

const registerPendingRequest = <K extends PendingRequestType>(
    type: K,
    resolve: (value: PendingRequestMap[K]) => void,
    requestId = createRequestId(),
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
): string => {
    // Every host request resolves exactly once, even when the extension side never replies.
    const timeout = window.setTimeout(() => {
        const pending = pendingRequests.get(requestId);
        if (pending?.type !== type) {
            return;
        }
        pendingRequests.delete(requestId);
        (pending.resolve as (resolved: PendingRequestMap[K]) => void)(
            createHostRequestTimeoutResponse(type)
        );
    }, timeoutMs);

    pendingRequests.set(requestId, {
        type,
        timeout,
        resolve,
    } as unknown as PendingRequest);
    return requestId;
};

const resolvePendingRequest = (
    requestId: string,
    type: PendingRequestType,
    value: PendingRequestMap[PendingRequestType]
): boolean => {
    // Type matching prevents a stale response id from resolving the wrong request shape.
    const pending = pendingRequests.get(requestId);
    if (pending?.type !== type) {
        return false;
    }

    const resolvedPending = pending;
    pendingRequests.delete(requestId);
    window.clearTimeout(resolvedPending.timeout);
    (resolvedPending.resolve as (resolved: PendingRequestMap[typeof resolvedPending.type]) => void)(
        value as never
    );
    return true;
};

const resolveAllPendingRequests = () => {
    for (const [requestId, pending] of pendingRequests) {
        pendingRequests.delete(requestId);
        window.clearTimeout(pending.timeout);
        (pending.resolve as (resolved: PendingRequestMap[typeof pending.type]) => void)(
            createHostRequestTimeoutResponse(pending.type)
        );
    }
};

const createForwardLogger = (): Logger => {
    const forward =
        (level: "log" | "info" | "warn" | "error" | "debug") =>
        (...args: unknown[]) => {
            postMessage({
                type: "webviewLog",
                level,
                message: args.map(formatLogArg).join(" "),
            });
        };

    return {
        log: forward("log"),
        info: forward("info"),
        warn: forward("warn"),
        error: forward("error"),
        debug: forward("debug"),
    };
};

setLogger(composeLoggers(createConsoleLogger(), createForwardLogger()));

const hostRequestResolverContext = {
    parseWorkdirRelativeJsonPath,
};

export const createVsCodeHostAdapter = (): HostAdapter => {
    return {
        connect(onMessage) {
            const reportRuntimeError = (scope: string, error: unknown) => {
                postMessage({
                    type: "webviewLog",
                    level: "error",
                    message: `[webview:${scope}] ${formatRuntimeError(error)}`,
                });
            };

            const dispatchHostEvent = (message: HostToEditorMessage) => {
                // Transport messages are normalized at this adapter boundary before reaching stores.
                if (isHostRequestResultMessage(message)) {
                    const resolved = resolveHostRequestResult(message, hostRequestResolverContext);
                    resolvePendingRequest(resolved.requestId, resolved.type, resolved.value);
                    return;
                }

                switch (message.type) {
                    case "init":
                        onMessage({ type: "init", payload: normalizeHostInitMessage(message) });
                        return;

                    case "documentSnapshotChanged":
                        onMessage({
                            type: "documentSnapshotChanged",
                            snapshot: normalizeHostDocumentSnapshot(message.snapshot),
                        });
                        return;

                    case "relayFocusVariable":
                        onMessage({ type: "focusVariable", names: message.names });
                        return;

                    case "relayFocusNode":
                        onMessage({
                            type: "focusNode",
                            target: normalizeNodeInstanceRef(message.target),
                        });
                        return;

                    case "varDeclLoaded":
                        onMessage({
                            type: "varDeclLoaded",
                            payload: normalizeHostVarsMessage(message),
                        });
                        return;

                    case "themeChanged":
                        onMessage({ type: "themeChanged", theme: message.theme });
                        return;

                    case "subtreeFileChanged":
                        onMessage({ type: "subtreeFileChanged" });
                        return;

                    case "inspectorContextCleared":
                        onMessage({ type: "inspectorContextCleared" });
                        return;

                    case "toggleInspectorNodeJson":
                        onMessage({ type: "toggleInspectorNodeJson" });
                        return;

                    case "settingLoaded":
                        onMessage({
                            type: "settingLoaded",
                            nodeDefs: message.nodeDefs,
                            settings: message.settings,
                        });
                        return;

                    case "buildResult":
                        onMessage({
                            type: "buildResult",
                            success: message.success,
                            message: message.message,
                        });
                        return;
                }
            };

            const handler = (event: MessageEvent<HostToEditorMessage>) => {
                try {
                    dispatchHostEvent(event.data);
                } catch (error) {
                    reportRuntimeError("message", error);
                }
            };

            const errorHandler = (event: ErrorEvent) => {
                reportRuntimeError("error", event.error ?? event.message);
            };

            const rejectionHandler = (event: PromiseRejectionEvent) => {
                reportRuntimeError("unhandledrejection", event.reason);
            };

            window.addEventListener("message", handler);
            window.addEventListener("error", errorHandler);
            window.addEventListener("unhandledrejection", rejectionHandler);
            return () => {
                window.removeEventListener("message", handler);
                window.removeEventListener("error", errorHandler);
                window.removeEventListener("unhandledrejection", rejectionHandler);
                resolveAllPendingRequests();
            };
        },

        sendReady() {
            postMessage({ type: "ready" });
        },

        undo() {
            postMessage({ type: "undo" });
        },

        redo() {
            postMessage({ type: "redo" });
        },

        mutateDocument(mutation) {
            return new Promise<DocumentMutationResponse>((resolve) => {
                const requestId = registerPendingRequest("mutateDocument", resolve);
                postMessage({ type: "mutateDocument", requestId, mutation });
            });
        },

        selectTree() {
            postMessage({ type: "selectTree" });
        },

        selectNode(target) {
            postMessage({ type: "selectNode", target });
        },

        requestFocusVariable(names) {
            postMessage({ type: "requestFocusVariable", names });
        },

        sendRequestSetting() {
            postMessage({ type: "requestSetting" });
        },

        sendBuild(opts) {
            postMessage({ type: "build", buildScriptDebug: opts?.buildScriptDebug });
        },

        executeInspectorHostCommand(command) {
            postMessage({ type: "runInspectorCommand", command });
        },

        validateNodeChecks(content, treePath, nodes) {
            return new Promise<ValidateNodeChecksResponse>((resolve) => {
                const requestId = registerPendingRequest("validateNodeChecks", resolve);
                postMessage({
                    type: "validateNodeChecks",
                    requestId,
                    content,
                    treePath,
                    nodes,
                });
            });
        },

        saveDocument() {
            return new Promise<SaveDocumentResponse>((resolve) => {
                const requestId = registerPendingRequest("saveDocument", resolve);
                postMessage({ type: "saveDocument", requestId });
            });
        },

        revertDocument() {
            return new Promise<RevertDocumentResponse>((resolve) => {
                const requestId = registerPendingRequest("revertDocument", resolve);
                postMessage({ type: "revertDocument", requestId });
            });
        },

        readFile(path: WorkdirRelativeJsonPath, opts) {
            return new Promise<ReadFileResponse>((resolve) => {
                const requestId = registerPendingRequest("readFile", resolve);
                postMessage({
                    type: "readFile",
                    requestId,
                    path,
                    openIfSubtree: opts?.openIfSubtree,
                    openSelection: opts?.openSelection,
                });
            });
        },

        saveSubtree(path: WorkdirRelativeJsonPath, content: string) {
            return new Promise<SaveSubtreeResponse>((resolve) => {
                const requestId = registerPendingRequest("saveSubtree", resolve);
                postMessage({ type: "saveSubtree", requestId, path, content });
            });
        },

        saveSubtreeAs(content: string, suggestedBaseName: string) {
            return new Promise<SaveSubtreeAsResponse>((resolve) => {
                const requestId = registerPendingRequest("saveSubtreeAs", resolve);
                postMessage({ type: "saveSubtreeAs", requestId, content, suggestedBaseName });
            });
        },

        log(level, message) {
            postMessage({ type: "webviewLog", level, message });
        },
    };
};
