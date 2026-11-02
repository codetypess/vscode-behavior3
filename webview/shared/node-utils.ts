import { type NodeArg, type NodeDef, hasArgOptions } from "./b3type";

export type NodeSlotDef =
    | Exclude<Exclude<NodeDef["input"], undefined>[number], undefined>
    | Exclude<Exclude<NodeDef["output"], undefined>[number], undefined>;

export type StructuredNodeSlotDef = Exclude<NodeSlotDef, string>;

export type ParsedSlotDefinition = {
    raw: string;
    name: string;
    label: string;
    required: boolean;
    variadic: boolean;
    checker?: string;
    visible?: string;
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

/** behavior3 registers its builtin nodes in this group regardless of the tree's groups. */
export const CORE_NODE_GROUP = "Core";

/**
 * A node is usable when it declares no group, when the tree enables one of its groups,
 * or, outside strict group mode, when it is a `Core` node.
 */
export const isNodeGroupEnabled = (
    groups: string | readonly string[] | undefined,
    usingGroups: Record<string, boolean> | null,
    strictGroup: boolean
): boolean => {
    const list = groups === undefined ? [] : typeof groups === "string" ? [groups] : groups;
    if (list.length === 0 || list.some((group) => usingGroups?.[group])) {
        return true;
    }
    return !strictGroup && list.includes(CORE_NODE_GROUP);
};

/** Strict group mode makes a tree pick its groups first, as long as the node config has any. */
export const isTreeGroupMissing = (
    treeGroups: readonly string[],
    groupDefs: readonly string[],
    strictGroup: boolean
): boolean => strictGroup && groupDefs.length > 0 && treeGroups.length === 0;

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

export const isStructuredSlotDefinition = (
    slot: NodeSlotDef | null | undefined
): slot is StructuredNodeSlotDef =>
    Boolean(slot && typeof slot === "object" && !Array.isArray(slot));

export const parseSlotDefinition = (
    slot: NodeSlotDef | "",
    slotDefs?: readonly NodeSlotDef[] | null,
    index?: number
): ParsedSlotDefinition => {
    const raw = typeof slot === "string" ? slot : (slot?.name ?? "");
    const hasOptionalMarker = raw.includes("?");
    const hasVariadicMarker = raw.endsWith("...");
    const variadic =
        hasVariadicMarker &&
        (slotDefs && index !== undefined ? index === slotDefs.length - 1 : true);
    const checker = isStructuredSlotDefinition(slot)
        ? slot.checker?.trim() || undefined
        : undefined;
    const visible = isStructuredSlotDefinition(slot)
        ? slot.visible?.trim() || undefined
        : undefined;

    return {
        raw,
        name: cleanSlotLabel(raw),
        label: cleanSlotLabel(raw),
        required: !hasOptionalMarker,
        variadic,
        checker,
        visible,
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
