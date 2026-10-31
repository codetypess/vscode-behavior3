import type { BuildEnv, CustomFieldResolveReason, CustomFieldResolver } from "./b3build-model";
import type { CustomFieldDef, NodeData, TreeData } from "./b3type";
import { isCustomFieldValue } from "./custom-fields";

/** The node shape shared by persisted trees (editor save) and expanded build trees. */
type ScriptFieldNode = {
    id: string;
    uuid?: string;
    conditions?: {
        custom?: Record<string, string | number | boolean | object>;
        root: ScriptFieldNode;
    }[];
    children?: ScriptFieldNode[];
};

export const hasScriptCustomFields = (defs: CustomFieldDef[] | undefined): boolean =>
    (defs ?? []).some((def) => def.script);

const walkInlineNodes = (node: ScriptFieldNode, visit: (node: ScriptFieldNode) => void): void => {
    visit(node);
    for (const condition of node.conditions ?? []) {
        walkInlineNodes(condition.root, visit);
    }
    for (const child of node.children ?? []) {
        walkInlineNodes(child, visit);
    }
};

/** True when a main-tree condition lacks a script field, so a `create` pass has work to do. */
export const treeNeedsScriptCustomFields = (
    tree: { root: ScriptFieldNode },
    defs: CustomFieldDef[] | undefined
): boolean => {
    const scriptDefs = (defs ?? []).filter((def) => def.script);
    if (scriptDefs.length === 0) {
        return false;
    }
    let missing = false;
    walkInlineNodes(tree.root, (node) => {
        for (const condition of node.conditions ?? []) {
            if (scriptDefs.some((def) => !(def.key in (condition.custom ?? {})))) {
                missing = true;
            }
        }
    });
    return missing;
};

export interface ResolveScriptCustomFieldsParams {
    tree: { root: ScriptFieldNode };
    defs: CustomFieldDef[];
    reason: CustomFieldResolveReason;
    resolvers: ReadonlyMap<string, CustomFieldResolver>;
    /** The host node id before renumbering; defaults to the current id. */
    previousNodeId?: (node: ScriptFieldNode) => string | undefined;
    treePath: string;
    env: BuildEnv;
    report: (level: "warn" | "error", message: string) => void;
}

/**
 * Ask `@behavior3.customField` resolvers for the script fields of every condition in the tree:
 * main-tree inline conditions on save, every expanded condition on build.
 * `create` only fills fields a condition lacks; `save` and `build` ask for every script field.
 * Fields are resolved in declaration order, so later fields see earlier results in `ctx.custom`.
 * Bad results and thrown errors are reported and leave the value as it was.
 */
export const resolveScriptCustomFields = (params: ResolveScriptCustomFieldsParams): boolean => {
    const scriptDefs = params.defs.filter((def) => def.script);
    if (scriptDefs.length === 0) {
        return false;
    }
    let changed = false;
    const missingResolvers = new Set<string>();

    walkInlineNodes(params.tree.root, (node) => {
        node.conditions?.forEach((condition, conditionIndex) => {
            const previous = { ...(condition.custom ?? {}) };
            const current: Record<string, string | number | boolean | object> = { ...previous };
            for (const def of scriptDefs) {
                const hasValue = def.key in current;
                if (params.reason === "create" && hasValue) {
                    continue;
                }
                const resolver = params.resolvers.get(def.script!);
                let result: unknown;
                if (!resolver) {
                    missingResolvers.add(def.script!);
                } else {
                    try {
                        result = resolver.resolve({
                            reason: params.reason,
                            key: def.key,
                            value: current[def.key],
                            custom: { ...current },
                            previous,
                            node: node as NodeData,
                            previousNodeId: params.previousNodeId?.(node) ?? node.id,
                            conditionIndex,
                            tree: params.tree as unknown as TreeData,
                            treePath: params.treePath,
                            env: params.env,
                        });
                    } catch (error) {
                        params.report(
                            "error",
                            `customField '${def.script}' failed for '${def.key}' on node ${node.id}: ${String(error)}`
                        );
                        result = undefined;
                    }
                }
                if (result !== undefined && !isCustomFieldValue(def, result)) {
                    params.report(
                        "error",
                        `customField '${def.script}' returned an invalid ${def.type} for '${def.key}' on node ${node.id}: ${JSON.stringify(result)}`
                    );
                    result = undefined;
                }
                if (result === undefined && !hasValue && def.default !== undefined) {
                    result = def.default;
                }
                if (result !== undefined && current[def.key] !== result) {
                    current[def.key] = result as string | number | boolean;
                }
            }
            const before = JSON.stringify(condition.custom ?? {});
            if (JSON.stringify(current) !== before) {
                condition.custom = current;
                changed = true;
            }
        });
    });

    for (const name of missingResolvers) {
        params.report("warn", `customField script '${name}' is not registered`);
    }
    return changed;
};

/** Node ids keyed by node object, taken before renumbering. */
export const collectNodeIds = (root: ScriptFieldNode): Map<ScriptFieldNode, string> => {
    const ids = new Map<ScriptFieldNode, string>();
    walkInlineNodes(root, (node) => {
        ids.set(node, node.id);
    });
    return ids;
};
