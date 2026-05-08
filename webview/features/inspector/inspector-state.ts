import JSON5 from "json5";
import { Form } from "antd";
import type { FormInstance } from "antd/es/form";
import { useMemo } from "react";
import { useNodeInspectorState, useTreeInspectorState } from "../../app/runtime";
import { stringifySearchValueAsJson5 } from "../../shared/json5-display";
import type {
    EditNode,
    UpdateNodeInput,
    UpdateTreeMetaInput,
} from "../../shared/contracts";
import type { NodeArg, NodeDef } from "../../shared/misc/b3type";
import { isVariadic } from "../../shared/misc/b3util";
import { formatArgInitialValue, parseArgSubmitValue } from "./inspector-arg-values";
import {
    buildVariableUsageCount,
    createNodeDefMap,
    createVariableOptions,
    formatChildrenLabel,
    type VariableRowValue,
} from "./inspector-shared";

type ImportRefFormValue = {
    path?: string;
    vars?: VariableRowValue[];
};

type TreeInspectorDocument = NonNullable<ReturnType<typeof useTreeInspectorState>["document"]>;

export type TreeCustomRowValue = {
    key?: string;
    value?: string;
};

export type TreeCustomValue = string | number | boolean;
export type TreeCustomValueKind = "string" | "number" | "boolean" | "invalid";

type TreeInspectorFormValues = {
    desc?: string;
    prefix?: string;
    export?: boolean;
    group?: string[];
    vars?: VariableRowValue[];
    importRefs?: ImportRefFormValue[];
    customRows?: TreeCustomRowValue[];
};

const TREE_CUSTOM_LITERAL_START_PATTERN = /^[\[{'"0-9+\-.]/;
const TREE_CUSTOM_NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

const isQuotedTreeCustomString = (value: string) =>
    value.startsWith('"') || value.startsWith("'");

export const parseTreeCustomValue = (
    rawValue: string | undefined
): TreeCustomValue => {
    const value = rawValue ?? "";
    const trimmed = value.trim();

    if (!trimmed) {
        return "";
    }

    if (trimmed === "true") {
        return true;
    }

    if (trimmed === "false") {
        return false;
    }

    if (TREE_CUSTOM_NUMBER_PATTERN.test(trimmed)) {
        const parsed = Number(trimmed);
        if (!Number.isFinite(parsed)) {
            throw new Error("invalid tree custom value");
        }
        return parsed;
    }

    if (isQuotedTreeCustomString(trimmed)) {
        let parsed: unknown;
        try {
            parsed = JSON5.parse(trimmed);
        } catch {
            throw new Error("invalid tree custom value");
        }
        if (typeof parsed !== "string") {
            throw new Error("invalid tree custom value");
        }
        return parsed;
    }

    if (trimmed.startsWith("{") || trimmed.startsWith("[") || TREE_CUSTOM_LITERAL_START_PATTERN.test(trimmed)) {
        throw new Error("invalid tree custom value");
    }

    return value;
};

export const getTreeCustomValueKind = (
    rawValue: string | undefined
): TreeCustomValueKind => {
    try {
        const value = parseTreeCustomValue(rawValue);
        if (typeof value === "boolean") {
            return "boolean";
        }
        if (typeof value === "number") {
            return "number";
        }
        return "string";
    } catch {
        return "invalid";
    }
};

export const buildTreeCustomRecord = (
    rows: TreeCustomRowValue[] | undefined
): Record<string, TreeCustomValue> => {
    const custom: Record<string, TreeCustomValue> = {};

    for (const row of rows ?? []) {
        const key = row.key?.trim();
        if (!key) {
            continue;
        }
        custom[key] = parseTreeCustomValue(row.value);
    }

    return custom;
};

export const buildCommittedNodeData = (selectedNode: EditNode): UpdateNodeInput["data"] => ({
    name: selectedNode.data.name,
    desc: selectedNode.data.desc,
    path: selectedNode.data.path,
    debug: selectedNode.data.debug ? true : undefined,
    disabled: selectedNode.data.disabled ? true : undefined,
    input: selectedNode.data.input ? [...selectedNode.data.input] : undefined,
    output: selectedNode.data.output ? [...selectedNode.data.output] : undefined,
    args: selectedNode.data.args ? { ...selectedNode.data.args } : undefined,
});

export const parseVisibleArgs = (
    currentNodeDef: NodeDef | null,
    values: Pick<NodeInspectorFormValues, "args">,
    fallbackArgs: Record<string, unknown> | undefined
) => {
    if (!currentNodeDef) {
        return fallbackArgs;
    }

    const nextArgs = Object.fromEntries(
        (currentNodeDef.args ?? [])
            .map((arg) => [arg.name, parseArgSubmitValue(arg, values.args?.[arg.name])])
            .filter(([, value]) => value !== undefined)
    );
    return Object.keys(nextArgs).length > 0 ? nextArgs : undefined;
};

export const buildScopedSlotArray = (
    slotDefs: string[] | undefined,
    committedSlots: string[] | undefined,
    rawFormSlots: unknown,
    index: number
) => {
    if (!slotDefs?.length) {
        return committedSlots;
    }

    const scopedRawSlots = slotDefs.map((_, slotIndex) =>
        getNodeSlotFormValue(committedSlots, slotIndex, isVariadic(slotDefs, slotIndex))
    ) as Array<string | string[]>;
    const formSlots = Array.isArray(rawFormSlots) ? rawFormSlots : [];
    scopedRawSlots[index] = formSlots[index];
    return buildNodeSlotArray(slotDefs, scopedRawSlots, committedSlots);
};

export const buildScopedArgs = (
    committedArgs: Record<string, unknown> | undefined,
    arg: NodeArg,
    values: Pick<NodeInspectorFormValues, "args">
) => {
    const nextArgs = { ...(committedArgs ?? {}) };
    const parsedValue = parseArgSubmitValue(arg, values.args?.[arg.name]);
    if (parsedValue === undefined) {
        delete nextArgs[arg.name];
    } else {
        nextArgs[arg.name] = parsedValue;
    }
    return Object.keys(nextArgs).length > 0 ? nextArgs : undefined;
};

export const useNodeInspectorViewState = (form: FormInstance) => {
    const {
        document,
        selectedNode,
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
    const { document, nodeDefs, groupDefs, allFiles, importDecls, subtreeDecls } =
        useTreeInspectorState();

    const nodeDefMap = useMemo(() => createNodeDefMap(nodeDefs), [nodeDefs]);
    const variableUsageCount = useMemo(
        () => buildVariableUsageCount(document?.root ?? null, nodeDefMap),
        [document?.root, nodeDefMap]
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

export const getNodeSlotFormValue = (
    slots: string[] | undefined,
    index: number,
    variadic: boolean
) => {
    return variadic ? (slots?.slice(index) ?? []) : (slots?.[index] ?? "");
};

export const buildNodeSlotArray = (
    slotDefs: string[] | undefined,
    rawSlots: unknown,
    fallback: string[] | undefined
) => {
    if (!slotDefs?.length) {
        return fallback;
    }

    const slots = (Array.isArray(rawSlots) ? rawSlots : []) as Array<string | string[]>;
    const nextValue: string[] = [];

    slotDefs.forEach((_, index) => {
        const rawValue = slots[index];
        if (isVariadic(slotDefs, index)) {
            const entries = Array.isArray(rawValue) ? rawValue : [];
            nextValue.push(...entries.filter((entry): entry is string => typeof entry === "string"));
        } else {
            nextValue.push(typeof rawValue === "string" ? rawValue : "");
        }
    });

    return nextValue;
};

export const createNodeInspectorFormValues = (
    currentNodeDef: NodeDef | null,
    selectedNode: NonNullable<ReturnType<typeof useNodeInspectorState>["selectedNode"]>,
    unknownTypeLabel: string
) => {
    return {
        id: selectedNode.ref.displayId,
        type: currentNodeDef?.type ?? unknownTypeLabel,
        children: formatChildrenLabel(currentNodeDef),
        group: currentNodeDef?.group ?? [],
        name: selectedNode.data.name,
        desc: selectedNode.data.desc ?? currentNodeDef?.desc ?? "",
        path: selectedNode.data.path ?? "",
        debug: Boolean(selectedNode.data.debug),
        disabled: Boolean(selectedNode.data.disabled),
        args: Object.fromEntries(
            (currentNodeDef?.args ?? []).map((arg) => [
                arg.name,
                formatArgInitialValue(arg, selectedNode.data.args?.[arg.name]),
            ])
        ),
        inputSlots: (currentNodeDef?.input ?? []).map((_, index) =>
            getNodeSlotFormValue(
                selectedNode.data.input,
                index,
                Boolean(currentNodeDef?.input && isVariadic(currentNodeDef.input, index))
            )
        ),
        outputSlots: (currentNodeDef?.output ?? []).map((_, index) =>
            getNodeSlotFormValue(
                selectedNode.data.output,
                index,
                Boolean(currentNodeDef?.output && isVariadic(currentNodeDef.output, index))
            )
        ),
        rawNodeJson: JSON.stringify(selectedNode.data ?? {}, null, 2),
    };
};

export type NodeInspectorFormValues = ReturnType<typeof createNodeInspectorFormValues>;

export const createTreeInspectorFormValues = (
    document: TreeInspectorDocument,
    variableUsageCount: Record<string, number>
) => {
    return {
        name: document.name,
        desc: document.desc ?? "",
        prefix: document.prefix ?? "",
        export: document.export !== false,
        group: document.group,
        vars: document.variables.locals.map((variable) => ({
            ...variable,
            count: variableUsageCount[variable.name] ?? 0,
        })),
        importRefs: document.variables.imports.map((path) => ({ path })),
        customRows: Object.entries(document.custom).map(([key, value]) => ({
            key,
            value: stringifySearchValueAsJson5(value),
        })),
    };
};

export const createTreeMetaPayload = (values: TreeInspectorFormValues): UpdateTreeMetaInput => {
    return {
        desc: values.desc?.trim() || undefined,
        prefix: values.prefix ?? "",
        export: values.export !== false,
        group: values.group ?? [],
        variables: {
            imports: (values.importRefs ?? [])
                .map((entry) => entry.path?.trim())
                .filter((entry): entry is string => Boolean(entry)),
            locals: (values.vars ?? [])
                .filter((entry) => entry.name?.trim())
                .map((entry) => ({
                    name: entry.name.trim(),
                    desc: entry.desc.trim(),
                })),
        },
    };
};
