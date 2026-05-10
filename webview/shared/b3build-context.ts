import {
    FileVarDecl,
    hasArgOptions,
    ImportDecl,
    isBoolType,
    isExprType,
    isFloatType,
    isIntType,
    isJsonType,
    isStringType,
    NodeArg,
    NodeData,
    NodeDef,
    TreeData,
    VarDecl,
} from "./b3type";
import { logger } from "./logger";
import { getFs } from "./b3fs";
import { readTreeFromFile } from "./tree";
import { dfs, isSubtreeRoot } from "./tree-model";
import {
    checkOneof,
    createNodeDefMap,
    getNodeArgOptions,
    getNodeArgRawType,
    isNodeArgArray,
    isNodeArgOptional,
    parseSlotDefinition,
} from "./node-utils";
import { normalizeNodeDefCollection } from "./schema";
import {
    parseExpressionVariables,
    validateExpressionEntries,
    validateVariableReference,
    type TreeValidationDiagnostic,
} from "./validation";

const unknownNodeDef: NodeDef = {
    name: "unknown",
    desc: "",
    type: "Action",
};

type BuildAlertHandler = (msg: string, duration?: number) => void;

const readJson = <T>(path: string): T => {
    const content = getFs().readFileSync(path, "utf-8");
    return JSON.parse(content) as T;
};

interface BuildValidationState {
    nodeDefs: ReadonlyMap<string, NodeDef>;
    usingGroups: Record<string, boolean> | null;
    usingVars: Record<string, VarDecl> | null;
    parsedExprs: Record<string, string[]>;
    checkExpr: boolean;
}

interface BuildProjectState extends BuildValidationState {
    workdir: string;
    files: Record<string, number>;
    parsedVarDecl: Record<string, ImportDecl>;
    alertError: BuildAlertHandler;
}

const createNodeDefsState = (
    defs: unknown
): Pick<BuildValidationState, "nodeDefs"> => {
    const normalizedNodeDefs = normalizeNodeDefCollection(defs);

    for (const node of normalizedNodeDefs) {
        node.args?.forEach((arg) => {
            if (arg.options && !arg.options[0].source) {
                // Older settings stored options directly; normalize them to source buckets.
                arg.options = [
                    {
                        source: arg.options as unknown as Array<{ name: string; value: unknown }>,
                    },
                ];
            }
            arg.options?.forEach((option) => {
                Object.keys(option.match ?? {}).forEach((key) => {
                    if (!node.args?.find((entry) => entry.name === key)) {
                        logger.error(
                            `match key '${key}' in arg '${arg.name}' of ` +
                                `node '${node.name}' is not found in args`
                        );
                    }
                });
            });
        });
    }

    return {
        nodeDefs: createNodeDefMap(normalizedNodeDefs),
    };
};

const getBuildNodeDef = (nodeDefs: ReadonlyMap<string, NodeDef>, name: string): NodeDef => {
    return nodeDefs.get(name) ?? unknownNodeDef;
};

const toUsingGroups = (group: string[]): Record<string, boolean> | null => {
    let next: Record<string, boolean> | null = null;
    for (const value of group) {
        next ??= {};
        next[value] = true;
    }
    return next;
};

const toUsingVars = (vars: VarDecl[]): Record<string, VarDecl> | null => {
    let next: Record<string, VarDecl> | null = null;
    for (const variable of vars) {
        next ??= {};
        next[variable.name] = variable;
    }
    return next;
};

const parseExprWithCache = (expr: string, exprCache: Record<string, string[]>) => {
    if (exprCache[expr]) {
        return exprCache[expr];
    }
    // Expression parsing is hot during validation; each state owns its own cache.
    const result = parseExpressionVariables(expr);
    exprCache[expr] = result;
    return result;
};

type ErrorPrinter = (msg: string) => void;

const formatError = (data: NodeData, msg: string) => {
    return `check ${data.id}|${data.name}: ${msg}`;
};

const formatBuildDiagnostic = (diagnostic: TreeValidationDiagnostic): string => {
    switch (diagnostic.code) {
        case "invalid-variable-name":
            return `${diagnostic.field} field '${diagnostic.variable}' is not a valid variable name,should start with a letter or underscore`;
        case "undefined-variable":
            return `${diagnostic.field} variable '${diagnostic.variable}' is not defined`;
        case "invalid-expression":
            return `expr '${diagnostic.expression}' is not valid`;
        case "group-not-enabled":
            return `node group '${diagnostic.groups.join(", ")}' is not enabled`;
        case "required-arg":
            return `arg field '${diagnostic.label}' is required`;
        case "required-input":
            return `intput field '${diagnostic.label}' is required`;
        case "required-output":
            return `output field '${diagnostic.label}' is required`;
        case "invalid-children":
            return `expect ${diagnostic.expected} children, but got ${diagnostic.actual}`;
        case "missing-node-def":
            return `undefined node: ${diagnostic.nodeName}`;
        default:
            return "invalid node data";
    }
};

const checkNodeArgValue = (
    data: NodeData,
    arg: NodeArg,
    value: unknown,
    printer?: ErrorPrinter
) => {
    let hasError = false;
    const type = getNodeArgRawType(arg);
    const error = !printer ? () => {} : (msg: string) => printer(formatError(data, msg));
    if (isFloatType(type)) {
        const isNumber = typeof value === "number";
        const isOptional = value === undefined && isNodeArgOptional(arg);
        if (!(isNumber || isOptional)) {
            error(`'${arg.name}=${JSON.stringify(value)}' is not a number`);
            hasError = true;
        }
    } else if (isIntType(type)) {
        const isInt = typeof value === "number" && value === Math.floor(value);
        const isOptional = value === undefined && isNodeArgOptional(arg);
        if (!(isInt || isOptional)) {
            error(`'${arg.name}=${JSON.stringify(value)}' is not a int`);
            hasError = true;
        }
    } else if (isStringType(type)) {
        const isString = typeof value === "string" && value;
        const isOptional = (value === undefined || value === "") && isNodeArgOptional(arg);
        if (!(isString || isOptional)) {
            error(`'${arg.name}=${JSON.stringify(value)}' is not a string`);
            hasError = true;
        }
    } else if (isExprType(type)) {
        const isExpr = typeof value === "string" && value;
        const isOptional = (value === undefined || value === "") && isNodeArgOptional(arg);
        if (!(isExpr || isOptional)) {
            error(`'${arg.name}=${JSON.stringify(value)}' is not an expr string`);
            hasError = true;
        }
    } else if (isJsonType(type)) {
        const isJson = value !== undefined && value !== "";
        const isOptional = isNodeArgOptional(arg);
        if (!(isJson || isOptional)) {
            error(`'${arg.name}=${value}' is not an invalid object`);
            hasError = true;
        }
    } else if (isBoolType(type)) {
        const isBool = typeof value === "boolean";
        const isOptional = value === undefined && isNodeArgOptional(arg);
        if (!(isBool || isOptional)) {
            error(`'${arg.name}=${JSON.stringify(value)}' is not a boolean`);
            hasError = true;
        }
    } else {
        hasError = true;
        error(`unknown arg type '${arg.type}'`);
    }

    if (hasArgOptions(arg)) {
        const options = getNodeArgOptions(arg, data.args ?? {});
        const found = !!options?.find(
            (option: { name: string; value: unknown }) => option.value === value
        );
        const isOptional = value === undefined && isNodeArgOptional(arg);
        if (!(found || isOptional)) {
            error(`'${arg.name}=${JSON.stringify(value)}' is not a one of the option values`);
            hasError = true;
        }
    }

    return !hasError;
};

const checkNodeArg = (data: NodeData, conf: NodeDef, i: number, printer?: ErrorPrinter) => {
    let hasError = false;
    const arg = conf.args![i] as NodeArg;
    const value = data.args?.[arg.name];
    const error = !printer ? () => {} : (msg: string) => printer(formatError(data, msg));
    if (isNodeArgArray(arg)) {
        if (!Array.isArray(value) || value.length === 0) {
            if (!isNodeArgOptional(arg)) {
                error(`'${arg.name}=${JSON.stringify(value)}' is not an array or empty array`);
                hasError = true;
            }
        } else {
            for (let j = 0; j < value.length; j++) {
                if (!checkNodeArgValue(data, arg, value[j], printer)) {
                    hasError = true;
                }
            }
        }
    } else if (!checkNodeArgValue(data, arg, value, printer)) {
        hasError = true;
    }
    if (arg.oneof !== undefined) {
        const idx = conf.input?.findIndex((v) => v.startsWith(arg.oneof!)) ?? -1;
        if (!checkOneof(arg, data.args?.[arg.name], data.input?.[idx])) {
            error(
                `only one is allowed for between argument '${arg.name}' and input '${data.input?.[idx]}'`
            );

            hasError = true;
        }
    }

    return !hasError;
};

const isValidChildrenWithNodeDefs = (
    data: NodeData,
    nodeDefs: ReadonlyMap<string, NodeDef>
) => {
    const def = getBuildNodeDef(nodeDefs, data.name);
    if (def.children !== undefined && def.children !== -1) {
        return (data.children?.filter((child) => !child.disabled).length || 0) === def.children;
    }
    return true;
};

const checkNodeDataWithState = (
    data: NodeData | null | undefined,
    printer: ErrorPrinter,
    state: Pick<
        BuildValidationState,
        "nodeDefs" | "usingGroups" | "usingVars" | "parsedExprs" | "checkExpr"
    >
) => {
    if (!data) {
        return false;
    }
    const error = !printer ? () => {} : (msg: string) => printer(formatError(data, msg));
    const conf = getBuildNodeDef(state.nodeDefs, data.name);
    if (conf.name === unknownNodeDef.name) {
        error(`undefined node: ${data.name}`);
        return false;
    }

    let hasError = false;
    if (conf.group) {
        const groups = Array.isArray(conf.group) ? conf.group : [conf.group];
        if (!groups.some((g) => state.usingGroups?.[g])) {
            error(`node group '${conf.group}' is not enabled`);
            hasError = true;
        }
    }

    for (const value of data.input ?? []) {
        const diagnostic = validateVariableReference(value, state.usingVars, "input");
        if (diagnostic) {
            error(formatBuildDiagnostic(diagnostic));
            hasError = true;
        }
    }
    for (const value of data.output ?? []) {
        const diagnostic = validateVariableReference(value, state.usingVars, "output");
        if (diagnostic) {
            error(formatBuildDiagnostic(diagnostic));
            hasError = true;
        }
    }

    if (data.args && conf.args) {
        for (const arg of conf.args) {
            const value = data.args?.[arg.name] as string | string[] | undefined;
            if (isExprType(arg.type) && value) {
                const exprs = Array.isArray(value) ? value : [value];
                exprs.forEach((expr) => {
                    parseExprWithCache(expr, state.parsedExprs);
                });
                const diagnostic = validateExpressionEntries(
                    exprs,
                    state.usingVars,
                    state.checkExpr
                );
                if (diagnostic) {
                    error(formatBuildDiagnostic(diagnostic));
                    hasError = true;
                }
            }
        }
    }

    if (!isValidChildrenWithNodeDefs(data, state.nodeDefs)) {
        hasError = true;
        const count = data.children?.filter((c) => !c.disabled).length || 0;
        error(`expect ${conf.children} children, but got ${count}`);
    }

    let hasVaridicInput = false;
    if (conf.input) {
        for (let i = 0; i < conf.input.length; i++) {
            if (!data.input) {
                data.input = [];
            }
            if (!data.input[i]) {
                data.input[i] = "";
            }
            if (!isValidInputOrOutput(conf.input, data.input, i)) {
                error(`intput field '${conf.input[i]}' is required`);
                hasError = true;
            }
            if (i === conf.input.length - 1 && isVariadic(conf.input, -1)) {
                hasVaridicInput = true;
            }
        }
    }
    if (data.input && !hasVaridicInput) {
        data.input.length = conf.input?.length || 0;
    }

    let hasVaridicOutput = false;
    if (conf.output) {
        for (let i = 0; i < conf.output.length; i++) {
            if (!data.output) {
                data.output = [];
            }
            if (!data.output[i]) {
                data.output[i] = "";
            }
            if (!isValidInputOrOutput(conf.output, data.output, i)) {
                error(`output field '${conf.output[i]}' is required`);
                hasError = true;
            }
            if (i === conf.output.length - 1 && isVariadic(conf.output, -1)) {
                hasVaridicOutput = true;
            }
        }
    }
    if (data.output && !hasVaridicOutput) {
        data.output.length = conf.output?.length || 0;
    }
    if (conf.args) {
        const args: { [k: string]: unknown } = {};
        data.args ||= {};
        for (let i = 0; i < conf.args.length; i++) {
            const key = conf.args[i].name;
            if (data.args[key] === undefined && conf.args[i].default !== undefined) {
                data.args[key] = conf.args[i].default;
            }

            const value = data.args[key];
            if (value !== undefined) {
                args[key] = value;
            }

            if (!checkNodeArg(data, conf, i, printer)) {
                hasError = true;
            }
        }
        data.args = args;
    }

    if (data.children) {
        for (const child of data.children) {
            if (!checkNodeDataWithState(child, printer, state)) {
                hasError = true;
            }
        }
    } else {
        data.children = [];
    }

    return !hasError;
};

/** Align with extension `tree-editor-provider.normalizePathKey` for subtree path lookup. */
const normalizeSubtreePathKey = (p: string) =>
    p
        .replace(/\\/g, "/")
        .replace(/^[/\\]+/, "")
        .replace(/^\.\//, "");

interface RefreshVarDeclContext {
    files: Record<string, number>;
    workdir: string;
    usingGroups: Record<string, boolean> | null;
    usingVars: Record<string, VarDecl> | null;
    parsedVarDecl: Record<string, ImportDecl>;
    parsingStack: string[];
    dfs<T extends { children?: T[] }>(
        node: T,
        visitor: (node: T, depth: number) => unknown,
        depth?: number
    ): void;
    normalizeSubtreePathKey(path: string): string;
    updateUsingGroups(group: string[]): void;
    updateUsingVars(vars: VarDecl[]): void;
    readTreeFromFile(path: string): TreeData;
    alertError(message: string, duration?: number): void;
    logger: {
        warn(...args: unknown[]): void;
        debug(...args: unknown[]): void;
    };
}

const collectSubtreePaths = (data: NodeData, walk: RefreshVarDeclContext["dfs"]): string[] => {
    const list: string[] = [];
    walk(data, (node) => {
        if (node.path) {
            list.push(node.path);
        }
    });
    return list;
};

/**
 * Variable declaration refresh shares the same import/subtree expansion rules
 * between the live editor state and offline build contexts.
 */
const loadVarDecl = (list: ImportDecl[], arr: Array<VarDecl>, context: RefreshVarDeclContext) => {
    for (const entry of list) {
        if (!context.files[entry.path]) {
            context.logger.warn(`file not found: ${context.workdir}/${entry.path}`);
            continue;
        }

        let changed = false;
        if (!entry.modified || context.files[entry.path] > entry.modified) {
            changed = true;
        }

        if (!changed) {
            changed = entry.depends.some(
                (dependency) =>
                    context.files[dependency.path] &&
                    context.files[dependency.path] > dependency.modified
            );
        }

        if (!changed) {
            continue;
        }

        entry.vars = [];
        entry.depends = [];
        entry.modified = context.files[entry.path];

        const vars: Set<VarDecl> = new Set();
        const depends: Set<string> = new Set();
        const load = (relativePath: string) => {
            if (context.parsingStack.includes(relativePath)) {
                return;
            }

            const parsedEntry: ImportDecl | undefined = context.parsedVarDecl[relativePath];
            if (parsedEntry && context.files[relativePath] === parsedEntry.modified) {
                parsedEntry.depends.forEach((dependency) => depends.add(dependency.path));
                parsedEntry.vars.forEach((variable) => vars.add(variable));
                return;
            }

            context.parsingStack.push(relativePath);
            try {
                const model: TreeData = context.readTreeFromFile(
                    `${context.workdir}/${relativePath}`
                );
                model.variables.locals.forEach((variable) => vars.add(variable));
                model.variables.imports.forEach((importPath) => {
                    load(importPath);
                    depends.add(importPath);
                });
                collectSubtreePaths(model.root, context.dfs).forEach((subtreePath) => {
                    load(subtreePath);
                    depends.add(subtreePath);
                });
                context.logger.debug(`load var: ${relativePath}`);
            } catch {
                context.alertError(`parsing error: ${relativePath}`);
            }
            context.parsingStack.pop();
        };

        load(entry.path);
        entry.vars = Array.from(vars).sort((a, b) => a.name.localeCompare(b.name));
        entry.depends = Array.from(depends).map((dependencyPath) => ({
            path: dependencyPath,
            modified: context.files[dependencyPath],
        }));
        context.parsedVarDecl[entry.path] = {
            path: entry.path,
            vars: entry.vars.map((variable) => ({ name: variable.name, desc: variable.desc })),
            depends: entry.depends.slice(),
            modified: entry.modified,
        };
    }

    list.forEach((entry) => arr.push(...entry.vars));
};

const refreshVarDeclNode = (
    root: NodeData,
    group: string[],
    declare: FileVarDecl,
    context: RefreshVarDeclContext
) => {
    const filter: Record<string, boolean> = {};
    const vars: Array<VarDecl> = new (class extends Array<VarDecl> {
        override push(...items: VarDecl[]): number {
            for (const item of items) {
                if (filter[item.name]) {
                    continue;
                }
                filter[item.name] = true;
                super.push(item);
            }
            return this.length;
        }
    })();

    vars.push(...declare.vars);
    context.parsingStack.length = 0;
    declare.subtree = collectSubtreePaths(root, context.dfs).map((subtreePath) => ({
        path: subtreePath,
        vars: [],
        depends: [],
    }));
    loadVarDecl(declare.import, vars, context);
    loadVarDecl(declare.subtree, vars, context);

    let changed = false;
    const lastGroup = Array.from(Object.keys(context.usingGroups ?? {})).sort();
    group.sort();
    if (
        lastGroup.length !== group.length ||
        lastGroup.some((value, index) => value !== group[index])
    ) {
        changed = true;
        context.logger.debug("refresh group:", lastGroup, group);
        context.updateUsingGroups(group);
    }

    const lastVars = Array.from(Object.keys(context.usingVars ?? {})).sort();
    vars.sort((a, b) => a.name.localeCompare(b.name));
    if (
        lastVars.length !== vars.length ||
        lastVars.some((value, index) => value !== vars[index].name)
    ) {
        changed = true;
        context.logger.debug("refresh vars:", lastVars, vars);
        context.updateUsingVars(vars);
    }

    return changed;
};

const createRefreshVarDeclContext = (
    state: Pick<
        BuildProjectState,
        "files" | "workdir" | "usingGroups" | "usingVars" | "parsedVarDecl" | "alertError"
    >,
    updates: Pick<RefreshVarDeclContext, "updateUsingGroups" | "updateUsingVars">
): RefreshVarDeclContext => ({
    files: state.files,
    workdir: state.workdir,
    usingGroups: state.usingGroups,
    usingVars: state.usingVars,
    parsedVarDecl: state.parsedVarDecl,
    parsingStack: [],
    dfs,
    normalizeSubtreePathKey,
    updateUsingGroups: updates.updateUsingGroups,
    updateUsingVars: updates.updateUsingVars,
    readTreeFromFile,
    alertError: state.alertError,
    logger,
});

export const createBuildProjectContext = (options: {
    workdir: string;
    settingFile: string;
    checkExpr: boolean;
    buildScriptDebug?: boolean;
    alertError?: BuildAlertHandler;
}) => {
    /**
     * Offline builds should validate against their own node defs, file mtimes,
     * var-decl cache, and expression cache instead of mutating editor globals.
     */
    const loaded = createNodeDefsState(readJson(options.settingFile) as unknown);
    const state: BuildProjectState = {
        nodeDefs: loaded.nodeDefs,
        usingGroups: null,
        usingVars: null,
        parsedExprs: {},
        checkExpr: options.checkExpr,
        workdir: options.workdir.replace(/\\/g, "/"),
        files: {},
        parsedVarDecl: {},
        alertError: options.alertError ?? (() => {}),
    };

    const setLocalCheckExpr = (check: boolean) => {
        state.checkExpr = check;
    };

    const updateLocalUsingGroups = (group: string[]) => {
        state.usingGroups = toUsingGroups(group);
    };

    const updateLocalUsingVars = (vars: VarDecl[]) => {
        state.usingVars = toUsingVars(vars);
    };

    return {
        workdir: state.workdir,
        nodeDefs: state.nodeDefs,
        checkExprOverride: state.checkExpr,
        buildScriptDebug: options.buildScriptDebug,
        files: state.files,
        parsedVarDecl: state.parsedVarDecl,
        dfs,
        isSubtreeRoot,
        refreshVarDecl: (root: NodeData, group: string[], declare: FileVarDecl) =>
            refreshVarDeclNode(
                root,
                group,
                declare,
                createRefreshVarDeclContext(state, {
                    updateUsingGroups: updateLocalUsingGroups,
                    updateUsingVars: updateLocalUsingVars,
                })
            ),
        checkNodeData: (data: NodeData | null | undefined, printer: ErrorPrinter) =>
            checkNodeDataWithState(data, printer, state),
        setCheckExpr: setLocalCheckExpr,
    };
};

const isVariadic = (def: string[], i: number) => {
    const index = i === -1 ? def.length - 1 : i;
    return parseSlotDefinition(def[index] ?? "", def, index).variadic;
};

const isValidInputOrOutput = (def: string[], data: string[] | undefined, index: number) => {
    const slotDefinition = parseSlotDefinition(def[index] ?? "", def, index);
    return !slotDefinition.required || Boolean(data?.[index]) || slotDefinition.variadic;
};
