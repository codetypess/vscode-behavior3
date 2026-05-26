import { ExpressionEvaluator } from "behavior3";
import {
    hasArgOptions,
    isBoolType,
    isExprType,
    isFloatType,
    isIntType,
    isJsonType,
    isStringType,
    keyWords,
    type NodeArg,
    type NodeDef,
    type VarDecl,
} from "./b3type";
import {
    checkOneof,
    getNodeArgOptions,
    getNodeArgRawType,
    isNodeArgArray,
    isNodeArgOptional,
    parseSlotDefinition,
} from "./node-utils";

export type ValidatableNode = {
    name: string;
    input?: string[];
    output?: string[];
    args?: Record<string, unknown>;
    children?: Array<{ disabled?: boolean }>;
    resolutionError?: unknown;
};

export type NodeArgValueExpected =
    | "array"
    | "boolean"
    | "expr"
    | "integer"
    | "json"
    | "number"
    | "string";

export type TreeValidationDiagnostic =
    | { code: "missing-node-def"; nodeName: string }
    | { code: "group-not-enabled"; nodeName: string; groups: string[] }
    | { code: "invalid-variable-name"; field: "input" | "output"; variable: string }
    | { code: "undefined-variable"; field: "input" | "output" | "args"; variable: string }
    | { code: "invalid-expression"; field: "args"; expression: string }
    | { code: "required-arg"; argName: string; label: string }
    | { code: "required-input"; index: number; label: string }
    | { code: "required-output"; index: number; label: string }
    | { code: "missing-oneof-input"; argName: string; inputLabel: string }
    | { code: "oneof-conflict"; argName: string; inputLabel: string }
    | {
          code: "invalid-arg-value";
          argName: string;
          label: string;
          expected: NodeArgValueExpected;
          value: unknown;
      }
    | { code: "invalid-arg-option"; argName: string; label: string; value: unknown }
    | { code: "unknown-arg-type"; argName: string; label: string; type: string }
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
        // Split on operators/punctuation, then keep the base identifier from property access.
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
            // Dry-run catches syntax/runtime shape errors without evaluating real tree state.
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

const getArgLabel = (arg: NodeArg): string => arg.desc || arg.name;

const findNodeArgOneofInputIndex = (
    arg: NodeArg,
    inputDefs: readonly string[] | null | undefined
): number => {
    if (!arg.oneof || !inputDefs?.length) {
        return -1;
    }

    return inputDefs.findIndex(
        (input, index) => parseSlotDefinition(input, inputDefs, index).label === arg.oneof
    );
};

export const isRequiredSlotMissing = (
    slots: string[] | undefined,
    values: string[] | undefined,
    index: number
): boolean => {
    const slotDefinition = parseSlotDefinition(slots?.[index] ?? "", slots, index);
    return !slotDefinition.variadic && slotDefinition.required && !(values?.[index] ?? "");
};

export const isRequiredNodeArgValueMissing = (arg: NodeArg, value: unknown): boolean => {
    if (isNodeArgOptional(arg)) {
        return false;
    }

    if (isBoolType(arg.type)) {
        return value === undefined || value === null || value === "__unset__";
    }

    if (isNodeArgArray(arg)) {
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

const buildInvalidArgValueDiagnostic = (
    arg: NodeArg,
    expected: NodeArgValueExpected,
    value: unknown
): TreeValidationDiagnostic => ({
    code: "invalid-arg-value",
    argName: arg.name,
    label: getArgLabel(arg),
    expected,
    value,
});

const buildUnknownArgTypeDiagnostic = (arg: NodeArg): TreeValidationDiagnostic => ({
    code: "unknown-arg-type",
    argName: arg.name,
    label: getArgLabel(arg),
    type: arg.type,
});

const buildInvalidArgOptionDiagnostic = (
    arg: NodeArg,
    value: unknown
): TreeValidationDiagnostic => ({
    code: "invalid-arg-option",
    argName: arg.name,
    label: getArgLabel(arg),
    value,
});

const isOptionalUnsetValue = (arg: NodeArg, value: unknown): boolean => {
    if (!isNodeArgOptional(arg)) {
        return false;
    }
    if (value === undefined) {
        return true;
    }
    const type = getNodeArgRawType(arg);
    return value === "" && (isStringType(type) || isExprType(type) || isJsonType(type));
};

const validateNodeArgScalarValue = (
    arg: NodeArg,
    value: unknown,
    args: Record<string, unknown>,
    validateOptions: boolean
): TreeValidationDiagnostic[] => {
    if (isOptionalUnsetValue(arg, value)) {
        return [];
    }

    const diagnostics: TreeValidationDiagnostic[] = [];
    const type = getNodeArgRawType(arg);

    if (isFloatType(type)) {
        if (!(typeof value === "number" && Number.isFinite(value))) {
            diagnostics.push(buildInvalidArgValueDiagnostic(arg, "number", value));
        }
    } else if (isIntType(type)) {
        if (!Number.isInteger(value)) {
            diagnostics.push(buildInvalidArgValueDiagnostic(arg, "integer", value));
        }
    } else if (isStringType(type)) {
        if (typeof value !== "string") {
            diagnostics.push(buildInvalidArgValueDiagnostic(arg, "string", value));
        }
    } else if (isExprType(type)) {
        if (typeof value !== "string") {
            diagnostics.push(buildInvalidArgValueDiagnostic(arg, "expr", value));
        }
    } else if (isJsonType(type)) {
        if (value === undefined || value === "") {
            diagnostics.push(buildInvalidArgValueDiagnostic(arg, "json", value));
        }
    } else if (isBoolType(type)) {
        if (typeof value !== "boolean") {
            diagnostics.push(buildInvalidArgValueDiagnostic(arg, "boolean", value));
        }
    } else {
        diagnostics.push(buildUnknownArgTypeDiagnostic(arg));
    }

    if (validateOptions && hasArgOptions(arg)) {
        const options = getNodeArgOptions(arg, args);
        const found = !!options?.find((option) => option.value === value);
        const optionalUnset = value === undefined && isNodeArgOptional(arg);
        if (!(found || optionalUnset)) {
            diagnostics.push(buildInvalidArgOptionDiagnostic(arg, value));
        }
    }

    return diagnostics;
};

export const validateNodeArgValue = (params: {
    arg: NodeArg;
    value: unknown;
    args?: Record<string, unknown>;
    validateOptions?: boolean;
}): TreeValidationDiagnostic[] => {
    const { arg, value, args = {}, validateOptions = true } = params;

    if (isRequiredNodeArgValueMissing(arg, value)) {
        return [
            {
                code: "required-arg",
                argName: arg.name,
                label: getArgLabel(arg),
            },
        ];
    }

    if (isNodeArgArray(arg)) {
        if (value === undefined || (Array.isArray(value) && value.length === 0)) {
            return [];
        }
        if (!Array.isArray(value)) {
            return [buildInvalidArgValueDiagnostic(arg, "array", value)];
        }
        return value.flatMap((entry) =>
            validateNodeArgScalarValue(arg, entry, args, validateOptions)
        );
    }

    return validateNodeArgScalarValue(arg, value, args, validateOptions);
};

export const validateNodeArgOneof = (params: {
    arg: NodeArg;
    argValue: unknown;
    inputValues?: string[];
    inputDefs?: readonly string[] | null;
}): TreeValidationDiagnostic | null => {
    const { arg, argValue, inputValues, inputDefs } = params;

    if (!arg.oneof) {
        return null;
    }

    const relatedInputIndex = findNodeArgOneofInputIndex(arg, inputDefs);
    if (relatedInputIndex < 0) {
        return {
            code: "missing-oneof-input",
            argName: arg.name,
            inputLabel: arg.oneof,
        };
    }

    if (checkOneof(arg, argValue, inputValues?.[relatedInputIndex])) {
        return null;
    }

    return {
        code: "oneof-conflict",
        argName: arg.name,
        inputLabel: arg.oneof,
    };
};

export const collectResolvedNodeDiagnostics = (params: {
    node: ValidatableNode;
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
        const requiredMissing = isRequiredNodeArgValueMissing(arg, rawValue);
        if (requiredMissing) {
            diagnostics.push({
                code: "required-arg",
                argName: arg.name,
                label: getArgLabel(arg),
            });
        }
        const oneofDiagnostic = validateNodeArgOneof({
            arg,
            argValue: rawValue,
            inputValues: node.input,
            inputDefs: def.input,
        });
        if (oneofDiagnostic) {
            diagnostics.push(oneofDiagnostic);
        }
        if (requiredMissing) {
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

    if (def.children !== undefined && def.children !== -1) {
        const actual = node.children?.filter((child) => !child.disabled).length ?? 0;
        if (actual !== def.children) {
            diagnostics.push({ code: "invalid-children", expected: def.children, actual });
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
