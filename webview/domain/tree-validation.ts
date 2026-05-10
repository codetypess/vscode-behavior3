import {
    isBoolType,
    isExprType,
    type NodeArg,
    type NodeDef,
    type VarDecl,
} from "../shared/misc/b3type";
import type { ResolvedNodeModel } from "../shared/contracts";
import { parseSlotDefinition } from "../shared/slot-definition-utils";
import {
    validateExpressionEntries,
    validateVariableReference,
    type TreeValidationDiagnostic,
} from "../shared/validation";

export {
    hasDeclaredVars,
    isValidVariableName,
    parseExpressionVariables,
    validateExpressionEntries,
    validateVariableReference,
    type TreeValidationDiagnostic,
} from "../shared/validation";

const isRequiredSlotMissing = (
    slots: string[] | undefined,
    values: string[] | undefined,
    index: number
): boolean => {
    const slotDefinition = parseSlotDefinition(slots?.[index] ?? "", slots, index);
    return !slotDefinition.variadic && slotDefinition.required && !(values?.[index] ?? "");
};

export const isRequiredNodeArgValueMissing = (arg: NodeArg, value: unknown): boolean => {
    if (arg.type.includes("?")) {
        return false;
    }

    if (isBoolType(arg.type)) {
        return value === undefined || value === null || value === "__unset__";
    }

    if (arg.type.includes("[]")) {
        return !Array.isArray(value) || value.length === 0;
    }

    if (value === undefined || value === null) {
        return true;
    }

    if (typeof value === "string") {
        return value.trim().length === 0;
    }

    return false;
};

export const collectResolvedNodeDiagnostics = (params: {
    node: ResolvedNodeModel;
    def: NodeDef | null | undefined;
    usingVars: Record<string, VarDecl> | null;
    usingGroups: Record<string, boolean> | null;
    checkExpr: boolean;
}): TreeValidationDiagnostic[] => {
    const { node, def, usingVars, usingGroups, checkExpr } = params;
    const diagnostics: TreeValidationDiagnostic[] = [];

    if (node.resolutionError) {
        return diagnostics;
    }

    if (!def) {
        diagnostics.push({ code: "missing-node-def", nodeName: node.name });
        return diagnostics;
    }

    if (def.group) {
        const groups = Array.isArray(def.group) ? def.group : [def.group];
        if (!groups.some((group) => usingGroups?.[group])) {
            diagnostics.push({ code: "group-not-enabled", nodeName: node.name, groups });
        }
    }

    for (const value of node.input ?? []) {
        const diagnostic = validateVariableReference(value, usingVars, "input");
        if (diagnostic) {
            diagnostics.push(diagnostic);
        }
    }

    for (const value of node.output ?? []) {
        const diagnostic = validateVariableReference(value, usingVars, "output");
        if (diagnostic) {
            diagnostics.push(diagnostic);
        }
    }

    for (const arg of def.args ?? []) {
        const rawValue = node.args?.[arg.name];
        if (isRequiredNodeArgValueMissing(arg, rawValue)) {
            diagnostics.push({
                code: "required-arg",
                argName: arg.name,
                label: arg.desc || arg.name,
            });
            continue;
        }
        if (!isExprType(arg.type) || !rawValue) {
            continue;
        }
        const exprValues = (Array.isArray(rawValue) ? rawValue : [rawValue]).filter(
            (entry): entry is string => typeof entry === "string"
        );
        const diagnostic = validateExpressionEntries(exprValues, usingVars, checkExpr);
        if (diagnostic) {
            diagnostics.push(diagnostic);
        }
    }

    for (let index = 0; index < (def.input?.length ?? 0); index += 1) {
        const slotDefinition = parseSlotDefinition(def.input?.[index] ?? "", def.input, index);
        if (slotDefinition.variadic) {
            // Once a variadic slot starts, the remaining arity is intentionally open-ended.
            break;
        }
        if (isRequiredSlotMissing(def.input, node.input, index)) {
            diagnostics.push({
                code: "required-input",
                index,
                label: slotDefinition.label,
            });
        }
    }

    for (let index = 0; index < (def.output?.length ?? 0); index += 1) {
        const slotDefinition = parseSlotDefinition(def.output?.[index] ?? "", def.output, index);
        if (slotDefinition.variadic) {
            // Variadic output slots follow the same required-slot cutoff as inputs.
            break;
        }
        if (isRequiredSlotMissing(def.output, node.output, index)) {
            diagnostics.push({
                code: "required-output",
                index,
                label: slotDefinition.label,
            });
        }
    }

    return diagnostics;
};
