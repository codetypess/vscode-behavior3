import { dfs, getNodeArgRawType, isVariadic } from "../../shared/misc/b3util";
import { hasDeclaredVars as hasSharedDeclaredVars, parseExpressionVariables } from "../../shared/validation";
import { isExprType, type NodeDef, type VarDecl } from "../../shared/misc/b3type";
import { cleanSlotLabel } from "./inspector-validation";

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

export const createNodeDefMap = (nodeDefs: NodeDef[]) => {
    const map = new Map<string, NodeDef>();
    for (const nodeDef of nodeDefs) {
        map.set(nodeDef.name, nodeDef);
    }
    return map;
};

export const buildVariableUsageCount = (
    root: VariableUsageNode | null,
    nodeDefMap: Map<string, NodeDef>
) => {
    const count: Record<string, number> = {};

    if (!root) {
        return count;
    }

    dfs(root, (node) => {
        const nodeDef = nodeDefMap.get(node.name);
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
    });

    return count;
};

export const createVariableOptions = (
    usingVars: Record<string, VarDecl> | null,
    root: VariableUsageNode | null,
    nodeDefMap: Map<string, NodeDef>
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
        const nodeDef = nodeDefMap.get(node.name);

        node.input?.forEach((variable, index) => {
            if (!variable || seen.has(variable)) {
                return;
            }
            const rawLabel =
                nodeDef?.input?.length &&
                index >= nodeDef.input.length &&
                isVariadic(nodeDef.input, -1)
                    ? nodeDef.input[nodeDef.input.length - 1]
                    : (nodeDef?.input?.[index] ?? "input");
            seen.add(variable);
            options.push({
                label: `${variable} (${cleanSlotLabel(rawLabel)})`,
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
                isVariadic(nodeDef.output, -1)
                    ? nodeDef.output[nodeDef.output.length - 1]
                    : (nodeDef?.output?.[index] ?? "output");
            seen.add(variable);
            options.push({
                label: `${variable} (${cleanSlotLabel(rawLabel)})`,
                value: variable,
            });
        });
    });

    return options;
};
