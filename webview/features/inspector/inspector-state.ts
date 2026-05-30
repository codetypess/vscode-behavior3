import { Form } from "antd";
import type { FormInstance } from "antd/es/form";
import { useMemo } from "react";
import { useDocumentStore, useSelectionStore, useWorkspaceStore } from "../../app/runtime";
import { createNodeDefMap, findNodeDef } from "../../shared/node-utils";
import { filterStructuredArgsByVisibility } from "./inspector-arg-visibility";
import { getCachedInspectorNodeSnapshot } from "./inspector-node-snapshot-cache";
import {
    buildTreeInspectorVariableUsageCount,
    createVariableOptions,
    type VariableRowValue,
} from "./inspector-variable-options";

type ImportRefFormValue = {
    path?: string;
    vars?: VariableRowValue[];
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
    const nodeFieldDiagnostics = useWorkspaceStore((state) => state.nodeFieldDiagnostics);
    const selectedNodeFieldVisibility = useWorkspaceStore(
        (state) => state.selectedNodeFieldVisibility
    );
    const pendingSelectedNodeSnapshot =
        !rawSelectedNode && Boolean(selectedNodeRef && selectedNode);

    return {
        document,
        selectedNode,
        pendingSelectedNodeSnapshot,
        nodeDefs,
        usingVars,
        usingGroups,
        allFiles,
        checkExpr,
        nodeFieldDiagnostics,
        selectedNodeFieldVisibility,
    };
};

export const useTreeInspectorState = () => {
    const document = useDocumentStore((state) => state.persistedTree);
    const nodeDefs = useWorkspaceStore((state) => state.nodeDefs);
    const groupDefs = useWorkspaceStore((state) => state.groupDefs);
    const allFiles = useWorkspaceStore((state) => state.allFiles);
    const importDecls = useWorkspaceStore((state) => state.importDecls);
    const subtreeDecls = useWorkspaceStore((state) => state.subtreeDecls);
    const subtreeSources = useWorkspaceStore((state) => state.subtreeSources);
    const subtreeEditable = useWorkspaceStore((state) => state.settings.subtreeEditable);

    return {
        document,
        nodeDefs,
        groupDefs,
        allFiles,
        importDecls,
        subtreeDecls,
        subtreeSources,
        subtreeEditable,
    };
};

export const useNodeInspectorViewState = (form: FormInstance) => {
    const {
        document,
        selectedNode,
        pendingSelectedNodeSnapshot,
        nodeDefs,
        usingVars,
        usingGroups,
        allFiles,
        checkExpr,
        nodeFieldDiagnostics,
        selectedNodeFieldVisibility,
    } = useNodeInspectorState();

    const nodeDefMap = useMemo(() => createNodeDefMap(nodeDefs), [nodeDefs]);
    const variableOptions = useMemo(
        () => createVariableOptions(usingVars, document?.root ?? null, nodeDefMap),
        [usingVars, document?.root, nodeDefMap]
    );
    const watchedName = Form.useWatch("name", form) as string | undefined;

    const effectiveName =
        (watchedName ?? selectedNode?.data.name ?? "").trim() || selectedNode?.data.name || "";
    const nodeDef = findNodeDef(nodeDefMap, effectiveName);
    const fieldEditDisabled = selectedNode?.disabled ?? false;
    const structuredArgs = filterStructuredArgsByVisibility(
        nodeDef?.args ?? [],
        selectedNode ? selectedNodeFieldVisibility.args : {}
    );
    const subtreeOriginal = selectedNode?.subtreeOriginal;

    return {
        document,
        selectedNode,
        pendingSelectedNodeSnapshot,
        nodeDefs,
        usingVars,
        usingGroups,
        allFiles,
        checkExpr,
        nodeFieldDiagnostics: selectedNode
            ? (nodeFieldDiagnostics[selectedNode.ref.instanceKey] ?? [])
            : [],
        nodeDefMap,
        variableOptions,
        watchedName,
        effectiveName,
        nodeDef,
        fieldEditDisabled,
        title: nodeDef?.desc || effectiveName,
        structuredArgs,
        hasStructuredArgs: structuredArgs.length > 0,
        shouldShowRawNodeJson: nodeDef === null,
        subtreeOriginal,
        canShowOverride: Boolean(selectedNode?.subtreeNode && subtreeOriginal),
        selectedNodeFieldVisibility,
    };
};

export const useTreeInspectorViewState = (form: FormInstance) => {
    const {
        document,
        nodeDefs,
        groupDefs,
        allFiles,
        importDecls,
        subtreeDecls,
        subtreeSources,
        subtreeEditable,
    } = useTreeInspectorState();

    const nodeDefMap = useMemo(() => createNodeDefMap(nodeDefs), [nodeDefs]);
    const variableUsageCount = useMemo(
        () =>
            buildTreeInspectorVariableUsageCount({
                document,
                subtreeSources,
                nodeDefs,
                nodeDefMap,
                subtreeEditable,
            }),
        [document, subtreeSources, nodeDefs, nodeDefMap, subtreeEditable]
    );
    const currentImportRefs =
        (Form.useWatch("importRefs", form) as ImportRefFormValue[] | undefined) ?? [];

    const subtreeRows = useMemo(
        () =>
            subtreeDecls.map((entry) => ({
                ...entry,
                vars: entry.vars.map((variable) => ({
                    ...variable,
                    count: variableUsageCount[variable.name] ?? 0,
                })),
            })),
        [subtreeDecls, variableUsageCount]
    );

    const importDeclByPath = useMemo(() => {
        const record = new Map<string, VariableRowValue[]>();
        importDecls.forEach((entry) => {
            record.set(
                entry.path,
                entry.vars.map((variable) => ({
                    ...variable,
                    count: variableUsageCount[variable.name] ?? 0,
                }))
            );
        });
        return record;
    }, [importDecls, variableUsageCount]);

    return {
        document,
        nodeDefs,
        groupDefs,
        allFiles,
        importDecls,
        subtreeDecls,
        nodeDefMap,
        variableUsageCount,
        currentImportRefs,
        subtreeRows,
        importDeclByPath,
    };
};
