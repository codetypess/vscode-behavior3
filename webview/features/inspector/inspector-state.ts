import { Form } from "antd";
import type { FormInstance } from "antd/es/form";
import { useMemo } from "react";
import { useNodeInspectorState, useTreeInspectorState } from "../../app/runtime";
import {
    buildTreeInspectorVariableUsageCount,
    createNodeDefMap,
    createVariableOptions,
    type VariableRowValue,
} from "./inspector-variable-options";

type ImportRefFormValue = {
    path?: string;
    vars?: VariableRowValue[];
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
        nodeCheckDiagnostics,
    } = useNodeInspectorState();

    const nodeDefMap = useMemo(() => createNodeDefMap(nodeDefs), [nodeDefs]);
    const variableOptions = useMemo(
        () => createVariableOptions(usingVars, document?.root ?? null, nodeDefMap),
        [usingVars, document?.root, nodeDefMap]
    );
    const watchedName = Form.useWatch("name", form) as string | undefined;

    const effectiveName =
        (watchedName ?? selectedNode?.data.name ?? "").trim() || selectedNode?.data.name || "";
    const nodeDef = nodeDefs.find((entry) => entry.name === effectiveName) ?? null;
    const fieldEditDisabled = selectedNode?.disabled ?? false;
    const structuredArgs = nodeDef?.args ?? [];
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
        nodeCheckDiagnostics: selectedNode
            ? (nodeCheckDiagnostics[selectedNode.ref.instanceKey] ?? [])
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
