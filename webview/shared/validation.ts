import { ExpressionEvaluator } from "behavior3";
import { keyWords, type VarDecl } from "./misc/b3type";

export type TreeValidationDiagnostic =
    | { code: "missing-node-def"; nodeName: string }
    | { code: "group-not-enabled"; nodeName: string; groups: string[] }
    | { code: "invalid-variable-name"; field: "input" | "output"; variable: string }
    | { code: "undefined-variable"; field: "input" | "output" | "args"; variable: string }
    | { code: "invalid-expression"; field: "args"; expression: string }
    | { code: "required-arg"; argName: string; label: string }
    | { code: "required-input"; index: number; label: string }
    | { code: "required-output"; index: number; label: string }
    | { code: "custom-arg-check"; argName: string; checker: string; message: string }
    | { code: "invalid-children"; expected: number; actual: number };

export const hasDeclaredVars = (
    vars: Record<string, VarDecl> | null | undefined
): vars is Record<string, VarDecl> => {
    return Boolean(vars && Object.keys(vars).length > 0);
};

export const isValidVariableName = (name: string): boolean => {
    return /^[a-zA-Z_$][a-zA-Z_$0-9]*$/.test(name) && !keyWords.includes(name);
};

export const parseExpressionVariables = (expr: string): string[] => {
    return expr
        .split(/[^a-zA-Z0-9_.'"]/)
        .map((value) => value.split(".")[0])
        .filter((value) => isValidVariableName(value));
};

export const validateVariableReference = (
    value: string | undefined,
    usingVars: Record<string, VarDecl> | null,
    field: "input" | "output"
): TreeValidationDiagnostic | null => {
    if (!value) {
        return null;
    }
    if (!isValidVariableName(value)) {
        return { code: "invalid-variable-name", field, variable: value };
    }
    const declaredVars = hasDeclaredVars(usingVars) ? usingVars : null;
    if (declaredVars && !declaredVars[value]) {
        return { code: "undefined-variable", field, variable: value };
    }
    return null;
};

export const validateExpressionEntries = (
    entries: string[],
    usingVars: Record<string, VarDecl> | null,
    checkExpr: boolean
): TreeValidationDiagnostic | null => {
    const declaredVars = hasDeclaredVars(usingVars) ? usingVars : null;

    for (const entry of entries) {
        if (!entry) {
            continue;
        }

        for (const variable of parseExpressionVariables(entry)) {
            if (declaredVars && !declaredVars[variable]) {
                return { code: "undefined-variable", field: "args", variable };
            }
        }

        if (checkExpr) {
            try {
                if (!new ExpressionEvaluator(entry).dryRun()) {
                    return { code: "invalid-expression", field: "args", expression: entry };
                }
            } catch {
                return { code: "invalid-expression", field: "args", expression: entry };
            }
        }
    }

    return null;
};
