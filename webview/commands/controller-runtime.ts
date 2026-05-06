import type { StoreApi } from "zustand/vanilla";
import i18n from "../shared/misc/i18n";
import { generateUuid } from "../shared/stable-id";
import type { AppHooksStore } from "../shared/misc/hooks";
import type {
    DocumentState,
    EditNode,
    EditNodeDef,
    DocumentMutationSelection,
    GraphHighlightState,
    GraphSearchState,
    HostAdapter,
    NodeCheckDiagnostic,
    NodeCheckValidationNode,
    NodeDef,
    NodeInstanceRef,
    PersistedNodeModel,
    PersistedTreeModel,
    ResolvedDocumentGraph,
    ResolvedNodeModel,
    SelectionState,
    WorkspaceState,
} from "../shared/contracts";
import type { GraphAdapter } from "../shared/graph-contracts";
import { parseWorkdirRelativeJsonPath } from "../shared/protocol";
import {
    cloneJsonValue,
    parsePersistedTreeContent,
    serializePersistedTree,
    walkPersistedNodes,
} from "../shared/tree";
import { loadSubtreeSourceCache } from "../shared/subtree-source-cache";
import {
    buildResolvedGraphModel,
    buildSearchState,
    computeVariableHighlights,
} from "../domain/graph-selectors";
import { resolveDocumentGraph } from "../domain/resolve-graph";
import { patchSelectionSearchState } from "../stores/selection-store";

/**
 * Shared controller runtime for the webview editor.
 * It keeps the resolved graph snapshot, coordinates store updates, and exposes
 * the few mutation/rebuild helpers that command modules are allowed to call.
 */
export interface ControllerDeps {
    documentStore: StoreApi<DocumentState>;
    workspaceStore: StoreApi<WorkspaceState>;
    selectionStore: StoreApi<SelectionState>;
    hostAdapter: HostAdapter;
    graphAdapter: GraphAdapter;
    appHooks: AppHooksStore;
}

export type SelectionPatch = Partial<
    Pick<
        SelectionState,
        | "selectedTree"
        | "selectedNodeKey"
        | "selectedNodeRef"
        | "selectedNodeSnapshot"
        | "selectedNodeDef"
        | "activeVariableNames"
    >
>;

export interface ControllerApplyTreeOptions {
    syncSubtreeSources?: boolean;
    rebuildGraph?: boolean;
    preserveSelection?: boolean;
    applyVisualState?: boolean;
}

export interface ControllerRuntime {
    readonly deps: ControllerDeps;
    getResolvedGraph(): ResolvedDocumentGraph | null;
    notifyError(text: string): void;
    notifySuccess(text: string): void;
    getNodeDef(name: string): NodeDef | null;
    selectTreeState(opts?: { clearVariableFocus?: boolean; reportInspector?: boolean }): boolean;
    selectResolvedNodeState(
        instanceKey: string,
        opts?: { clearVariableFocus?: boolean; reportInspector?: boolean }
    ): boolean;
    selectPendingNodeState(stableId: string, opts?: { reportInspector?: boolean }): void;
    clearActiveVariableFocus(): boolean;
    getSelectedResolvedNode(): ResolvedNodeModel | null;
    isSubtreeStructureLocked(node: ResolvedNodeModel | null): boolean;
    readClipboardNode(): Promise<PersistedNodeModel | null>;
    isDescendantInstance(ancestorKey: string, targetKey: string): boolean;
    buildPersistedNodeFromResolved(
        instanceKey: string,
        opts?: { clearPathOnRoot?: boolean }
    ): PersistedNodeModel | null;
    applyVisualState(): Promise<void>;
    rebuildGraph(opts?: { preserveSelection?: boolean }): Promise<void>;
    syncReachableSubtreeSources(): Promise<void>;
    getSerializedCurrentTree(): string | null;
    matchesCurrentDocumentSnapshot(content: string): boolean;
    applyDocumentTree(tree: PersistedTreeModel, opts?: ControllerApplyTreeOptions): Promise<void>;
    primeHostSelectionProjection(
        selection: DocumentMutationSelection,
        opts?: { reportInspector?: boolean }
    ): void;
}

export const cloneVars = <T extends { name: string; desc: string }>(entries: T[]): T[] =>
    entries.map((entry) => ({ ...entry }));

export const isJsonEqual = (left: unknown, right: unknown): boolean =>
    JSON.stringify(left) === JSON.stringify(right);

export const buildUsingGroups = (groupNames: string[]): Record<string, boolean> | null => {
    if (groupNames.length === 0) {
        return null;
    }
    const record: Record<string, boolean> = {};
    for (const group of groupNames) {
        record[group] = true;
    }
    return record;
};

export const createControllerRuntime = (deps: ControllerDeps): ControllerRuntime => {
    let resolvedGraph: ResolvedDocumentGraph | null = null;
    let nodeCheckRequestSeq = 0;

    const notifyError = (text: string) => {
        deps.appHooks.getMessage().error(text);
    };

    const notifySuccess = (text: string) => {
        deps.appHooks.getMessage().success(text);
    };

    const getNodeDef = (name: string): NodeDef | null => {
        return deps.workspaceStore.getState().nodeDefs.find((def) => def.name === name) ?? null;
    };

    const buildPendingSelectionRef = (stableId: string): NodeInstanceRef => ({
        instanceKey: stableId,
        displayId: "",
        structuralStableId: stableId,
        sourceStableId: stableId,
        sourceTreePath: null,
        subtreeStack: [],
    });

    const updateSelectionState = (buildPatch: (state: SelectionState) => SelectionPatch) => {
        deps.selectionStore.setState((state) => ({
            ...state,
            ...buildPatch(state),
        }));
    };

    const isInspectorSidebar = () =>
        typeof window !== "undefined" && window.__B3_WEBVIEW_KIND__ === "inspector-sidebar";

    const reportInspectorSelection = () => {
        if (isInspectorSidebar()) {
            return;
        }
        deps.hostAdapter.sendInspectorSelection(
            deps.selectionStore.getState().selectedNodeSnapshot ?? null
        );
    };

    const buildTreeSelectionPatch = (): SelectionPatch => {
        const filePath = deps.workspaceStore.getState().filePath;
        return {
            selectedTree: filePath ? { filePath } : null,
            selectedNodeKey: null,
            selectedNodeRef: null,
            selectedNodeSnapshot: null,
            selectedNodeDef: null,
        };
    };

    const buildSelectedNodeSnapshot = (instanceKey: string): EditNode | null => {
        const tree = deps.documentStore.getState().persistedTree;
        if (!tree || !resolvedGraph) {
            return null;
        }
        const node = resolvedGraph.nodesByInstanceKey[instanceKey];
        if (!node) {
            return null;
        }
        return {
            ref: node.ref,
            data: {
                uuid: node.ref.sourceStableId,
                id: node.ref.displayId,
                name: node.name,
                desc: node.desc,
                args: node.args,
                input: node.input,
                output: node.output,
                debug: node.debug,
                disabled: node.disabled,
                path: node.path,
            },
            prefix: tree.prefix,
            activeChildCount: node.childKeys.reduce((count, childKey) => {
                const child = resolvedGraph?.nodesByInstanceKey[childKey];
                return count + (child && !child.disabled ? 1 : 0);
            }, 0),
            disabled: !node.subtreeEditable,
            subtreeNode: node.subtreeNode,
            subtreeEditable: node.subtreeEditable,
            subtreeOriginal: node.subtreeOriginal,
            resolutionError: node.resolutionError,
        };
    };

    const buildSelectedNodeDef = (instanceKey: string): EditNodeDef | null => {
        if (!resolvedGraph) {
            return null;
        }
        const node = resolvedGraph.nodesByInstanceKey[instanceKey];
        if (!node) {
            return null;
        }
        return {
            data: getNodeDef(node.name),
            path: node.path,
        };
    };

    const buildResolvedNodeSelectionPatch = (instanceKey: string): SelectionPatch | null => {
        if (!resolvedGraph) {
            return null;
        }

        const node = resolvedGraph.nodesByInstanceKey[instanceKey];
        if (!node) {
            return null;
        }

        return {
            selectedTree: null,
            selectedNodeKey: node.ref.instanceKey,
            selectedNodeRef: node.ref,
            selectedNodeSnapshot: buildSelectedNodeSnapshot(node.ref.instanceKey),
            selectedNodeDef: buildSelectedNodeDef(node.ref.instanceKey),
        };
    };

    const buildPendingNodeSelectionPatch = (stableId: string): SelectionPatch => ({
        selectedTree: null,
        selectedNodeKey: stableId,
        selectedNodeRef: buildPendingSelectionRef(stableId),
        selectedNodeSnapshot: null,
        selectedNodeDef: null,
    });

    const clearActiveVariableFocus = (): boolean => {
        if (deps.selectionStore.getState().activeVariableNames.length === 0) {
            return false;
        }

        updateSelectionState(() => ({
            activeVariableNames: [],
        }));
        return true;
    };

    const selectTreeState = (opts?: {
        clearVariableFocus?: boolean;
        reportInspector?: boolean;
    }): boolean => {
        const shouldClearVariableFocus =
            Boolean(opts?.clearVariableFocus) &&
            deps.selectionStore.getState().activeVariableNames.length > 0;
        updateSelectionState((state) => ({
            ...buildTreeSelectionPatch(),
            activeVariableNames: shouldClearVariableFocus ? [] : state.activeVariableNames,
        }));
        if (opts?.reportInspector !== false) {
            reportInspectorSelection();
        }
        return shouldClearVariableFocus;
    };

    const selectResolvedNodeState = (
        instanceKey: string,
        opts?: { clearVariableFocus?: boolean; reportInspector?: boolean }
    ): boolean => {
        const patch = buildResolvedNodeSelectionPatch(instanceKey);
        if (!patch) {
            return false;
        }

        const shouldClearVariableFocus =
            Boolean(opts?.clearVariableFocus) &&
            deps.selectionStore.getState().activeVariableNames.length > 0;
        updateSelectionState((state) => ({
            ...patch,
            activeVariableNames: shouldClearVariableFocus ? [] : state.activeVariableNames,
        }));
        if (opts?.reportInspector !== false) {
            reportInspectorSelection();
        }
        return shouldClearVariableFocus;
    };

    const selectPendingNodeState = (stableId: string, opts?: { reportInspector?: boolean }) => {
        updateSelectionState(() => buildPendingNodeSelectionPatch(stableId));
        if (opts?.reportInspector) {
            reportInspectorSelection();
        }
    };

    const primeHostSelectionProjection = (
        selection: DocumentMutationSelection,
        opts?: { reportInspector?: boolean }
    ) => {
        if (selection.kind === "tree") {
            selectTreeState({ reportInspector: opts?.reportInspector });
            return;
        }

        const nextNode = Object.values(resolvedGraph?.nodesByInstanceKey ?? {}).find(
            (node) => node.ref.structuralStableId === selection.structuralStableId
        );
        if (nextNode) {
            selectResolvedNodeState(nextNode.ref.instanceKey, {
                reportInspector: opts?.reportInspector,
            });
            return;
        }

        selectPendingNodeState(selection.structuralStableId, {
            reportInspector: opts?.reportInspector,
        });
    };

    const getSelectedResolvedNode = (): ResolvedNodeModel | null => {
        const ref = deps.selectionStore.getState().selectedNodeRef;
        if (!ref || !resolvedGraph) {
            return null;
        }
        return resolvedGraph.nodesByInstanceKey[ref.instanceKey] ?? null;
    };

    const isSubtreeStructureLocked = (node: ResolvedNodeModel | null) =>
        Boolean(node?.subtreeNode || node?.path);

    /**
     * Accept only the persisted node shape we know how to paste.
     * Subtree links own their contents via `path`, so pasted roots must drop
     * inline `children` when a subtree reference is present.
     */
    const normalizeClipboardNode = (value: unknown): PersistedNodeModel => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw new Error("invalid clipboard node");
        }

        const candidate = value as Partial<PersistedNodeModel> & { $id?: unknown };
        if (typeof candidate.name !== "string" || !candidate.name.trim()) {
            throw new Error("invalid clipboard node");
        }

        const normalized: PersistedNodeModel = {
            uuid:
                typeof candidate.uuid === "string" && candidate.uuid
                    ? candidate.uuid
                    : typeof candidate.$id === "string" && candidate.$id
                      ? candidate.$id
                      : generateUuid(),
            id: typeof candidate.id === "string" ? candidate.id : "",
            name: candidate.name,
            desc: typeof candidate.desc === "string" ? candidate.desc : undefined,
            args:
                candidate.args &&
                typeof candidate.args === "object" &&
                !Array.isArray(candidate.args)
                    ? cloneJsonValue(candidate.args)
                    : undefined,
            input: Array.isArray(candidate.input)
                ? candidate.input.map((entry) => String(entry ?? ""))
                : undefined,
            output: Array.isArray(candidate.output)
                ? candidate.output.map((entry) => String(entry ?? ""))
                : undefined,
            children: Array.isArray(candidate.children)
                ? candidate.children.map((child) => normalizeClipboardNode(child))
                : undefined,
            debug: typeof candidate.debug === "boolean" ? candidate.debug : undefined,
            disabled: typeof candidate.disabled === "boolean" ? candidate.disabled : undefined,
            path:
                typeof candidate.path === "string" && candidate.path.trim()
                    ? (parseWorkdirRelativeJsonPath(candidate.path) ?? undefined)
                    : undefined,
        };

        if (normalized.path) {
            normalized.children = undefined;
        }

        return normalized;
    };

    const readClipboardNode = async (): Promise<PersistedNodeModel | null> => {
        try {
            const text = await navigator.clipboard.readText();
            if (!text.trim()) {
                return null;
            }
            return normalizeClipboardNode(JSON.parse(text) as unknown);
        } catch (error) {
            deps.hostAdapter.log("warn", `[v2] clipboard read failed: ${String(error)}`);
            notifyError(i18n.t("node.pasteDataError"));
            return null;
        }
    };

    const isDescendantInstance = (ancestorKey: string, targetKey: string): boolean => {
        if (!resolvedGraph) {
            return false;
        }

        let current = resolvedGraph.nodesByInstanceKey[targetKey];
        while (current?.parentKey) {
            if (current.parentKey === ancestorKey) {
                return true;
            }
            current = resolvedGraph.nodesByInstanceKey[current.parentKey];
        }

        return false;
    };

    const buildPersistedNodeFromResolved = (
        instanceKey: string,
        opts?: { clearPathOnRoot?: boolean }
    ): PersistedNodeModel | null => {
        /**
         * Convert the resolved/materialized graph back into persisted node data.
         * The root keeps its structural id so replace-in-place mutations still
         * target the current node, while descendants keep source ids so subtree
         * edits preserve their original ownership.
         */
        const buildNode = (currentKey: string, isRoot: boolean): PersistedNodeModel | null => {
            if (!resolvedGraph) {
                return null;
            }
            const resolvedNode = resolvedGraph.nodesByInstanceKey[currentKey];
            if (!resolvedNode) {
                return null;
            }

            const node: PersistedNodeModel = {
                uuid: isRoot
                    ? resolvedNode.ref.structuralStableId
                    : resolvedNode.ref.sourceStableId,
                id: resolvedNode.ref.displayId,
                name: resolvedNode.name,
                desc: resolvedNode.desc,
                args: resolvedNode.args ? cloneJsonValue(resolvedNode.args) : undefined,
                input: resolvedNode.input ? [...resolvedNode.input] : undefined,
                output: resolvedNode.output ? [...resolvedNode.output] : undefined,
                debug: resolvedNode.debug,
                disabled: resolvedNode.disabled,
                path: isRoot && opts?.clearPathOnRoot ? undefined : resolvedNode.path,
                children: undefined,
            };

            if (resolvedNode.childKeys.length > 0) {
                node.children = resolvedNode.childKeys
                    .map((childKey) => buildNode(childKey, false))
                    .filter((child): child is PersistedNodeModel => Boolean(child));
            }

            return node;
        };

        return buildNode(instanceKey, true);
    };

    const getSerializedCurrentTree = (): string | null => {
        const tree = deps.documentStore.getState().persistedTree;
        return tree ? serializePersistedTree(tree) : null;
    };

    const cloneNodeArgs = (args: Record<string, unknown> | undefined) =>
        args ? (cloneJsonValue(args) as Record<string, unknown>) : undefined;

    const collectNodeCheckValidationNodes = (
        graph: ResolvedDocumentGraph,
        nodeDefs: NodeDef[]
    ): NodeCheckValidationNode[] => {
        const defsByName = new Map(nodeDefs.map((def) => [def.name, def] as const));
        const nodes: NodeCheckValidationNode[] = [];
        for (const key of graph.nodeOrder) {
            const node = graph.nodesByInstanceKey[key];
            const def = defsByName.get(node.name);
            if (!def?.args?.some((arg) => arg.checker?.trim())) {
                continue;
            }
            nodes.push({
                instanceKey: node.ref.instanceKey,
                treePath: node.ref.sourceTreePath,
                node: {
                    uuid: node.ref.sourceStableId,
                    id: node.renderedIdLabel,
                    name: node.name,
                    desc: node.desc,
                    args: cloneNodeArgs(node.args),
                    input: node.input ? [...node.input] : undefined,
                    output: node.output ? [...node.output] : undefined,
                    debug: node.debug,
                    disabled: node.disabled,
                    path: node.path,
                    children: [],
                },
            });
        }
        return nodes;
    };

    const requestNodeCheckDiagnostics = async (
        graph: ResolvedDocumentGraph,
        workspace: WorkspaceState
    ): Promise<Record<string, NodeCheckDiagnostic[]>> => {
        const content = getSerializedCurrentTree();
        const treePath = workspace.filePath;
        const nodes = collectNodeCheckValidationNodes(graph, workspace.nodeDefs);
        const requestSeq = ++nodeCheckRequestSeq;
        if (!content || !treePath || nodes.length === 0) {
            deps.workspaceStore.setState((state) => ({
                ...state,
                nodeCheckDiagnostics: {},
            }));
            return {};
        }

        const response = await deps.hostAdapter.validateNodeChecks(content, treePath, nodes);
        if (requestSeq !== nodeCheckRequestSeq) {
            return deps.workspaceStore.getState().nodeCheckDiagnostics;
        }
        if (response.error) {
            deps.hostAdapter.log("warn", `[v2] node check validation failed: ${response.error}`);
        }

        const nextDiagnostics: Record<string, NodeCheckDiagnostic[]> = {};
        for (const diagnostic of response.diagnostics) {
            (nextDiagnostics[diagnostic.instanceKey] ||= []).push(diagnostic);
        }
        deps.workspaceStore.setState((state) => ({
            ...state,
            nodeCheckDiagnostics: nextDiagnostics,
        }));
        return nextDiagnostics;
    };

    const normalizeHostDocumentSnapshot = (content: string): string | null => {
        const filePath = deps.workspaceStore.getState().filePath || undefined;
        try {
            return serializePersistedTree(parsePersistedTreeContent(content, filePath));
        } catch {
            return null;
        }
    };

    const matchesCurrentDocumentSnapshot = (content: string): boolean => {
        const currentSnapshot = getSerializedCurrentTree();
        if (!currentSnapshot) {
            return false;
        }
        return normalizeHostDocumentSnapshot(content) === currentSnapshot;
    };

    /**
     * Centralized graph-side refresh after selection/search/variable-focus
     * changes. Commands update stores first, then let this recompute all
     * derived visual state from the cached resolved graph.
     */
    const applyVisualState = async () => {
        if (!resolvedGraph) {
            return;
        }
        const selection = deps.selectionStore.getState();
        const workspace = deps.workspaceStore.getState();

        await deps.graphAdapter.applySelection({
            selectedNodeKey: selection.selectedNodeKey,
        });

        const highlights: GraphHighlightState = computeVariableHighlights(
            resolvedGraph,
            workspace.nodeDefs,
            selection.activeVariableNames
        );
        await deps.graphAdapter.applyHighlights(highlights);

        const graphSearch: GraphSearchState = buildSearchState({
            graph: resolvedGraph,
            query: selection.search.query,
            mode: selection.search.mode,
            caseSensitive: selection.search.caseSensitive,
            focusOnly: selection.search.focusOnly,
            activeResultIndex: selection.search.index,
            tree: deps.documentStore.getState().persistedTree,
        });

        patchSelectionSearchState(deps.selectionStore, {
            results: graphSearch.resultKeys,
            index: graphSearch.activeResultIndex,
        });

        await deps.graphAdapter.applySearch(graphSearch);
    };

    /**
     * Selection survives rebuilds by rebinding to the best matching node.
     * Instance keys are preferred, then we progressively fall back to stable
     * source identities because subtree expansion can reallocate instance keys.
     */
    const restoreSelection = async () => {
        const selection = deps.selectionStore.getState();
        if (!resolvedGraph || !selection.selectedNodeRef) {
            reportInspectorSelection();
            await deps.graphAdapter.applySelection({ selectedNodeKey: null });
            return;
        }

        const direct = resolvedGraph.nodesByInstanceKey[selection.selectedNodeRef.instanceKey];
        const fallback =
            direct ??
            Object.values(resolvedGraph.nodesByInstanceKey).find(
                (node) =>
                    node.ref.structuralStableId === selection.selectedNodeRef?.structuralStableId &&
                    node.ref.sourceStableId === selection.selectedNodeRef?.sourceStableId &&
                    node.ref.sourceTreePath === selection.selectedNodeRef?.sourceTreePath
            ) ??
            Object.values(resolvedGraph.nodesByInstanceKey).find(
                (node) =>
                    node.ref.sourceStableId === selection.selectedNodeRef?.sourceStableId &&
                    node.ref.sourceTreePath === selection.selectedNodeRef?.sourceTreePath
            ) ??
            Object.values(resolvedGraph.nodesByInstanceKey).find(
                (node) =>
                    node.ref.structuralStableId === selection.selectedNodeRef?.structuralStableId
            );

        if (!fallback) {
            updateSelectionState(() => buildTreeSelectionPatch());
            reportInspectorSelection();
            await deps.graphAdapter.applySelection({ selectedNodeKey: null });
            return;
        }

        updateSelectionState(() => buildResolvedNodeSelectionPatch(fallback.ref.instanceKey) ?? {});
        reportInspectorSelection();
        await deps.graphAdapter.applySelection({ selectedNodeKey: fallback.ref.instanceKey });
    };

    /**
     * The only place that replaces the cached resolved graph snapshot.
     * All command modules depend on this after any tree/subtree/settings change.
     */
    const rebuildGraph = async (opts?: { preserveSelection?: boolean }) => {
        const tree = deps.documentStore.getState().persistedTree;
        const workspace = deps.workspaceStore.getState();
        if (!tree) {
            return;
        }

        const result = resolveDocumentGraph({
            persistedTree: tree,
            subtreeSources: workspace.subtreeSources,
            nodeDefs: workspace.nodeDefs,
            subtreeEditable: workspace.settings.subtreeEditable,
        });

        resolvedGraph = result.graph;
        const nodeCheckDiagnostics = await requestNodeCheckDiagnostics(result.graph, workspace);

        await deps.graphAdapter.render(
            buildResolvedGraphModel(
                result.graph,
                workspace.nodeDefs,
                workspace.settings.nodeColors,
                {
                    usingVars: workspace.usingVars,
                    usingGroups: workspace.usingGroups,
                    checkExpr: workspace.settings.checkExpr,
                    nodeCheckDiagnostics,
                }
            )
        );
        if (opts?.preserveSelection) {
            await restoreSelection();
        } else {
            await deps.graphAdapter.applySelection({
                selectedNodeKey: deps.selectionStore.getState().selectedNodeKey,
            });
        }
        await applyVisualState();
    };

    /**
     * Refresh the subtree cache for files that are currently reachable from the
     * main tree only. Any write-back here is for normalization such as filling
     * missing ids/defaults discovered while loading subtree content.
     */
    const syncReachableSubtreeSources = async () => {
        const tree = deps.documentStore.getState().persistedTree;
        if (!tree) {
            return;
        }

        const nextSources = await loadSubtreeSourceCache({
            root: tree.root,
            readContent: async (path) => {
                const response = await deps.hostAdapter.readFile(path);
                return response.content;
            },
            onTreeLoaded: ({ path, tree: subtree, needsWriteback }) => {
                if (needsWriteback) {
                    void deps.hostAdapter.saveSubtree(path, serializePersistedTree(subtree));
                }
            },
        });

        deps.workspaceStore.setState((state) => ({
            ...state,
            subtreeSources: nextSources,
            subtreeSourceRevision: state.subtreeSourceRevision + 1,
        }));
    };

    const setDocumentTree = (tree: PersistedTreeModel) => {
        deps.documentStore.setState((state) => {
            return {
                ...state,
                persistedTree: tree,
            };
        });
        deps.workspaceStore.setState((state) => ({
            ...state,
            usingGroups: buildUsingGroups(tree.group),
        }));
    };

    /**
     * Canonical "apply tree into editor state" path shared by open/reload and
     * host-driven snapshot refreshes so graph rebuild + subtree syncing stay
     * consistent across every entry point.
     */
    const applyDocumentTree = async (
        tree: PersistedTreeModel,
        opts?: ControllerApplyTreeOptions
    ) => {
        setDocumentTree(tree);

        if (opts?.syncSubtreeSources !== false) {
            await syncReachableSubtreeSources();
        }

        if (opts?.rebuildGraph !== false) {
            await rebuildGraph({ preserveSelection: opts?.preserveSelection ?? true });
            return;
        }

        if (opts?.applyVisualState) {
            await applyVisualState();
        }
    };

    return {
        deps,
        getResolvedGraph: () => resolvedGraph,
        notifyError,
        notifySuccess,
        getNodeDef,
        selectTreeState,
        selectResolvedNodeState,
        selectPendingNodeState,
        clearActiveVariableFocus,
        getSelectedResolvedNode,
        isSubtreeStructureLocked,
        readClipboardNode,
        isDescendantInstance,
        buildPersistedNodeFromResolved,
        applyVisualState,
        rebuildGraph,
        syncReachableSubtreeSources,
        getSerializedCurrentTree,
        matchesCurrentDocumentSnapshot,
        applyDocumentTree,
        primeHostSelectionProjection,
    };
};
