import {
    hasArgOptions,
    isBoolType,
    isFloatType,
    isIntType,
    isJsonType,
    type NodeArg,
} from "../../shared/misc/b3type";
import { getNodeArgRawType, isNodeArgArray, isNodeArgOptional } from "../../shared/misc/b3util";
import i18n from "../../shared/misc/i18n";

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

    if (hasArgOptions(arg)) {
        return value ?? (optional ? "__unset__" : undefined);
    }

    if (isBoolType(type)) {
        if (value === undefined) {
            return optional ? "__unset__" : undefined;
        }
        return value;
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

    if (hasArgOptions(arg)) {
        return raw === "__unset__" ? undefined : raw;
    }

    if (isBoolType(type)) {
        if (raw === "__unset__") {
            return undefined;
        }
        return Boolean(raw);
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
