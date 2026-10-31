import type { CustomFieldDef, CustomFieldDefs, CustomFieldType, CustomFieldValue } from "./b3type";
import { treeUsesConditions } from "./condition-branch";

type CustomRecord = Record<string, string | number | boolean | object>;

const CUSTOM_FIELD_TYPES: readonly CustomFieldType[] = ["string", "int", "float", "bool"];

/** `default` token for condition fields: the host node id as a number. */
export const NODE_ID_DEFAULT = "$nodeId";

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

export const isCustomFieldTypeValue = (type: CustomFieldType, value: unknown): boolean => {
    switch (type) {
        case "string":
            return typeof value === "string";
        case "int":
            return typeof value === "number" && Number.isInteger(value);
        case "float":
            return typeof value === "number" && Number.isFinite(value);
        case "bool":
            return typeof value === "boolean";
    }
};

/** True when `value` has the field's type and, for an enum, is one of its options. */
export const isCustomFieldValue = (def: CustomFieldDef, value: unknown): boolean =>
    isCustomFieldTypeValue(def.type, value) &&
    (!def.options || def.options.some((option) => option.value === value));

const inferCustomFieldType = (value: unknown): CustomFieldType => {
    if (typeof value === "boolean") {
        return "bool";
    }
    if (typeof value === "number") {
        return Number.isInteger(value) ? "int" : "float";
    }
    return "string";
};

const hasCustomFieldDefault = (def: CustomFieldDef): boolean =>
    def.default !== undefined || def.defaultFrom !== undefined;

/** Non-integer node ids count as 0. */
const nodeIdToNumber = (id: string): number => {
    const value = /^-?\d+$/.test(id.trim()) ? Number(id) : 0;
    return Number.isSafeInteger(value) ? value : 0;
};

/**
 * The value written for a field's default. `undefined` when there is none, or when it
 * comes from the host node id and the host node is unknown here.
 */
export const resolveCustomFieldDefault = (
    def: CustomFieldDef,
    nodeId: string | undefined
): CustomFieldValue | undefined => {
    // Script fields get their value from `@behavior3.customField`; `default` is only its fallback.
    if (def.script) {
        return undefined;
    }
    if (def.defaultFrom === "nodeId") {
        return nodeId === undefined ? undefined : nodeIdToNumber(nodeId);
    }
    return def.default;
};

const normalizeCustomFieldDef = (
    value: unknown,
    label: string,
    scope: keyof CustomFieldDefs
): CustomFieldDef => {
    if (!isRecord(value)) {
        throw new Error(`${label} must be an object`);
    }
    if (typeof value.key !== "string" || !value.key.trim()) {
        throw new Error(`${label}.key must be a non-empty string`);
    }
    if (value.desc !== undefined && typeof value.desc !== "string") {
        throw new Error(`${label}.desc must be a string`);
    }
    if (value.type !== undefined && !CUSTOM_FIELD_TYPES.includes(value.type as CustomFieldType)) {
        throw new Error(`${label}.type must be one of ${CUSTOM_FIELD_TYPES.join(", ")}`);
    }
    const defaultFromNodeId = value.default === NODE_ID_DEFAULT;
    const type =
        (value.type as CustomFieldType | undefined) ??
        (defaultFromNodeId ? "int" : inferCustomFieldType(value.default));

    let options: CustomFieldDef["options"];
    if (value.options !== undefined) {
        if (!Array.isArray(value.options) || value.options.length === 0) {
            throw new Error(`${label}.options must be a non-empty array`);
        }
        options = value.options.map((option, index) => {
            const optionLabel = `${label}.options[${index}]`;
            if (!isRecord(option) || typeof option.name !== "string") {
                throw new Error(`${optionLabel} must be { name, value }`);
            }
            if (!isCustomFieldTypeValue(type, option.value)) {
                throw new Error(`${optionLabel}.value must be a ${type}`);
            }
            return { name: option.name, value: option.value as CustomFieldValue };
        });
    }

    const def: CustomFieldDef = {
        key: value.key.trim(),
        desc: value.desc || undefined,
        type,
        options,
        default: defaultFromNodeId ? undefined : (value.default as CustomFieldValue | undefined),
        ...(defaultFromNodeId ? { defaultFrom: "nodeId" as const } : {}),
        required: value.required === true,
        editable: value.editable !== false,
        when: "always",
    };
    if (def.default !== undefined && !isCustomFieldValue(def, def.default)) {
        throw new Error(
            options
                ? `${label}.default must be one of its options`
                : `${label}.default must be a ${type}`
        );
    }
    if (defaultFromNodeId) {
        if (scope !== "condition") {
            throw new Error(
                `${label}.default "${NODE_ID_DEFAULT}" is only supported for condition fields`
            );
        }
        if ((type !== "int" && type !== "float") || options) {
            throw new Error(
                `${label}.default "${NODE_ID_DEFAULT}" needs an int or float field without options`
            );
        }
    }
    if (value.script !== undefined) {
        if (typeof value.script !== "string" || !/^\w+$/.test(value.script)) {
            throw new Error(`${label}.script must be a registered @behavior3.customField name`);
        }
        if (scope !== "condition") {
            throw new Error(`${label}.script is only supported for condition fields`);
        }
        if (defaultFromNodeId) {
            throw new Error(`${label}.script cannot be used with default "${NODE_ID_DEFAULT}"`);
        }
        def.script = value.script;
    }
    // A script supplies the value of a required field, so it needs no default.
    if (def.required && !hasCustomFieldDefault(def) && !def.script) {
        throw new Error(`${label}.default is required when required is true`);
    }
    if (value.when !== undefined) {
        if (scope !== "tree") {
            throw new Error(`${label}.when is only supported for tree fields`);
        }
        if (value.when !== "always" && value.when !== "hasConditions") {
            throw new Error(`${label}.when must be "always" or "hasConditions"`);
        }
        def.when = value.when;
    }
    return def;
};

/** Parse `settings.customFields` of a `.b3-workspace` file. */
export const normalizeCustomFieldDefs = (value: unknown, label: string): CustomFieldDefs => {
    if (!isRecord(value)) {
        throw new Error(`${label} must be an object`);
    }
    const readScope = (scope: keyof CustomFieldDefs): CustomFieldDef[] => {
        const entries = value[scope];
        if (entries === undefined) {
            return [];
        }
        if (!Array.isArray(entries)) {
            throw new Error(`${label}.${scope} must be an array`);
        }
        const defs = entries.map((entry, index) =>
            normalizeCustomFieldDef(entry, `${label}.${scope}[${index}]`, scope)
        );
        const keys = new Set<string>();
        for (const def of defs) {
            if (keys.has(def.key)) {
                throw new Error(`${label}.${scope} has a duplicate key: ${def.key}`);
            }
            keys.add(def.key);
        }
        return defs;
    };
    return { tree: readScope("tree"), condition: readScope("condition") };
};

/** Condition files edit a condition item's `custom` as their tree custom. */
export const scopeCustomFieldDefsForConditionFile = (defs: CustomFieldDefs): CustomFieldDefs => ({
    tree: defs.condition,
    condition: defs.condition,
});

/** Tree fields that apply to this tree right now. */
export const activeTreeCustomFields = (
    defs: CustomFieldDef[] | undefined,
    usesConditions: boolean
): CustomFieldDef[] => (defs ?? []).filter((def) => def.when === "always" || usesConditions);

const fillRequired = <T extends CustomRecord | undefined>(
    custom: T,
    defs: CustomFieldDef[],
    nodeId?: string
): T | CustomRecord => {
    let next = custom;
    for (const def of defs) {
        const value = resolveCustomFieldDefault(def, nodeId);
        if (def.required && value !== undefined && !(def.key in (next ?? {}))) {
            next = { ...(next ?? {}), [def.key]: value } as T;
        }
    }
    return next as T | CustomRecord;
};

type ConditionHolder = {
    id?: string;
    conditions?: { custom?: CustomRecord; root: ConditionHolder }[];
    children?: ConditionHolder[];
};

const fillConditionCustoms = (node: ConditionHolder, defs: CustomFieldDef[]): boolean => {
    let changed = false;
    for (const condition of node.conditions ?? []) {
        // Override entries carry no node id; `$nodeId` defaults are written when the condition is made.
        const next = fillRequired(condition.custom, defs, node.id);
        if (next !== condition.custom) {
            condition.custom = next as CustomRecord;
            changed = true;
        }
        changed = fillConditionCustoms(condition.root, defs) || changed;
    }
    for (const child of node.children ?? []) {
        changed = fillConditionCustoms(child, defs) || changed;
    }
    return changed;
};

/**
 * Write the default of every required field that applies and is missing.
 * Covers the tree's `custom` and every condition item's `custom` in the root and in overrides.
 * Existing values are never rewritten, even when they do not match the declaration.
 */
export const ensureRequiredCustomFields = (
    tree: {
        root: ConditionHolder;
        custom: CustomRecord;
        overrides?: Record<string, { conditions?: ConditionHolder["conditions"] } | undefined>;
    },
    defs: CustomFieldDefs | undefined
): boolean => {
    if (!defs) {
        return false;
    }
    let changed = false;
    const treeFields = activeTreeCustomFields(defs.tree, treeUsesConditions(tree));
    const nextCustom = fillRequired(tree.custom, treeFields);
    if (nextCustom !== tree.custom) {
        tree.custom = nextCustom as CustomRecord;
        changed = true;
    }
    if (defs.condition.length > 0) {
        changed = fillConditionCustoms(tree.root, defs.condition) || changed;
        for (const entry of Object.values(tree.overrides ?? {})) {
            if (entry?.conditions) {
                changed =
                    fillConditionCustoms({ conditions: entry.conditions }, defs.condition) ||
                    changed;
            }
        }
    }
    return changed;
};

/** `custom` of a new condition item on `hostNodeId`: every condition field that has a default. */
export const createConditionCustom = (
    defs: CustomFieldDef[] | undefined,
    hostNodeId: string
): CustomRecord | undefined => {
    const entries = (defs ?? [])
        .map((def) => [def.key, resolveCustomFieldDefault(def, hostNodeId)] as const)
        .filter((entry): entry is readonly [string, CustomFieldValue] => entry[1] !== undefined);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

/**
 * Apply declared fields to a submitted `custom`: a removed required field comes back,
 * and a read-only field keeps its previous value.
 */
export const mergeCustomCommit = (
    previous: CustomRecord | undefined,
    next: CustomRecord | undefined,
    fields: CustomFieldDef[],
    nodeId?: string
): CustomRecord | undefined => {
    let merged = next;
    for (const def of fields) {
        const defaultValue = resolveCustomFieldDefault(def, nodeId);
        const hasPrevious = previous !== undefined && def.key in previous;
        const hasNext = merged !== undefined && def.key in merged;
        if (!def.editable && hasPrevious) {
            if (!hasNext || merged![def.key] !== previous![def.key]) {
                merged = { ...(merged ?? {}), [def.key]: previous![def.key] };
            }
            continue;
        }
        if (!def.editable && hasNext && defaultValue !== undefined) {
            merged = { ...merged, [def.key]: defaultValue };
            continue;
        }
        if (def.required && !hasNext && (hasPrevious || defaultValue !== undefined)) {
            merged = {
                ...(merged ?? {}),
                [def.key]: hasPrevious ? previous![def.key] : (defaultValue as CustomFieldValue),
            };
        }
    }
    return merged;
};
