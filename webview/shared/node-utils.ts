import { type NodeArg, type NodeDef, hasArgOptions } from "./b3type";

export type ParsedSlotDefinition = {
    raw: string;
    label: string;
    required: boolean;
    variadic: boolean;
};

export const createNodeDefMap = (nodeDefs: readonly NodeDef[]): Map<string, NodeDef> =>
    new Map(nodeDefs.map((nodeDef) => [nodeDef.name, nodeDef] as const));

export const deriveGroupDefs = (nodeDefs: readonly NodeDef[]): string[] => {
    const groups = new Set<string>();
    for (const nodeDef of nodeDefs) {
        for (const group of nodeDef.group ?? []) {
            groups.add(group);
        }
    }
    return Array.from(groups).sort();
};

export const findNodeDef = (
    nodeDefMap: ReadonlyMap<string, NodeDef>,
    nodeName: string | null | undefined
): NodeDef | null => {
    if (!nodeName) {
        return null;
    }
    return nodeDefMap.get(nodeName) ?? null;
};

const cleanSlotLabel = (value: string) => value.replace(/\.\.\.$/, "").replace(/\?/g, "");

export const parseSlotDefinition = (
    slot: string,
    slotDefs?: readonly string[] | null,
    index?: number
): ParsedSlotDefinition => {
    const raw = slot ?? "";
    const hasOptionalMarker = raw.includes("?");
    const hasVariadicMarker = raw.endsWith("...");
    const variadic =
        hasVariadicMarker &&
        (slotDefs && index !== undefined ? index === slotDefs.length - 1 : true);

    return {
        raw,
        label: cleanSlotLabel(raw),
        required: !hasOptionalMarker,
        variadic,
    };
};

export const getNodeArgRawType = (arg: NodeArg) => {
    return arg.type.match(/^\w+/)![0] as NodeArg["type"];
};

export const isNodeArgArray = (arg: NodeArg) => {
    return arg.type.includes("[]");
};

export const isNodeArgOptional = (arg: NodeArg) => {
    return arg.type.includes("?");
};

type ArgOptionBucket = {
    match?: Record<string, string[]>;
    source: Array<{ name: string; value: unknown }>;
};

const getArgOptionBuckets = (arg: NodeArg): ArgOptionBucket[] | undefined => {
    const options = arg.options;
    if (!Array.isArray(options)) {
        return undefined;
    }
    return options as ArgOptionBucket[];
};

export const getNodeArgOptions = (arg: NodeArg, args: Record<string, unknown>) => {
    if (!hasArgOptions(arg)) {
        return undefined;
    }

    const options = getArgOptionBuckets(arg);
    if (!options?.length) {
        return undefined;
    }

    const defaultMatch = options.find((option) => !option.match);
    if (defaultMatch) {
        return defaultMatch.source;
    }

    return options.find((entry) =>
        Object.entries(entry.match!).every(([key, value]) => {
            const expectedValues = value as unknown[];
            const actualValue = args[key];
            return Array.isArray(expectedValues) && expectedValues.includes(actualValue);
        })
    )?.source;
};

export const checkOneof = (arg: NodeArg, argValue: unknown, inputValue: unknown) => {
    let normalizedArgValue = argValue;
    if (
        isNodeArgArray(arg) &&
        Array.isArray(normalizedArgValue) &&
        normalizedArgValue.length === 0
    ) {
        normalizedArgValue = undefined;
    }
    normalizedArgValue = normalizedArgValue === undefined ? "" : normalizedArgValue;
    const normalizedInputValue = inputValue ?? "";
    return (
        (normalizedArgValue !== "" && normalizedInputValue === "") ||
        (normalizedArgValue === "" && normalizedInputValue !== "")
    );
};
