import {
    hasArgOptions,
    isBoolType,
    isExprType,
    isFloatType,
    isIntType,
    isJsonType,
    type NodeArg,
    type VarDecl,
} from "../../shared/b3type";
import { getNodeArgRawType, isNodeArgArray, isNodeArgOptional } from "../../shared/node-utils";
import i18n from "../../shared/i18n";
import { validateNodeArgValue } from "../../shared/validation";
import { formatValidationDiagnostic, validateExpressionValues } from "./inspector-validation";

export const formatArgInitialValue = (arg: NodeArg, value: unknown) => {
    const type = getNodeArgRawType(arg);
    const optional = isNodeArgOptional(arg);

    if (isNodeArgArray(arg)) {
        if (hasArgOptions(arg)) {
            if (Array.isArray(value)) {
                return value;
            }
            return value === undefined ? (optional ? [] : undefined) : [];
        }
        if (value === undefined) {
            return optional ? "" : undefined;
        }
        return JSON.stringify(value, null, 2);
    }

    if (isBoolType(type)) {
        if (value === undefined) {
            return optional ? false : undefined;
        }
        return value;
    }

    if (hasArgOptions(arg)) {
        return value ?? (optional ? "__unset__" : undefined);
    }

    if (isJsonType(type)) {
        if (value === undefined) {
            return optional ? "" : undefined;
        }
        return JSON.stringify(value, null, 2);
    }

    if (value === undefined) {
        return optional ? "" : undefined;
    }

    return value;
};

export const parseArgSubmitValue = (arg: NodeArg, raw: unknown): unknown => {
    const type = getNodeArgRawType(arg);

    if (raw === undefined || raw === null) {
        return undefined;
    }

    if (isNodeArgArray(arg)) {
        if (hasArgOptions(arg)) {
            const values = Array.isArray(raw) ? raw : [];
            return values.length === 0 && isNodeArgOptional(arg) ? undefined : values;
        }

        const text = String(raw).trim();
        if (!text) {
            return isNodeArgOptional(arg) ? undefined : [];
        }
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) {
            throw new Error(i18n.t("validation.jsonArray", { name: arg.name }));
        }
        return parsed;
    }

    if (isBoolType(type)) {
        if (raw === "__unset__") {
            return undefined;
        }
        return Boolean(raw);
    }

    if (hasArgOptions(arg)) {
        return raw === "__unset__" ? undefined : raw;
    }

    if (isIntType(type) || isFloatType(type)) {
        if (raw === "") {
            return isNodeArgOptional(arg) ? undefined : raw;
        }
        return Number(raw);
    }

    if (isJsonType(type)) {
        const text = String(raw).trim();
        if (!text) {
            return isNodeArgOptional(arg) ? undefined : {};
        }
        return JSON.parse(text);
    }

    const text = String(raw);
    if (!text.trim() && isNodeArgOptional(arg)) {
        return undefined;
    }
    return text;
};

export const validateInspectorArgValue = (params: {
    arg: NodeArg;
    rawValue: unknown;
    usingVars: Record<string, VarDecl> | null;
    checkExpr: boolean;
}): string | null => {
    const { arg, rawValue, usingVars, checkExpr } = params;
    const type = getNodeArgRawType(arg);
    const parsedValue = parseArgSubmitValue(arg, rawValue);

    if (parsedValue === undefined) {
        return null;
    }

    const argDiagnostics = validateNodeArgValue({
        arg,
        value: parsedValue,
        args: { [arg.name]: parsedValue },
        validateOptions: false,
    });
    if (argDiagnostics.length) {
        return formatValidationDiagnostic(argDiagnostics[0]);
    }

    if (isExprType(type)) {
        const exprValues = (Array.isArray(parsedValue) ? parsedValue : [parsedValue]).filter(
            (entry): entry is string => typeof entry === "string"
        );
        return validateExpressionValues(exprValues, usingVars, checkExpr);
    }

    return null;
};
