import { stringifySearchValueAsJson5 } from "../../shared/json5-display";
import type { EditNode, UpdateNodeInput, UpdateTreeMetaInput } from "../../shared/contracts";
import type { NodeArg, NodeDef } from "../../shared/misc/b3type";
import { isVariadic } from "../../shared/misc/b3util";
import { formatArgInitialValue, parseArgSubmitValue } from "./inspector-arg-values";
import { type VariableRowValue } from "./inspector-variable-options";
import { formatChildrenLabel } from "./inspector-validation";
import { type TreeCustomRowValue } from "./tree-custom-metadata";

export {
    buildTreeCustomRecord,
    getTreeCustomValueKind,
    parseTreeCustomValue,
    type TreeCustomRowValue,
    type TreeCustomValue,
    type TreeCustomValueKind,
} from "./tree-custom-metadata";

type ImportRefFormValue = {
    path?: string;
    vars?: VariableRowValue[];
};

type TreeInspectorDocument = {
    name: string;
    desc?: string;
    prefix: string;
    export?: boolean;
    group: string[];
    variables: {
        imports: string[];
        locals: VariableRowValue[];
    };
    custom: Record<string, unknown>;
};

export type NodeInspectorFormValues = {
    id: string;
    type: string;
    children: string;
    group: string[];
    name: string;
    desc: string;
    path: string;
    debug: boolean;
    disabled: boolean;
    args: Record<string, unknown>;
    inputSlots: Array<string | string[]>;
    outputSlots: Array<string | string[]>;
    rawNodeJson: string;
};

export type TreeInspectorFormValues = {
    desc?: string;
    prefix?: string;
    export?: boolean;
    group?: string[];
    vars?: VariableRowValue[];
    importRefs?: ImportRefFormValue[];
    customRows?: TreeCustomRowValue[];
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
    selectedNode: EditNode,
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
