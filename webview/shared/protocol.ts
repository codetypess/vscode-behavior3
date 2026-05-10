import type { HostToEditorMessage } from "./message-protocol";
import type {
    HostDocumentSnapshot,
    HostInitPayload,
    HostSelectionState,
    HostVarsPayload,
    ImportDecl,
    NodeInstanceRef,
    Settings,
    WorkdirRelativeJsonPath,
} from "./contracts";

const URI_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const WINDOWS_ABSOLUTE_PATTERN = /^[a-zA-Z]:[\\/]/;

const normalizeSeparators = (value: string): string => value.replace(/\\/g, "/");

export const parseWorkdirRelativeJsonPath = (value: unknown): WorkdirRelativeJsonPath | null => {
    if (typeof value !== "string") {
        return null;
    }

    const raw = value.trim();
    if (!raw || raw.includes("\0")) {
        return null;
    }
    if (
        raw.startsWith("/") ||
        raw.startsWith("\\") ||
        WINDOWS_ABSOLUTE_PATTERN.test(raw) ||
        URI_SCHEME_PATTERN.test(raw)
    ) {
        // Subtree/import paths are persisted relative to workdir only, never as absolute or URI paths.
        return null;
    }

    let normalized = normalizeSeparators(raw);
    while (normalized.startsWith("./")) {
        normalized = normalized.slice(2);
    }
    if (!normalized || normalized.startsWith("/") || normalized.endsWith("/")) {
        return null;
    }

    const segments = normalized.split("/");
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
        // Reject traversal early so host/webview path handling can share the same branded type.
        return null;
    }
    if (!normalized.toLowerCase().endsWith(".json")) {
        return null;
    }

    return normalized as WorkdirRelativeJsonPath;
};

export const normalizeWorkdirRelativePath = (path: string): WorkdirRelativeJsonPath => {
    const normalized = parseWorkdirRelativeJsonPath(path);
    if (!normalized) {
        throw new Error(`Invalid workdir-relative JSON path: ${path}`);
    }
    return normalized;
};

export const normalizeImportDecl = (decl: {
    path: string;
    vars: Array<{ name: string; desc: string }>;
}): ImportDecl => {
    return {
        path: normalizeWorkdirRelativePath(decl.path),
        vars: decl.vars.map((entry) => ({ name: entry.name, desc: entry.desc ?? "" })),
        depends: [],
    };
};

export const normalizeNodeInstanceRef = (ref: NodeInstanceRef): NodeInstanceRef => ({
    instanceKey: String(ref.instanceKey ?? ""),
    displayId: String(ref.displayId ?? ""),
    structuralStableId: String(ref.structuralStableId ?? ""),
    sourceStableId: String(ref.sourceStableId ?? ""),
    sourceTreePath:
        ref.sourceTreePath === null || ref.sourceTreePath === undefined
            ? null
            : normalizeWorkdirRelativePath(String(ref.sourceTreePath)),
    subtreeStack: Array.isArray(ref.subtreeStack)
        ? ref.subtreeStack.map((entry) => normalizeWorkdirRelativePath(String(entry)))
        : [],
});

export const normalizeHostSelectionState = (selection: HostSelectionState): HostSelectionState =>
    selection.kind === "tree"
        ? { kind: "tree" }
        : { kind: "node", ref: normalizeNodeInstanceRef(selection.ref) };

export const normalizeHostDocumentSnapshot = (
    snapshot: HostDocumentSnapshot
): HostDocumentSnapshot => ({
    content: snapshot.content,
    documentSession: snapshot.documentSession,
    selection: normalizeHostSelectionState(snapshot.selection),
    syncKind: snapshot.syncKind,
});

export const normalizeHostInitMessage = (
    message: Extract<HostToEditorMessage, { type: "init" }>
): HostInitPayload => {
    // Normalize once at the host boundary so stores and UI components can trust path shapes.
    const settings: Settings = {
        checkExpr: message.checkExpr,
        subtreeEditable: message.subtreeEditable,
        language: message.language,
        theme: message.theme,
        nodeColors: message.nodeColors,
    };

    return {
        filePath: message.filePath,
        workdir: message.workdir,
        content: message.content,
        nodeDefs: message.nodeDefs,
        allFiles: (message.allFiles ?? []).map(normalizeWorkdirRelativePath),
        settings,
        documentSession: message.documentSession,
        selection: normalizeHostSelectionState(message.selection),
    };
};

export const normalizeHostVarsMessage = (
    message: Extract<HostToEditorMessage, { type: "varDeclLoaded" }>
): HostVarsPayload => {
    const usingVars: HostVarsPayload["usingVars"] = {};
    for (const variable of message.usingVars) {
        usingVars[variable.name] = { name: variable.name, desc: variable.desc ?? "" };
    }

    return {
        usingVars,
        allFiles: message.allFiles?.map(normalizeWorkdirRelativePath),
        importDecls: (message.importDecls ?? []).map(normalizeImportDecl),
        subtreeDecls: (message.subtreeDecls ?? []).map(normalizeImportDecl),
    };
};
