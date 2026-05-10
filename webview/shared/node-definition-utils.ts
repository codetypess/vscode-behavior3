import type { NodeDef } from "./b3type";

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
