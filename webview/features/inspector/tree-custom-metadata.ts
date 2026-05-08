import JSON5 from "json5";

export type TreeCustomRowValue = {
    key?: string;
    value?: string;
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

export const buildTreeCustomRecord = (
    rows: TreeCustomRowValue[] | undefined
): Record<string, TreeCustomValue> => {
    const custom: Record<string, TreeCustomValue> = {};

    for (const row of rows ?? []) {
        const key = row.key?.trim();
        if (!key) {
            continue;
        }
        custom[key] = parseTreeCustomValue(row.value);
    }

    return custom;
};
