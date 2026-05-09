import React, { createContext, useContext } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import { createG6GraphAdapter } from "../adapters/graph/g6-graph-adapter";
import { createVsCodeHostAdapter } from "../adapters/host/vscode-host-adapter";
import { createEditorController } from "../commands/create-editor-controller";
import { createDocumentStore } from "../stores/document-store";
import { createGraphUiStore } from "../stores/graph-ui-store";
import { createSelectionStore } from "../stores/selection-store";
import { createWorkspaceStore } from "../stores/workspace-store";
import { createAppHooksStore, type AppHooksStore } from "../shared/misc/hooks";
import { detectWebviewKind, type WebviewKind } from "../shared/webview-kind";
import { getCachedInspectorNodeSnapshot } from "../features/inspector/inspector-node-snapshot-cache";
import type {
    DocumentState,
    EditorCommand,
    GraphUiState,
    SelectionState,
    WorkspaceState,
} from "../shared/contracts";
import type { GraphAdapter } from "../shared/graph-contracts";

export interface EditorRuntime {
    webviewKind: WebviewKind;
    documentStore: StoreApi<DocumentState>;
    workspaceStore: StoreApi<WorkspaceState>;
    selectionStore: StoreApi<SelectionState>;
    graphUiStore: StoreApi<GraphUiState>;
    controller: EditorCommand;
    graphAdapter: GraphAdapter;
    hostAdapter: ReturnType<typeof createVsCodeHostAdapter>;
    appHooks: AppHooksStore;
}

export const createEditorRuntime = (webviewKind: WebviewKind = detectWebviewKind()): EditorRuntime => {
    // Each webview gets isolated stores/adapters; host messages are the only shared boundary.
    const documentStore = createDocumentStore();
    const workspaceStore = createWorkspaceStore();
    const selectionStore = createSelectionStore();
    const graphUiStore = createGraphUiStore();
    const hostAdapter = createVsCodeHostAdapter();
    const graphAdapter = createG6GraphAdapter();
    const appHooks = createAppHooksStore();
    const controller = createEditorController({
        documentStore,
        workspaceStore,
        selectionStore,
        graphUiStore,
        hostAdapter,
        graphAdapter,
        appHooks,
    });

    return {
        webviewKind,
        documentStore,
        workspaceStore,
        selectionStore,
        graphUiStore,
        controller,
        graphAdapter,
        hostAdapter,
        appHooks,
    };
};

const RuntimeContext = createContext<EditorRuntime | null>(null);

export const RuntimeProvider: React.FC<React.PropsWithChildren<{ runtime: EditorRuntime }>> = ({
    runtime,
    children,
}) => {
    return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
};

export const useRuntime = (): EditorRuntime => {
    const runtime = useContext(RuntimeContext);
    if (!runtime) {
        throw new Error("V2 runtime is not available");
    }
    return runtime;
};

export const useWebviewKind = (): WebviewKind => useRuntime().webviewKind;

export const useDocumentStore = <T,>(selector: (state: DocumentState) => T): T => {
    const runtime = useRuntime();
    return useStore(runtime.documentStore, selector);
};

export const useWorkspaceStore = <T,>(selector: (state: WorkspaceState) => T): T => {
    const runtime = useRuntime();
    return useStore(runtime.workspaceStore, selector);
};

export const useSelectionStore = <T,>(selector: (state: SelectionState) => T): T => {
    const runtime = useRuntime();
    return useStore(runtime.selectionStore, selector);
};

export const useGraphUiStore = <T,>(selector: (state: GraphUiState) => T): T => {
    const runtime = useRuntime();
    return useStore(runtime.graphUiStore, selector);
};

export const useAppShellState = () => {
    const theme = useWorkspaceStore((state) => state.settings.theme);
    const language = useWorkspaceStore((state) => state.settings.language);
    const hasDocument = useDocumentStore((state) => state.persistedTree !== null);

    return {
        theme,
        language,
        hasDocument,
    };
};

export const useAppThemeState = () => {
    const { webviewKind } = useRuntime();
    const theme = useWorkspaceStore((state) => state.settings.theme);
    const language = useWorkspaceStore((state) => state.settings.language);
    const themeVersion = useWorkspaceStore((state) => state.themeVersion);

    return {
        theme,
        language,
        themeVersion,
        webviewKind,
    };
};

export const useInspectorPaneState = () => {
    const document = useDocumentStore((state) => state.persistedTree);
    const alertReload = useDocumentStore((state) => state.alertReload);
    const pendingExternalContent = useDocumentStore((state) => state.pendingExternalContent);
    const filePath = useWorkspaceStore((state) => state.filePath);
    const selectedNodeRef = useSelectionStore((state) => state.selectedNodeRef);
    const rawSelectedNode = useSelectionStore((state) => state.selectedNodeSnapshot);
    const selectedNode =
        rawSelectedNode ?? getCachedInspectorNodeSnapshot(filePath, selectedNodeRef);

    return {
        document,
        alertReload,
        pendingExternalContent,
        selectedNode,
        selectedNodeRef,
    };
};

export const useNodeInspectorState = () => {
    // Keep inspector selectors centralized so the form tree does not subscribe to whole stores.
    const document = useDocumentStore((state) => state.persistedTree);
    const filePath = useWorkspaceStore((state) => state.filePath);
    const selectedNodeRef = useSelectionStore((state) => state.selectedNodeRef);
    const rawSelectedNode = useSelectionStore((state) => state.selectedNodeSnapshot);
    const selectedNode =
        rawSelectedNode ?? getCachedInspectorNodeSnapshot(filePath, selectedNodeRef);
    const nodeDefs = useWorkspaceStore((state) => state.nodeDefs);
    const usingVars = useWorkspaceStore((state) => state.usingVars);
    const usingGroups = useWorkspaceStore((state) => state.usingGroups);
    const allFiles = useWorkspaceStore((state) => state.allFiles);
    const checkExpr = useWorkspaceStore((state) => state.settings.checkExpr);
    const nodeCheckDiagnostics = useWorkspaceStore((state) => state.nodeCheckDiagnostics);
    const pendingSelectedNodeSnapshot = !rawSelectedNode && Boolean(selectedNodeRef && selectedNode);

    return {
        document,
        selectedNode,
        pendingSelectedNodeSnapshot,
        nodeDefs,
        usingVars,
        usingGroups,
        allFiles,
        checkExpr,
        nodeCheckDiagnostics,
    };
};

export const useTreeInspectorState = () => {
    const document = useDocumentStore((state) => state.persistedTree);
    const nodeDefs = useWorkspaceStore((state) => state.nodeDefs);
    const groupDefs = useWorkspaceStore((state) => state.groupDefs);
    const allFiles = useWorkspaceStore((state) => state.allFiles);
    const importDecls = useWorkspaceStore((state) => state.importDecls);
    const subtreeDecls = useWorkspaceStore((state) => state.subtreeDecls);

    return {
        document,
        nodeDefs,
        groupDefs,
        allFiles,
        importDecls,
        subtreeDecls,
    };
};

export const useGraphPaneState = () => {
    const selectedNode = useSelectionStore((state) => state.selectedNodeSnapshot);
    const selectedNodeRef = useSelectionStore((state) => state.selectedNodeRef);
    const searchOpen = useGraphUiStore((state) => state.search.open);
    const rootStableId = useDocumentStore((state) => state.persistedTree?.root.uuid ?? null);

    return {
        selectedNode,
        selectedNodeRef,
        searchOpen,
        rootStableId,
    };
};
