import type { TreeVariables } from "../shared/b3type";
import type {
    NodeDef,
    PersistedConditionData,
    PersistedNodeModel,
    VarDecl,
} from "../shared/contracts";
import { getAbortModeViolation, isConditionOnRoot } from "../shared/condition-branch";
import { findNodeDef } from "../shared/node-utils";
import { collectResolvedNodeDiagnostics } from "../shared/validation";

/** What a condition tree on the host tree's canvas is checked against. */
export interface ConditionValidationContext {
    defsByName: ReadonlyMap<string, NodeDef>;
    /** The host tree's variables. */
    usingVars: Record<string, VarDecl> | null;
    usingGroups: Record<string, boolean> | null;
    strictGroup: boolean;
    checkExpr: boolean;
    /** The variables of each file a condition imports, imports of imports included. */
    conditionImportVars?: Record<string, VarDecl[]>;
}

/**
 * The variables a condition tree uses: its host tree's and its own, imports included. Same as
 * the condition file and the build.
 */
export const resolveConditionUsingVars = (
    usingVars: Record<string, VarDecl> | null,
    variables: TreeVariables | undefined,
    conditionImportVars: Record<string, VarDecl[]> | undefined
): Record<string, VarDecl> | null => {
    if (!variables || (variables.locals.length === 0 && variables.imports.length === 0)) {
        return usingVars;
    }
    const merged: Record<string, VarDecl> = { ...usingVars };
    for (const variable of variables.locals) {
        if (variable.name) {
            merged[variable.name] = variable;
        }
    }
    for (const importPath of variables.imports) {
        for (const variable of conditionImportVars?.[importPath] ?? []) {
            merged[variable.name] ??= variable;
        }
    }
    return merged;
};

/**
 * True when a node of the condition tree fails the shared node validation, as it would on the
 * condition file's canvas. A subtree reference is checked in its own file, so it is skipped
 * along with what is under it.
 */
export const hasInvalidConditionTreeNode = (
    condition: Pick<PersistedConditionData, "root" | "variables">,
    ctx: ConditionValidationContext
): boolean => {
    const usingVars = resolveConditionUsingVars(
        ctx.usingVars,
        condition.variables,
        ctx.conditionImportVars
    );
    const visit = (node: PersistedNodeModel, active: boolean): boolean => {
        if (node.path) {
            return false;
        }
        const inConditionTree = active && !node.disabled;
        const diagnostics = collectResolvedNodeDiagnostics({
            node,
            def: findNodeDef(ctx.defsByName, node.name),
            usingVars,
            usingGroups: ctx.usingGroups,
            strictGroup: ctx.strictGroup,
            checkExpr: ctx.checkExpr,
            inConditionTree,
        });
        if (diagnostics.length > 0) {
            return true;
        }
        return (node.children ?? []).some((child) => visit(child, inConditionTree));
    };
    return visit(condition.root, true);
};

/**
 * The condition sits on a tree root (`parent === null`), or its abort mode cannot take effect
 * under `parent`. `undefined` means the parent is not known, so neither can be told.
 */
export const isConditionAbortInvalid = (
    abort: PersistedConditionData["abort"],
    parent: { name: string; preemptive?: boolean } | null | undefined
): boolean =>
    parent !== undefined &&
    (isConditionOnRoot(parent) || Boolean(getAbortModeViolation(abort, parent)));

/**
 * A condition item is invalid when it sits on a tree root, its abort mode cannot take effect,
 * or a node of its condition tree is invalid.
 */
export const isConditionInvalid = (
    condition: Pick<PersistedConditionData, "abort" | "root" | "variables">,
    parent: { name: string; preemptive?: boolean } | null | undefined,
    ctx: ConditionValidationContext
): boolean =>
    isConditionAbortInvalid(condition.abort, parent) || hasInvalidConditionTreeNode(condition, ctx);
