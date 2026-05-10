import { resolveDocumentGraph } from "../../domain/resolve-graph";
import type {
    PersistedTreeModel,
    ResolvedDocumentGraph,
    SubtreeSourceCacheEntry,
    WorkdirRelativeJsonPath,
} from "../../shared/contracts";
import { findNodeDef } from "../../shared/node-definition-utils";
import { parseSlotDefinition } from "../../shared/slot-definition-utils";
import { dfs, getNodeArgRawType } from "../../shared/misc/b3util";
import {
    hasDeclaredVars as hasSharedDeclaredVars,
    parseExpressionVariables,
} from "../../shared/validation";
import { isExprType, type NodeDef, type VarDecl } from "../../shared/misc/b3type";

export type VariableOption = {
    label: string;
    value: string;
};

export type VariableRowValue = VarDecl & {
    count?: number;
};

type VariableUsageNode = {
    name: string;
    args?: Record<string, unknown>;
    input?: string[];
    output?: string[];
    children?: VariableUsageNode[];
};

type VariableUsageEntry = Pick<VariableUsageNode, "name" | "args" | "input" | "output">;

const addVariableUsageCount = (
    count: Record<string, number>,
    node: VariableUsageEntry,
    nodeDefMap: ReadonlyMap<string, NodeDef>
) => {
    const nodeDef = findNodeDef(nodeDefMap, node.name);
    if (!nodeDef) {
        return;
    }

    node.input?.forEach((variable) => {
        if (!variable) {
            return;
        }
        count[variable] = (count[variable] ?? 0) + 1;
    });

    node.output?.forEach((variable) => {
        if (!variable) {
            return;
        }
        count[variable] = (count[variable] ?? 0) + 1;
    });

    nodeDef.args?.forEach((arg) => {
        if (!isExprType(getNodeArgRawType(arg))) {
            return;
        }
        const rawValue = node.args?.[arg.name];
        const entries = Array.isArray(rawValue) ? rawValue : [rawValue];
        entries.forEach((entry) => {
            if (typeof entry !== "string" || !entry) {
                return;
            }
            parseExpressionVariables(entry).forEach((variable) => {
                count[variable] = (count[variable] ?? 0) + 1;
            });
        });
    });
};

export const buildVariableUsageCountFromGraph = (
    graph: ResolvedDocumentGraph | null,
    nodeDefMap: ReadonlyMap<string, NodeDef>
) => {
    const count: Record<string, number> = {};

    if (!graph) {
        return count;
    }

    for (const key of graph.nodeOrder) {
        const node = graph.nodesByInstanceKey[key];
        if (!node) {
            continue;
        }
        addVariableUsageCount(count, node, nodeDefMap);
    }

    return count;
};

export const buildTreeInspectorVariableUsageCount = (params: {
    document: PersistedTreeModel | null;
    subtreeSources: Record<WorkdirRelativeJsonPath, SubtreeSourceCacheEntry>;
    nodeDefs: NodeDef[];
    nodeDefMap: ReadonlyMap<string, NodeDef>;
    subtreeEditable: boolean;
}) => {
    if (!params.document) {
        return {};
    }

    // Tree Inspector counts should match the currently materialized graph, including subtree instances.
    const graph = resolveDocumentGraph({
        persistedTree: params.document,
        subtreeSources: params.subtreeSources,
        nodeDefs: params.nodeDefs,
        subtreeEditable: params.subtreeEditable,
    }).graph;

    return buildVariableUsageCountFromGraph(graph, params.nodeDefMap);
};

export const createVariableOptions = (
    usingVars: Record<string, VarDecl> | null,
    root: VariableUsageNode | null,
    nodeDefMap: ReadonlyMap<string, NodeDef>
): VariableOption[] => {
    const options: VariableOption[] = [];
    const seen = new Set<string>();

    if (hasSharedDeclaredVars(usingVars)) {
        Object.values(usingVars).forEach((variable) => {
            if (seen.has(variable.name)) {
                return;
            }
            seen.add(variable.name);
            options.push({
                label: `${variable.name} (${variable.desc})`,
                value: variable.name,
            });
        });
        return options;
    }

    if (!root) {
        return options;
    }

    dfs(root, (node) => {
        const nodeDef = findNodeDef(nodeDefMap, node.name);
        const lastInputSlot =
            nodeDef?.input?.length && nodeDef.input.length > 0
                ? parseSlotDefinition(
                      nodeDef.input[nodeDef.input.length - 1] ?? "",
                      nodeDef.input,
                      nodeDef.input.length - 1
                  )
                : null;
        const lastOutputSlot =
            nodeDef?.output?.length && nodeDef.output.length > 0
                ? parseSlotDefinition(
                      nodeDef.output[nodeDef.output.length - 1] ?? "",
                      nodeDef.output,
                      nodeDef.output.length - 1
                  )
                : null;

        node.input?.forEach((variable, index) => {
            if (!variable || seen.has(variable)) {
                return;
            }
            const rawLabel =
                nodeDef?.input?.length && index >= nodeDef.input.length && lastInputSlot?.variadic
                    ? nodeDef.input[nodeDef.input.length - 1]
                    : (nodeDef?.input?.[index] ?? "input");
            seen.add(variable);
            options.push({
                label: `${variable} (${parseSlotDefinition(rawLabel).label})`,
                value: variable,
            });
        });

        node.output?.forEach((variable, index) => {
            if (!variable || seen.has(variable)) {
                return;
            }
            const rawLabel =
                nodeDef?.output?.length &&
                index >= nodeDef.output.length &&
                lastOutputSlot?.variadic
                    ? nodeDef.output[nodeDef.output.length - 1]
                    : (nodeDef?.output?.[index] ?? "output");
            seen.add(variable);
            options.push({
                label: `${variable} (${parseSlotDefinition(rawLabel).label})`,
                value: variable,
            });
        });
    });

    return options;
};
