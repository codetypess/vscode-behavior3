import type { NodeArg, NodeDef } from "./b3type";
import type { PersistedNodeModel } from "./contracts";
import { isJsonEqual } from "./json";

type NodeOverrideFields = Pick<
    PersistedNodeModel,
    "desc" | "input" | "output" | "args" | "debug" | "disabled"
>;

type NodeArgDefaults = Pick<NodeArg, "name" | "default">;

const hasOwn = (value: object, key: string): boolean =>
    Object.prototype.hasOwnProperty.call(value, key);

export const getNodeArgOverrideCompareValue = (
    args: Record<string, unknown> | undefined,
    arg: NodeArgDefaults
): unknown => {
    if (args && hasOwn(args, arg.name)) {
        return args[arg.name];
    }
    return arg.default;
};

const getArgDef = (
    nodeDef: Pick<NodeDef, "args"> | null | undefined,
    argName: string
): NodeArgDefaults | null => nodeDef?.args?.find((arg) => arg.name === argName) ?? null;

export const isNodeArgOverrideValueDifferent = (params: {
    argName: string;
    currentArgs: Record<string, unknown> | undefined;
    originalArgs: Record<string, unknown> | undefined;
    nodeDef: Pick<NodeDef, "args"> | null | undefined;
}): boolean => {
    const arg = getArgDef(params.nodeDef, params.argName);
    const currentValue = arg
        ? getNodeArgOverrideCompareValue(params.currentArgs, arg)
        : params.currentArgs?.[params.argName];
    const originalValue = arg
        ? getNodeArgOverrideCompareValue(params.originalArgs, arg)
        : params.originalArgs?.[params.argName];

    return !isJsonEqual(currentValue, originalValue);
};

export const collectNodeArgOverrideNames = (
    currentArgs: Record<string, unknown> | undefined,
    originalArgs: Record<string, unknown> | undefined,
    nodeDef: Pick<NodeDef, "args"> | null | undefined
): string[] => {
    const names = new Set<string>();
    Object.keys(currentArgs ?? {}).forEach((name) => names.add(name));
    Object.keys(originalArgs ?? {}).forEach((name) => names.add(name));
    nodeDef?.args?.forEach((arg) => names.add(arg.name));
    return [...names];
};

export const hasNodeOverrideDiff = (
    current: NodeOverrideFields,
    original: NodeOverrideFields,
    nodeDef: Pick<NodeDef, "args"> | null | undefined
): boolean => {
    if (
        (current.desc ?? "") !== (original.desc ?? "") ||
        !isJsonEqual(current.input ?? [], original.input ?? []) ||
        !isJsonEqual(current.output ?? [], original.output ?? []) ||
        Boolean(current.debug) !== Boolean(original.debug) ||
        Boolean(current.disabled) !== Boolean(original.disabled)
    ) {
        return true;
    }

    return collectNodeArgOverrideNames(current.args, original.args, nodeDef).some((argName) =>
        isNodeArgOverrideValueDifferent({
            argName,
            currentArgs: current.args,
            originalArgs: original.args,
            nodeDef,
        })
    );
};
