import JSON5 from "json5";
import type { CustomFieldDef } from "../../shared/b3type";
import { isCustomFieldValue, resolveCustomFieldDefault } from "../../shared/custom-fields";
import { stringifySearchValueAsJson5 } from "../../shared/json";

export type TreeCustomRowValue = {
    key?: string;
    value?: string;
    /** A required declared field missing from the file; shown with its default until a commit writes it. */
    pending?: boolean;
};

export type TreeCustomValue = string | number | boolean;
export type TreeCustomValueKind = "string" | "number" | "boolean" | "invalid";

const TREE_CUSTOM_LITERAL_START_PATTERN = /^[\[{'"0-9+\-.]/;
const TREE_CUSTOM_NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

const isQuotedTreeCustomString = (value: string) =>
    value.startsWith('"') || value.startsWith("'");

export const parseTreeCustomValue = (rawValue: string | undefined): TreeCustomValue => {
    const value = rawValue ?? "";
    const trimmed = value.trim();

    if (!trimmed) {
        return "";
    }

    if (trimmed === "true") {
        return true;
    }

    if (trimmed === "false") {
        return false;
    }

    if (TREE_CUSTOM_NUMBER_PATTERN.test(trimmed)) {
        const parsed = Number(trimmed);
        if (!Number.isFinite(parsed)) {
            throw new Error("invalid tree custom value");
        }
        return parsed;
    }

    if (isQuotedTreeCustomString(trimmed)) {
        let parsed: unknown;
        try {
            parsed = JSON5.parse(trimmed);
        } catch {
            throw new Error("invalid tree custom value");
        }
        if (typeof parsed !== "string") {
            throw new Error("invalid tree custom value");
        }
        return parsed;
    }

    if (
        trimmed.startsWith("{") ||
        trimmed.startsWith("[") ||
        TREE_CUSTOM_LITERAL_START_PATTERN.test(trimmed)
    ) {
        throw new Error("invalid tree custom value");
    }

    return value;
};

export const getTreeCustomValueKind = (
    rawValue: string | undefined
): TreeCustomValueKind => {
    try {
        const value = parseTreeCustomValue(rawValue);
        if (typeof value === "boolean") {
            return "boolean";
        }
        if (typeof value === "number") {
            return "number";
        }
        return "string";
    } catch {
        return "invalid";
    }
};

export class CustomFieldValueError extends Error {
    constructor(readonly reason: "type" | "option") {
        super(`invalid custom field value: ${reason}`);
    }
}

/** Parse a row value by the declared field's type instead of guessing from the text. */
export const parseCustomFieldInput = (
    def: CustomFieldDef,
    rawValue: string | undefined
): TreeCustomValue => {
    const raw = rawValue ?? "";
    const trimmed = raw.trim();
    let value: TreeCustomValue;
    switch (def.type) {
        case "string":
            value = raw;
            break;
        case "bool":
            if (trimmed !== "true" && trimmed !== "false") {
                throw new CustomFieldValueError("type");
            }
            value = trimmed === "true";
            break;
        default:
            if (!TREE_CUSTOM_NUMBER_PATTERN.test(trimmed)) {
                throw new CustomFieldValueError("type");
            }
            value = Number(trimmed);
    }
    if (!isCustomFieldValue({ ...def, options: undefined }, value)) {
        throw new CustomFieldValueError("type");
    }
    if (!isCustomFieldValue(def, value)) {
        throw new CustomFieldValueError("option");
    }
    return value;
};

export const formatCustomRowValue = (value: unknown): string => stringifySearchValueAsJson5(value);

/** Rows for a `custom` record, plus placeholder rows for missing required fields. */
export const createCustomRows = (
    custom: Record<string, unknown> | undefined,
    fields: CustomFieldDef[] = [],
    hostNodeId?: string
): TreeCustomRowValue[] => {
    const rows: TreeCustomRowValue[] = Object.entries(custom ?? {}).map(([key, value]) => ({
        key,
        value: formatCustomRowValue(value),
    }));
    for (const def of fields) {
        const defaultValue = resolveCustomFieldDefault(def, hostNodeId);
        if (def.required && defaultValue !== undefined && !(def.key in (custom ?? {}))) {
            rows.push({ key: def.key, value: formatCustomRowValue(defaultValue), pending: true });
        }
    }
    return rows;
};

export const buildTreeCustomRecord = (
    rows: TreeCustomRowValue[] | undefined,
    fields: CustomFieldDef[] = []
): Record<string, TreeCustomValue> => {
    const custom: Record<string, TreeCustomValue> = {};

    for (const row of rows ?? []) {
        const key = row.key?.trim();
        if (!key) {
            continue;
        }
        const def = fields.find((entry) => entry.key === key);
        custom[key] = def ? parseCustomFieldInput(def, row.value) : parseTreeCustomValue(row.value);
    }

    return custom;
};
