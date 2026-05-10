import type {
    DocumentMutationResponse,
    ReadFileResponse,
    RevertDocumentResponse,
    SaveDocumentResponse,
    SaveSubtreeAsResponse,
    SaveSubtreeResponse,
    ValidateNodeChecksResponse,
    WorkdirRelativeJsonPath,
} from "./contracts";
import type { HostToEditorMessage } from "./message-protocol";

export interface PendingRequestMap {
    readFile: ReadFileResponse;
    saveSubtree: SaveSubtreeResponse;
    saveSubtreeAs: SaveSubtreeAsResponse;
    saveDocument: SaveDocumentResponse;
    revertDocument: RevertDocumentResponse;
    mutateDocument: DocumentMutationResponse;
    validateNodeChecks: ValidateNodeChecksResponse;
}

export type PendingRequestType = keyof PendingRequestMap;

type PendingRequestResultMessageMap = {
    readFile: Extract<HostToEditorMessage, { type: "readFileResult" }>;
    saveSubtree: Extract<HostToEditorMessage, { type: "saveSubtreeResult" }>;
    saveSubtreeAs: Extract<HostToEditorMessage, { type: "saveSubtreeAsResult" }>;
    saveDocument: Extract<HostToEditorMessage, { type: "saveDocumentResult" }>;
    revertDocument: Extract<HostToEditorMessage, { type: "revertDocumentResult" }>;
    mutateDocument: Extract<HostToEditorMessage, { type: "mutateDocumentResult" }>;
    validateNodeChecks: Extract<HostToEditorMessage, { type: "validateNodeChecksResult" }>;
};

type PendingRequestResultMessage = PendingRequestResultMessageMap[PendingRequestType];
type PendingRequestResultType = PendingRequestResultMessage["type"];

export type HostRequestResolverContext = {
    parseWorkdirRelativeJsonPath(path: string): WorkdirRelativeJsonPath | null;
};

type HostRequestSpec<K extends PendingRequestType> = {
    resultType: PendingRequestResultMessageMap[K]["type"];
    createTimeoutResponse(): PendingRequestMap[K];
    resolveResult(
        message: PendingRequestResultMessageMap[K],
        context: HostRequestResolverContext
    ): PendingRequestMap[K];
};

const createBooleanResultTimeout = (type: string) => ({
    success: false,
    error: `Host request '${type}' timed out`,
});

const hostRequestSpecs = {
    readFile: {
        resultType: "readFileResult",
        createTimeoutResponse: () => ({ content: null }),
        resolveResult: (message) => ({
            content: message.content,
        }),
    },
    saveSubtree: {
        resultType: "saveSubtreeResult",
        createTimeoutResponse: () => createBooleanResultTimeout("saveSubtree"),
        resolveResult: (message) => ({
            success: message.success,
            error: message.error,
        }),
    },
    saveSubtreeAs: {
        resultType: "saveSubtreeAsResult",
        createTimeoutResponse: () => ({
            savedPath: null,
            error: "Host request 'saveSubtreeAs' timed out",
        }),
        resolveResult: (message, context) => {
            const savedPath = message.savedPath
                ? context.parseWorkdirRelativeJsonPath(message.savedPath)
                : null;
            return {
                savedPath,
                error:
                    message.error ??
                    (message.savedPath && !savedPath
                        ? "Host returned an invalid saved subtree path"
                        : undefined),
            };
        },
    },
    saveDocument: {
        resultType: "saveDocumentResult",
        createTimeoutResponse: () => createBooleanResultTimeout("saveDocument"),
        resolveResult: (message) => ({
            success: message.success,
            error: message.error,
        }),
    },
    revertDocument: {
        resultType: "revertDocumentResult",
        createTimeoutResponse: () => createBooleanResultTimeout("revertDocument"),
        resolveResult: (message) => ({
            success: message.success,
            error: message.error,
        }),
    },
    mutateDocument: {
        resultType: "mutateDocumentResult",
        createTimeoutResponse: () => createBooleanResultTimeout("mutateDocument"),
        resolveResult: (message) => ({
            success: message.success,
            error: message.error,
        }),
    },
    validateNodeChecks: {
        resultType: "validateNodeChecksResult",
        createTimeoutResponse: () => ({
            diagnostics: [],
            error: "Host request 'validateNodeChecks' timed out",
        }),
        resolveResult: (message) => ({
            diagnostics: message.diagnostics,
            error: message.error,
        }),
    },
} satisfies { [K in PendingRequestType]: HostRequestSpec<K> };

const pendingRequestTypeByResultType = Object.fromEntries(
    Object.entries(hostRequestSpecs).map(([requestType, spec]) => [spec.resultType, requestType])
) as Record<PendingRequestResultType, PendingRequestType>;

export const createHostRequestTimeoutResponse = <K extends PendingRequestType>(
    type: K
): PendingRequestMap[K] => hostRequestSpecs[type].createTimeoutResponse() as PendingRequestMap[K];

export const isHostRequestResultMessage = (
    message: HostToEditorMessage
): message is PendingRequestResultMessage => message.type in pendingRequestTypeByResultType;

export const resolveHostRequestResult = (
    message: PendingRequestResultMessage,
    context: HostRequestResolverContext
): {
    requestId: string;
    type: PendingRequestType;
    value: PendingRequestMap[PendingRequestType];
} => {
    const type = pendingRequestTypeByResultType[message.type];
    const spec = hostRequestSpecs[type] as HostRequestSpec<typeof type>;
    return {
        requestId: message.requestId,
        type,
        value: spec.resolveResult(message as never, context),
    };
};
