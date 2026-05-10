import type { NodeDef } from "./misc/b3type";

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
