import { getFs, hasFs } from "./b3fs";
import type { FileVarDecl, ImportDecl, NodeData, NodeDef, TreeData } from "./b3type";
import type {
    BatchScript,
    BuildEnv,
    BuildScript,
    NodeFieldCheckContext,
    NodeFieldChecker,
    NodeFieldCheckResult,
    NodeFieldKind,
    NodeFieldVisible,
    NodeFieldVisibleContext,
    NodeFieldVisibleResult,
    NodeInputSlot,
    NodeOutputSlot,
    NodeSlotField,
} from "./b3build-model";
import { resolveCheckScriptPaths } from "./b3build-check-scripts";
import { logger } from "./logger";
import b3path from "./b3path";
import { stringifyJson } from "./json";
import { isStructuredSlotDefinition, parseSlotDefinition, type NodeSlotDef } from "./node-utils";
import { materializePersistedTree, type MaterializedTreeNode } from "./tree-materializer";
import {
    loadSubtreeSourceCache,
    parsePersistedTreeContent,
    readTreeFromFile,
    writeTree,
} from "./tree";
import { parseWorkspaceModelContent } from "./schema";

/**
 * Shared build pipeline helpers.
 * This module owns file discovery, subtree materialization, runtime hook
 * loading, and output serialization for offline/project builds.
 */
const SKIP_JSON_BASENAMES = new Set([
    "package.json",
    "package-lock.json",
    "jsconfig.json",
    "components.json",
]);

export const isBehaviorTreeJsonPath = (filePath: string): boolean => {
    const normalized = b3path.posixPath(filePath);
    if (!normalized.toLowerCase().endsWith(".json")) {
        return false;
    }

    // Project discovery is broad, so filter out common tooling JSON files and generated folders.
    const base = b3path.basename(normalized);
    const lowerBase = base.toLowerCase();
    if (SKIP_JSON_BASENAMES.has(lowerBase)) {
        return false;
    }

    if (lowerBase === "tsconfig.json" || /^tsconfig\..*\.json$/i.test(base)) {
        return false;
    }

    const lowerPath = `/${normalized.toLowerCase().replace(/^[/\\]+/, "")}`;
    return !["/.vscode/", "/.git/", "/node_modules/", "/dist/", "/build/"].some((marker) =>
        lowerPath.includes(marker)
    );
};

const readWorkspaceSettings = (path: string) => {
    const content = getFs().readFileSync(path, "utf-8");
    return parseWorkspaceModelContent(content).settings;
};

export type {
    BatchDecorator,
    BatchHookClass,
    BatchScript,
    BuildEnv,
    BuildLogger,
    BuildScript,
    FsLike,
    NodeFieldCheckContext,
    NodeFieldChecker,
    NodeFieldCheckerClass,
    NodeFieldCheckResult,
    NodeFieldKind,
    NodeFieldVisible,
    NodeFieldVisibleClass,
    NodeFieldVisibleContext,
    NodeFieldVisibleResult,
    NodeInputSlot,
    NodeOutputSlot,
    NodeSlotField,
    PathLike,
    VisibleDecorator,
} from "./b3build-model";
export { resolveCheckScriptPaths } from "./b3build-check-scripts";

type BuildHookCtor = new (env: BuildEnv) => BuildScript;
type BatchHookCtor = new (env: BuildEnv) => BatchScript;
type NodeFieldCheckerCtor = new (env: BuildEnv) => NodeFieldChecker;
type NodeFieldVisibleCtor = new (env: BuildEnv) => NodeFieldVisible;

type OptionalRequire = {
    cache?: Record<string, unknown>;
    resolve?(id: string): string;
};

type TypeScriptApi = typeof import("typescript");
type TypeScriptNode = import("typescript").Node;
type TypeScriptSourceFile = import("typescript").SourceFile;
type TypeScriptTransformerFactory = import("typescript").TransformerFactory<TypeScriptSourceFile>;
type RuntimeProcess = {
    env?: Record<string, string | undefined>;
    type?: string;
    once?(event: string, listener: () => void): unknown;
    exit?(code?: number): unknown;
};
type RuntimeGlobals = typeof globalThis & {
    behavior3?: unknown;
};
type DecoratorGlobalState = {
    depth: number;
    hadBehavior3: boolean;
    previousBehavior3: unknown;
};

interface BuildContext {
    workdir: string;
    nodeDefs: ReadonlyMap<string, NodeDef>;
    checkExprOverride?: boolean;
    buildScriptDebug?: boolean;
    files: Record<string, number>;
    parsedVarDecl: Record<string, ImportDecl>;
    dfs<T extends { children?: T[] }>(
        node: T,
        visitor: (node: T, depth: number) => unknown,
        depth?: number
    ): void;
    isSubtreeRoot(data: NodeData): boolean;
    refreshVarDecl(root: NodeData, group: string[], declare: FileVarDecl): boolean;
    checkNodeData(data: NodeData | null | undefined, printer: (message: string) => void): boolean;
    setCheckExpr(check: boolean): void;
}

export interface BatchProcessProjectResult {
    hasError: boolean;
    totalFiles: number;
    stagedWriteFiles: number;
    writtenFiles: number;
    unchangedFiles: number;
    skippedFiles: number;
    failedFiles: number;
}

const hasBuildHookMethod = (obj: unknown): obj is BuildScript => {
    if (!obj || typeof obj !== "object") {
        return false;
    }
    const candidate = obj as Partial<BuildScript>;
    return (
        typeof candidate.onProcessTree === "function" ||
        typeof candidate.onProcessNode === "function" ||
        typeof candidate.onWriteFile === "function" ||
        typeof candidate.onComplete === "function"
    );
};

const BUILD_HOOK_MARKER = "__behavior3BuildHook";
const BATCH_HOOK_MARKER = "__behavior3BatchHook";
const CHECK_HOOK_MARKER = "__behavior3CheckHook";
const CHECK_HOOK_NAME = "__behavior3CheckName";
const VISIBLE_HOOK_MARKER = "__behavior3VisibleHook";
const VISIBLE_HOOK_NAME = "__behavior3VisibleName";

type MarkedBuildHookCtor = BuildHookCtor & {
    [BUILD_HOOK_MARKER]?: true;
};

type MarkedBatchHookCtor = BatchHookCtor & {
    [BATCH_HOOK_MARKER]?: true;
};

type MarkedCheckCtor = NodeFieldCheckerCtor & {
    [CHECK_HOOK_MARKER]?: true;
    [CHECK_HOOK_NAME]?: string;
};

type MarkedVisibleCtor = NodeFieldVisibleCtor & {
    [VISIBLE_HOOK_MARKER]?: true;
    [VISIBLE_HOOK_NAME]?: string;
};

const markBuildHook = <T extends new (...args: unknown[]) => unknown>(ctor: T) => {
    Object.defineProperty(ctor, BUILD_HOOK_MARKER, {
        value: true,
        configurable: false,
    });
    return ctor;
};

const markBatchHook = <T extends new (...args: unknown[]) => unknown>(ctor: T) => {
    Object.defineProperty(ctor, BATCH_HOOK_MARKER, {
        value: true,
        configurable: false,
    });
    return ctor;
};

const markCheckCtor = <T extends new (...args: unknown[]) => unknown>(
    ctor: T,
    explicitName?: string
) => {
    const name = explicitName?.trim() || ctor.name;
    Object.defineProperty(ctor, CHECK_HOOK_MARKER, {
        value: true,
        configurable: false,
    });
    Object.defineProperty(ctor, CHECK_HOOK_NAME, {
        value: name,
        configurable: false,
    });
    return ctor;
};

const markVisibleCtor = <T extends new (...args: unknown[]) => unknown>(
    ctor: T,
    explicitName?: string
) => {
    const name = explicitName?.trim() || ctor.name;
    Object.defineProperty(ctor, VISIBLE_HOOK_MARKER, {
        value: true,
        configurable: false,
    });
    Object.defineProperty(ctor, VISIBLE_HOOK_NAME, {
        value: name,
        configurable: false,
    });
    return ctor;
};

const markCheckHook = <T extends new (...args: unknown[]) => unknown>(
    nameOrCtor?: string | T,
    _context?: ClassDecoratorContext<T>
) => {
    if (typeof nameOrCtor === "function") {
        return markCheckCtor(nameOrCtor);
    }
    return (ctor: T) => markCheckCtor(ctor, nameOrCtor);
};

const markVisibleHook = <T extends new (...args: unknown[]) => unknown>(
    nameOrCtor?: string | T,
    _context?: ClassDecoratorContext<T>
) => {
    if (typeof nameOrCtor === "function") {
        return markVisibleCtor(nameOrCtor);
    }
    return (ctor: T) => markVisibleCtor(ctor, nameOrCtor);
};

const isDecoratedBuildHookCtor = (value: unknown): value is MarkedBuildHookCtor =>
    typeof value === "function" && (value as MarkedBuildHookCtor)[BUILD_HOOK_MARKER] === true;

const isDecoratedBatchHookCtor = (value: unknown): value is MarkedBatchHookCtor =>
    typeof value === "function" && (value as MarkedBatchHookCtor)[BATCH_HOOK_MARKER] === true;

const isDecoratedCheckCtor = (value: unknown): value is MarkedCheckCtor =>
    typeof value === "function" && (value as MarkedCheckCtor)[CHECK_HOOK_MARKER] === true;

const isDecoratedVisibleCtor = (value: unknown): value is MarkedVisibleCtor =>
    typeof value === "function" && (value as MarkedVisibleCtor)[VISIBLE_HOOK_MARKER] === true;

const findDecoratedBuildHookCtor = (
    moduleRecord: Record<string, unknown>
): BuildHookCtor | undefined => {
    const decorated = Array.from(new Set(Object.values(moduleRecord))).filter(
        isDecoratedBuildHookCtor
    );
    if (decorated.length > 1) {
        logger.error("build script must decorate exactly one exported class with @behavior3.build");
        return undefined;
    }
    return decorated[0];
};

const findDecoratedBatchHookCtor = (
    moduleRecord: Record<string, unknown>
): BatchHookCtor | undefined => {
    const decorated = Array.from(new Set(Object.values(moduleRecord))).filter(
        isDecoratedBatchHookCtor
    );
    if (decorated.length > 1) {
        logger.error("batch script must decorate exactly one exported class with @behavior3.batch");
        return undefined;
    }
    if (decorated.length === 1) {
        return decorated[0];
    }

    // Compatibility fallback for existing batch scripts before @behavior3.batch existed.
    const legacyDecorated = Array.from(new Set(Object.values(moduleRecord))).filter(
        isDecoratedBuildHookCtor
    );
    if (legacyDecorated.length > 1) {
        logger.error("batch script must decorate exactly one exported class with @behavior3.batch");
        return undefined;
    }
    return legacyDecorated[0] as BatchHookCtor | undefined;
};

const findDecoratedCheckCtors = (moduleRecord: Record<string, unknown>): MarkedCheckCtor[] =>
    Array.from(new Set(Object.values(moduleRecord))).filter(isDecoratedCheckCtor);

const findDecoratedVisibleCtors = (moduleRecord: Record<string, unknown>): MarkedVisibleCtor[] =>
    Array.from(new Set(Object.values(moduleRecord))).filter(isDecoratedVisibleCtor);

const createBuildHooks = (
    moduleExports: unknown,
    env: BuildEnv,
    reportMissing = true
): BuildScript | undefined => {
    /** Build scripts must expose one class entry so runtime behavior stays uniform. */
    if (!moduleExports || typeof moduleExports !== "object") {
        return undefined;
    }
    const moduleRecord = moduleExports as Record<string, unknown>;
    const defaultExport =
        isDecoratedCheckCtor(moduleRecord.default) || isDecoratedBatchHookCtor(moduleRecord.default)
            ? undefined
            : moduleRecord.default;
    const ctor = (moduleRecord.BuildHook ??
        moduleRecord.Hook ??
        findDecoratedBuildHookCtor(moduleRecord) ??
        defaultExport) as BuildHookCtor | undefined;
    if (typeof ctor === "function") {
        try {
            const instance = new ctor(env);
            if (hasBuildHookMethod(instance)) {
                return instance;
            }
            logger.error("build hook class instance has no supported hook methods");
        } catch (error) {
            logger.error("failed to instantiate build hook class", error);
        }
    }

    if (reportMissing) {
        logger.error(
            "build script must export a BuildHook class, Hook class, default class, or one @behavior3.build-decorated class"
        );
    }
    return undefined;
};

const createBatchHooks = (
    moduleExports: unknown,
    env: BuildEnv,
    reportMissing = true
): BatchScript | undefined => {
    if (!moduleExports || typeof moduleExports !== "object") {
        return undefined;
    }
    const moduleRecord = moduleExports as Record<string, unknown>;
    const defaultExport =
        isDecoratedCheckCtor(moduleRecord.default) ||
        isDecoratedBuildHookCtor(moduleRecord.default) ||
        isDecoratedBatchHookCtor(moduleRecord.default)
            ? undefined
            : moduleRecord.default;
    const ctor = (moduleRecord.BatchHook ??
        findDecoratedBatchHookCtor(moduleRecord) ??
        moduleRecord.Hook ??
        defaultExport) as BatchHookCtor | undefined;
    if (typeof ctor === "function") {
        try {
            const instance = new ctor(env);
            if (
                hasBuildHookMethod(instance) ||
                typeof (instance as Partial<BatchScript>).shouldUpgradeTree === "function"
            ) {
                return instance;
            }
            logger.error("batch hook class instance has no supported hook methods");
        } catch (error) {
            logger.error("failed to instantiate batch hook class", error);
        }
    }

    if (reportMissing) {
        logger.error(
            "batch script must export a BatchHook class, default class, or one @behavior3.batch-decorated class"
        );
    }
    return undefined;
};

const createNodeFieldCheckers = (
    moduleExports: unknown,
    env: BuildEnv
): { checkers: Map<string, NodeFieldChecker>; hasError: boolean; hasCheckers: boolean } => {
    const checkers = new Map<string, NodeFieldChecker>();
    let hasError = false;
    if (!moduleExports || typeof moduleExports !== "object") {
        return { checkers, hasError, hasCheckers: false };
    }

    const moduleRecord = moduleExports as Record<string, unknown>;
    const decorated = findDecoratedCheckCtors(moduleRecord);
    for (const ctor of decorated) {
        const name = ctor[CHECK_HOOK_NAME]?.trim() || ctor.name;
        if (!name) {
            logger.error("checker class must have a non-empty @behavior3.check name");
            hasError = true;
            continue;
        }
        if (checkers.has(name)) {
            logger.error(`duplicate @behavior3.check registration: ${name}`);
            hasError = true;
            continue;
        }
        try {
            const instance = new ctor(env);
            if (typeof instance.validate !== "function") {
                logger.error(`checker '${name}' must provide a validate(value, ctx) method`);
                hasError = true;
                continue;
            }
            checkers.set(name, instance);
        } catch (error) {
            logger.error(`failed to instantiate checker '${name}'`, error);
            hasError = true;
        }
    }
    return { checkers, hasError, hasCheckers: decorated.length > 0 };
};

const normalizeNodeFieldVisibleResult = (result: NodeFieldVisibleResult): boolean =>
    result !== false;

const createNodeFieldVisibles = (
    moduleExports: unknown,
    env: BuildEnv
): { visibles: Map<string, NodeFieldVisible>; hasError: boolean; hasVisibles: boolean } => {
    const visibles = new Map<string, NodeFieldVisible>();
    let hasError = false;
    if (!moduleExports || typeof moduleExports !== "object") {
        return { visibles, hasError, hasVisibles: false };
    }

    const moduleRecord = moduleExports as Record<string, unknown>;
    const decorated = findDecoratedVisibleCtors(moduleRecord);
    for (const ctor of decorated) {
        const name = ctor[VISIBLE_HOOK_NAME]?.trim() || ctor.name;
        if (!name) {
            logger.error("visible class must have a non-empty @behavior3.visible name");
            hasError = true;
            continue;
        }
        if (visibles.has(name)) {
            logger.error(`duplicate @behavior3.visible registration: ${name}`);
            hasError = true;
            continue;
        }
        try {
            const instance = new ctor(env);
            if (typeof instance.visible !== "function") {
                logger.error(`visible '${name}' must provide a visible(value, ctx) method`);
                hasError = true;
                continue;
            }
            visibles.set(name, instance);
        } catch (error) {
            logger.error(`failed to instantiate visible '${name}'`, error);
            hasError = true;
        }
    }
    return { visibles, hasError, hasVisibles: decorated.length > 0 };
};

export const createNodeFieldVisibleRuntimeWithCheckModules = (
    buildScriptModule: unknown,
    checkScriptModules: CheckScriptModule[],
    env: BuildEnv
): { nodeFieldVisibles: Map<string, NodeFieldVisible>; hasError: boolean } => {
    const nodeFieldVisibles = new Map<string, NodeFieldVisible>();
    let hasError = false;
    const mergeModuleVisibles = (moduleExports: unknown) => {
        const visibleResult = createNodeFieldVisibles(moduleExports, env);
        hasError = hasError || visibleResult.hasError;
        for (const [name, visible] of visibleResult.visibles) {
            if (nodeFieldVisibles.has(name)) {
                logger.error(`duplicate @behavior3.visible registration: ${name}`);
                hasError = true;
                continue;
            }
            nodeFieldVisibles.set(name, visible);
        }
    };

    mergeModuleVisibles(buildScriptModule);
    for (const checkScript of checkScriptModules) {
        mergeModuleVisibles(checkScript.moduleExports);
    }

    return {
        nodeFieldVisibles,
        hasError,
    };
};

export type BuildScriptRuntime = {
    buildScript?: BuildScript;
    nodeFieldCheckers: Map<string, NodeFieldChecker>;
    hasError: boolean;
    hasEntries: boolean;
};

export type CheckScriptModule = {
    path: string;
    moduleExports: unknown;
};

export const createBuildScriptRuntime = (
    moduleExports: unknown,
    env: BuildEnv
): BuildScriptRuntime => {
    if (!moduleExports || typeof moduleExports !== "object") {
        return {
            nodeFieldCheckers: new Map(),
            hasError: false,
            hasEntries: false,
        };
    }

    const moduleRecord = moduleExports as Record<string, unknown>;
    const hasBuildHookCandidate =
        typeof moduleRecord.BuildHook === "function" ||
        typeof moduleRecord.Hook === "function" ||
        Object.values(moduleRecord).some(isDecoratedBuildHookCtor) ||
        (typeof moduleRecord.default === "function" &&
            !isDecoratedCheckCtor(moduleRecord.default) &&
            !isDecoratedBatchHookCtor(moduleRecord.default));
    const buildScript = createBuildHooks(moduleExports, env, false);
    const checkerResult = createNodeFieldCheckers(moduleExports, env);
    const hasEntries = Boolean(buildScript) || checkerResult.hasCheckers;
    if (!hasEntries) {
        logger.error(
            "build script must export a BuildHook class, Hook class, default build class, @behavior3.build class, or @behavior3.check class"
        );
    }
    return {
        buildScript,
        nodeFieldCheckers: checkerResult.checkers,
        hasError: checkerResult.hasError || !hasEntries || (hasBuildHookCandidate && !buildScript),
        hasEntries,
    };
};

export const createBuildScriptRuntimeWithCheckModules = (
    buildScriptModule: unknown,
    checkScriptModules: CheckScriptModule[],
    env: BuildEnv
): BuildScriptRuntime => {
    const runtime = createBuildScriptRuntime(buildScriptModule, env);
    const nodeFieldCheckers = new Map(runtime.nodeFieldCheckers);
    let hasError = runtime.hasError;
    let hasCheckEntries = false;

    for (const checkScript of checkScriptModules) {
        const checkerResult = createNodeFieldCheckers(checkScript.moduleExports, env);
        if (!checkerResult.hasCheckers) {
            // Mixed script folders can contain build or batch hooks alongside checkers.
            // Only actual @behavior3.check exports participate in field validation.
            continue;
        }
        hasCheckEntries = true;
        hasError = hasError || checkerResult.hasError;
        for (const [name, checker] of checkerResult.checkers) {
            if (nodeFieldCheckers.has(name)) {
                logger.error(`duplicate @behavior3.check registration: ${name}`);
                hasError = true;
                continue;
            }
            nodeFieldCheckers.set(name, checker);
        }
    }

    return {
        ...runtime,
        nodeFieldCheckers,
        hasError,
        hasEntries: runtime.hasEntries || hasCheckEntries,
    };
};

const materializedNodeToExpandedTreeData = (node: MaterializedTreeNode): NodeData => {
    const data = node.data;
    return {
        uuid: data.uuid,
        id: data.id,
        name: data.name,
        desc: data.desc,
        args: data.args ? { ...data.args } : undefined,
        input: data.input ? [...data.input] : undefined,
        output: data.output ? [...data.output] : undefined,
        debug: data.debug,
        disabled: data.disabled,
        path: data.path,
        $status: data.$status,
        children: node.children.map((child) => materializedNodeToExpandedTreeData(child)),
    };
};

const assignSequentialNodeIds = (node: NodeData, nextId = 1): number => {
    node.id = String(nextId);
    let currentId = nextId + 1;
    for (const child of node.children ?? []) {
        currentId = assignSequentialNodeIds(child, currentId);
    }
    return currentId;
};

const clearInternalKeys = (data: NodeData | TreeData) => {
    for (const key in data) {
        if (key === "uuid" || key === "overrides" || key.startsWith("$")) {
            delete data[key as keyof (NodeData | TreeData)];
        }
    }
};

export const createFileDataWithContext = (
    data: NodeData,
    includeSubtree: boolean | undefined,
    context: Pick<BuildContext, "nodeDefs" | "isSubtreeRoot">
): NodeData => {
    const nextArgs = data.args && Object.keys(data.args).length > 0 ? { ...data.args } : undefined;
    const nodeData: NodeData = {
        uuid: data.uuid,
        id: data.id,
        name: data.name,
        desc: data.desc || undefined,
        args: nextArgs,
        input: data.input || undefined,
        output: data.output || undefined,
        debug: data.debug || undefined,
        disabled: data.disabled || undefined,
        path: data.path || undefined,
    };
    const conf = context.nodeDefs.get(data.name);
    if (!conf?.input?.length) {
        nodeData.input = undefined;
    }
    if (!conf?.output?.length) {
        nodeData.output = undefined;
    }
    if (!conf?.args?.length) {
        nodeData.args = undefined;
    }

    // Subtree references normally keep only the reference path; build output can opt into expansion.
    if (data.children?.length && (includeSubtree || !context.isSubtreeRoot(data))) {
        nodeData.children = [];
        data.children.forEach((child) => {
            nodeData.children!.push(createFileDataWithContext(child, includeSubtree, context));
        });
    }
    return nodeData;
};

export const createBuildDataWithContext = async (
    treePath: string,
    context: Pick<BuildContext, "workdir" | "nodeDefs" | "dfs" | "isSubtreeRoot">
): Promise<TreeData | null> => {
    try {
        /**
         * Build output always expands subtree references into one concrete tree
         * snapshot first, then strips editor-only metadata before script hooks
         * and file writes see the result.
         */
        const content = getFs().readFileSync(treePath, "utf-8");
        const persistedTree = parsePersistedTreeContent(content, treePath);
        const subtreeSources = await loadSubtreeSourceCache({
            root: persistedTree.root,
            readContent: async (relativePath) => {
                try {
                    return getFs().readFileSync(`${context.workdir}/${relativePath}`, "utf-8");
                } catch {
                    return null;
                }
            },
        });

        const materializedRoot = materializePersistedTree({
            persistedTree,
            subtreeSources,
            nodeDefs: Array.from(context.nodeDefs.values()),
            subtreeEditable: true,
        });

        const treeModel: TreeData = {
            version: persistedTree.version,
            name: persistedTree.name,
            desc: persistedTree.desc,
            prefix: persistedTree.prefix,
            export: persistedTree.export,
            group: [...persistedTree.group],
            variables: {
                imports: [...persistedTree.variables.imports],
                locals: persistedTree.variables.locals.map((entry) => ({ ...entry })),
            },
            custom: { ...persistedTree.custom },
            overrides: { ...persistedTree.overrides },
            root: materializedNodeToExpandedTreeData(materializedRoot),
        };

        assignSequentialNodeIds(treeModel.root);
        context.dfs(treeModel.root, (node) => {
            node.id = treeModel.prefix + node.id;
        });
        treeModel.name = b3path.basenameWithoutExt(treePath);
        treeModel.root = createFileDataWithContext(treeModel.root, true, context);
        context.dfs(treeModel.root, (node) => clearInternalKeys(node));
        clearInternalKeys(treeModel);
        return treeModel;
    } catch (error) {
        logger.log("build error:", treePath, error);
    }
    return null;
};

export const processBatchTree = (
    tree: TreeData | null,
    treePath: string,
    batch: BatchScript,
    errors: string[]
) => {
    /** Tree hook runs before node recursion so it can replace or skip the root. */
    if (!tree) {
        return null;
    }
    if (batch.onProcessTree) {
        tree = batch.onProcessTree(tree, treePath, errors);
    }
    if (!tree) {
        return null;
    }
    if (batch.onProcessNode) {
        const processNode = (node: NodeData) => {
            if (node.children) {
                const children: NodeData[] = [];
                node.children.forEach((child) => {
                    const nextChild = processNode(child);
                    if (nextChild) {
                        children.push(nextChild);
                    }
                });
                node.children = children;
            }
            return batch.onProcessNode?.(node, errors);
        };
        tree.root = processNode(tree.root) ?? ({} as NodeData);
    }
    return tree;
};

export type NodeFieldCheckTarget = {
    node: NodeData;
    instanceKey?: string;
    treePath?: string | null;
};

export type NodeFieldCheckDiagnostic = {
    instanceKey?: string;
    nodeId: string;
    nodeName: string;
    fieldKind: NodeFieldKind;
    fieldName: string;
    fieldIndex?: number;
    checker: string;
    message: string;
};

export type NodeFieldVisibilityState = {
    args: Record<string, boolean>;
    input: Record<number, boolean>;
    output: Record<number, boolean>;
};

const createEmptyNodeFieldVisibilityState = (): NodeFieldVisibilityState => ({
    args: {},
    input: {},
    output: {},
});

const normalizeNodeFieldCheckResult = (result: NodeFieldCheckResult): string[] => {
    if (Array.isArray(result)) {
        return result.filter((entry) => typeof entry === "string" && entry.trim());
    }
    return typeof result === "string" && result.trim() ? [result] : [];
};

const formatRuntimeError = (error: unknown): string => {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
};

const walkTreeNodes = (node: NodeData, visit: (node: NodeData) => void): void => {
    visit(node);
    for (const child of node.children ?? []) {
        walkTreeNodes(child, visit);
    }
};

const buildNodeSlotField = (
    slot: NodeSlotDef,
    slotDefs: readonly NodeSlotDef[] | null | undefined,
    index: number
): NodeSlotField => {
    const parsed = parseSlotDefinition(slot, slotDefs, index);
    return {
        name: parsed.name,
        label: parsed.label,
        required: parsed.required,
        variadic: parsed.variadic,
        checker: parsed.checker,
        visible: parsed.visible,
    };
};

const getSlotValue = (
    values: string[] | undefined,
    slotDefs: readonly NodeSlotDef[] | null | undefined,
    index: number
): string | string[] | undefined => {
    const slotField = parseSlotDefinition(slotDefs?.[index] ?? "", slotDefs, index);
    return slotField.variadic ? (values?.slice(index) ?? []) : values?.[index];
};

const formatFieldLocator = (
    node: NodeData,
    fieldKind: NodeFieldKind,
    fieldName: string,
    fieldIndex?: number
) => {
    if (fieldKind === "arg") {
        return `${node.id}|${node.name}.${fieldName}`;
    }
    return `${node.id}|${node.name}.${fieldKind}[${fieldIndex ?? 0}:${fieldName}]`;
};

const getNodeSlotContext = (params: {
    fieldKind: "input" | "output";
    node: NodeData;
    tree: TreeData;
    nodeDef: NodeDef;
    slotDefs: readonly NodeSlotDef[] | null | undefined;
    slot: NodeSlotDef;
    index: number;
    treePath: string;
    env: BuildEnv;
}): NodeFieldCheckContext | null => {
    if (!isStructuredSlotDefinition(params.slot)) {
        return null;
    }
    return {
        node: params.node,
        tree: params.tree,
        nodeDef: params.nodeDef,
        fieldKind: params.fieldKind,
        fieldName: buildNodeSlotField(params.slot, params.slotDefs, params.index).name,
        fieldIndex: params.index,
        slot:
            params.fieldKind === "input"
                ? (params.slot as NodeInputSlot)
                : (params.slot as NodeOutputSlot),
        slotField: buildNodeSlotField(params.slot, params.slotDefs, params.index),
        treePath: params.treePath,
        env: params.env,
    };
};

const visitCustomNodeFields = (params: {
    node: NodeData;
    tree: TreeData;
    nodeDef: NodeDef;
    treePath: string;
    env: BuildEnv;
    onArg?: (entry: {
        fieldName: string;
        checkerName?: string;
        visibleName?: string;
        value: unknown;
        ctx: NodeFieldCheckContext;
    }) => void;
    onInput?: (entry: {
        fieldName: string;
        fieldIndex: number;
        checkerName?: string;
        visibleName?: string;
        value: unknown;
        ctx: NodeFieldVisibleContext;
    }) => void;
    onOutput?: (entry: {
        fieldName: string;
        fieldIndex: number;
        checkerName?: string;
        visibleName?: string;
        value: unknown;
        ctx: NodeFieldVisibleContext;
    }) => void;
}) => {
    for (const arg of params.nodeDef.args ?? []) {
        const checkerName = arg.checker?.trim() || undefined;
        const visibleName = arg.visible?.trim() || undefined;
        if (!(checkerName || visibleName)) {
            continue;
        }
        const ctx: NodeFieldCheckContext = {
            node: params.node,
            tree: params.tree,
            nodeDef: params.nodeDef,
            fieldKind: "arg",
            fieldName: arg.name,
            arg,
            treePath: params.treePath,
            env: params.env,
        };
        params.onArg?.({
            fieldName: arg.name,
            checkerName,
            visibleName,
            value: params.node.args?.[arg.name],
            ctx,
        });
    }

    for (const [fieldKind, slotDefs, values, visitor] of [
        ["input", params.nodeDef.input, params.node.input, params.onInput],
        ["output", params.nodeDef.output, params.node.output, params.onOutput],
    ] as const) {
        for (let index = 0; index < (slotDefs?.length ?? 0); index += 1) {
            const slot = slotDefs?.[index] ?? "";
            const slotField = buildNodeSlotField(slot, slotDefs, index);
            if (!(slotField.checker || slotField.visible)) {
                continue;
            }
            const ctx = getNodeSlotContext({
                fieldKind,
                node: params.node,
                tree: params.tree,
                nodeDef: params.nodeDef,
                slotDefs,
                slot,
                index,
                treePath: params.treePath,
                env: params.env,
            });
            if (!ctx) {
                continue;
            }
            visitor?.({
                fieldName: slotField.name,
                fieldIndex: index,
                checkerName: slotField.checker,
                visibleName: slotField.visible,
                value: getSlotValue(values, slotDefs, index),
                ctx,
            });
        }
    }
};

export const collectNodeFieldCheckDiagnostics = (params: {
    tree: TreeData;
    treePath: string;
    env: BuildEnv;
    checkers: ReadonlyMap<string, NodeFieldChecker>;
    targets?: NodeFieldCheckTarget[];
}): NodeFieldCheckDiagnostic[] => {
    const diagnostics: NodeFieldCheckDiagnostic[] = [];
    const targets = params.targets ?? [];
    const entries = targets.length
        ? targets
        : (() => {
              const collected: NodeFieldCheckTarget[] = [];
              walkTreeNodes(params.tree.root, (node) => collected.push({ node }));
              return collected;
          })();

    for (const target of entries) {
        const node = target.node;
        const nodeDef = params.env.nodeDefs.get(node.name);
        if (!nodeDef) {
            continue;
        }
        visitCustomNodeFields({
            node,
            tree: params.tree,
            nodeDef,
            treePath: target.treePath ?? params.treePath,
            env: params.env,
            onArg: ({ fieldName, checkerName, value, ctx }) => {
                if (!checkerName) {
                    return;
                }
                const pushDiagnostic = (message: string) => {
                    diagnostics.push({
                        instanceKey: target.instanceKey,
                        nodeId: node.id,
                        nodeName: node.name,
                        fieldKind: "arg",
                        fieldName,
                        checker: checkerName,
                        message,
                    });
                };
                const checker = params.checkers.get(checkerName);
                if (!checker) {
                    pushDiagnostic(`checker '${checkerName}' is not registered`);
                    return;
                }
                try {
                    const messages = normalizeNodeFieldCheckResult(checker.validate(value, ctx));
                    messages.forEach(pushDiagnostic);
                } catch (error) {
                    pushDiagnostic(`checker '${checkerName}' failed: ${formatRuntimeError(error)}`);
                }
            },
            onInput: ({ fieldName, fieldIndex, checkerName, value, ctx }) => {
                if (!checkerName) {
                    return;
                }
                const pushDiagnostic = (message: string) => {
                    diagnostics.push({
                        instanceKey: target.instanceKey,
                        nodeId: node.id,
                        nodeName: node.name,
                        fieldKind: "input",
                        fieldName,
                        fieldIndex,
                        checker: checkerName,
                        message,
                    });
                };
                const checker = params.checkers.get(checkerName);
                if (!checker) {
                    pushDiagnostic(`checker '${checkerName}' is not registered`);
                    return;
                }
                try {
                    const messages = normalizeNodeFieldCheckResult(checker.validate(value, ctx));
                    messages.forEach(pushDiagnostic);
                } catch (error) {
                    pushDiagnostic(`checker '${checkerName}' failed: ${formatRuntimeError(error)}`);
                }
            },
            onOutput: ({ fieldName, fieldIndex, checkerName, value, ctx }) => {
                if (!checkerName) {
                    return;
                }
                const pushDiagnostic = (message: string) => {
                    diagnostics.push({
                        instanceKey: target.instanceKey,
                        nodeId: node.id,
                        nodeName: node.name,
                        fieldKind: "output",
                        fieldName,
                        fieldIndex,
                        checker: checkerName,
                        message,
                    });
                };
                const checker = params.checkers.get(checkerName);
                if (!checker) {
                    pushDiagnostic(`checker '${checkerName}' is not registered`);
                    return;
                }
                try {
                    const messages = normalizeNodeFieldCheckResult(checker.validate(value, ctx));
                    messages.forEach(pushDiagnostic);
                } catch (error) {
                    pushDiagnostic(`checker '${checkerName}' failed: ${formatRuntimeError(error)}`);
                }
            },
        });
    }

    return diagnostics;
};

export const resolveNodeFieldVisibility = (params: {
    tree: TreeData;
    treePath: string;
    env: BuildEnv;
    visibles: ReadonlyMap<string, NodeFieldVisible>;
    target: NodeData;
    targetTreePath?: string | null;
}): NodeFieldVisibilityState => {
    const visibility = createEmptyNodeFieldVisibilityState();
    const node = params.target;
    const nodeDef = params.env.nodeDefs.get(node.name);
    if (!nodeDef) {
        return visibility;
    }

    visitCustomNodeFields({
        node,
        tree: params.tree,
        nodeDef,
        treePath: params.targetTreePath ?? params.treePath,
        env: params.env,
        onArg: ({ fieldName, visibleName, value, ctx }) => {
            if (!visibleName) {
                return;
            }
            const visible = params.visibles.get(visibleName);
            if (!visible) {
                params.env.logger.warn(
                    `visible '${visibleName}' is not registered for ${formatFieldLocator(node, "arg", fieldName)}`
                );
                return;
            }
            try {
                visibility.args[fieldName] = normalizeNodeFieldVisibleResult(
                    visible.visible(value, ctx)
                );
            } catch (error) {
                params.env.logger.warn(
                    `visible '${visibleName}' failed for ${formatFieldLocator(node, "arg", fieldName)}: ${formatRuntimeError(error)}`
                );
                visibility.args[fieldName] = true;
            }
        },
        onInput: ({ fieldName, fieldIndex, visibleName, value, ctx }) => {
            if (!visibleName) {
                return;
            }
            const visible = params.visibles.get(visibleName);
            if (!visible) {
                params.env.logger.warn(
                    `visible '${visibleName}' is not registered for ${formatFieldLocator(node, "input", fieldName, fieldIndex)}`
                );
                return;
            }
            try {
                visibility.input[fieldIndex] = normalizeNodeFieldVisibleResult(
                    visible.visible(value, ctx)
                );
            } catch (error) {
                params.env.logger.warn(
                    `visible '${visibleName}' failed for ${formatFieldLocator(node, "input", fieldName, fieldIndex)}: ${formatRuntimeError(error)}`
                );
                visibility.input[fieldIndex] = true;
            }
        },
        onOutput: ({ fieldName, fieldIndex, visibleName, value, ctx }) => {
            if (!visibleName) {
                return;
            }
            const visible = params.visibles.get(visibleName);
            if (!visible) {
                params.env.logger.warn(
                    `visible '${visibleName}' is not registered for ${formatFieldLocator(node, "output", fieldName, fieldIndex)}`
                );
                return;
            }
            try {
                visibility.output[fieldIndex] = normalizeNodeFieldVisibleResult(
                    visible.visible(value, ctx)
                );
            } catch (error) {
                params.env.logger.warn(
                    `visible '${visibleName}' failed for ${formatFieldLocator(node, "output", fieldName, fieldIndex)}: ${formatRuntimeError(error)}`
                );
                visibility.output[fieldIndex] = true;
            }
        },
    });

    return visibility;
};

export const formatNodeFieldCheckBuildDiagnostic = (
    diagnostic: NodeFieldCheckDiagnostic
): string =>
    diagnostic.fieldKind === "arg"
        ? `check ${diagnostic.nodeId}|${diagnostic.nodeName}: ${diagnostic.fieldName}: ${diagnostic.message}`
        : `check ${diagnostic.nodeId}|${diagnostic.nodeName}: ${diagnostic.fieldKind}[${diagnostic.fieldIndex ?? 0}:${diagnostic.fieldName}]: ${diagnostic.message}`;

export const syncFilesFromDiskWithContext = (
    files: Record<string, number>,
    parsedVarDecl: Record<string, unknown>,
    workdir: string
) => {
    /**
     * Rebuild the file mtime index from scratch before batch builds.
     * Var-decl caches key off these mtimes, so stale entries are worse than a
     * full refresh.
     */
    if (!hasFs()) {
        return;
    }
    for (const key of Object.keys(files)) {
        delete files[key];
    }
    for (const key of Object.keys(parsedVarDecl)) {
        delete parsedVarDecl[key];
    }

    const fsApi = getFs();
    const normalizedWorkdir = workdir.replace(/[/\\]+$/, "");
    if (!normalizedWorkdir) {
        return;
    }

    for (const absPath of b3path.lsdir(normalizedWorkdir, true)) {
        if (!absPath.endsWith(".json")) {
            continue;
        }
        const rel = b3path.posixPath(
            absPath.slice(normalizedWorkdir.length + 1).replace(/^[\\/]+/, "")
        );
        try {
            files[rel] = fsApi.statSync(absPath).mtimeMs;
        } catch {
            /* ignore */
        }
    }
};

const getOptionalRequire = (): OptionalRequire | undefined => {
    const candidate = (globalThis as typeof globalThis & { require?: unknown }).require;
    return candidate && typeof candidate === "function"
        ? (candidate as OptionalRequire)
        : undefined;
};

const runtimeTypeScriptExts = new Set([".ts", ".mts"]);

const isLocalRuntimeImport = (specifier: string) =>
    specifier.startsWith(".") || specifier.startsWith("/") || b3path.isAbsolute(specifier);

const hasFile = (filePath: string) => {
    try {
        return getFs().statSync(filePath).isFile();
    } catch {
        return false;
    }
};

const replaceFileExt = (filePath: string, ext: string) => {
    const currentExt = b3path.extname(filePath);
    return currentExt ? filePath.slice(0, -currentExt.length) + ext : filePath + ext;
};

const resolveRuntimeTypeScriptImport = (specifier: string, containingPath: string) => {
    if (!isLocalRuntimeImport(specifier)) {
        return null;
    }

    const resolvedPath = b3path.posixPath(
        b3path.resolve(b3path.dirname(containingPath), specifier)
    );
    const ext = b3path.extname(resolvedPath).toLowerCase();
    if (runtimeTypeScriptExts.has(ext)) {
        return hasFile(resolvedPath) ? resolvedPath : null;
    }

    if (ext === ".js") {
        const tsPath = replaceFileExt(resolvedPath, ".ts");
        return !hasFile(resolvedPath) && hasFile(tsPath) ? tsPath : null;
    }

    if (ext === ".mjs") {
        const mtsPath = replaceFileExt(resolvedPath, ".mts");
        return !hasFile(resolvedPath) && hasFile(mtsPath) ? mtsPath : null;
    }

    if (ext) {
        return null;
    }

    for (const candidate of [
        `${resolvedPath}.ts`,
        `${resolvedPath}.mts`,
        `${resolvedPath}/index.ts`,
        `${resolvedPath}/index.mts`,
    ]) {
        if (hasFile(candidate)) {
            return candidate;
        }
    }
    return null;
};

const toRuntimeImportSpecifier = (fromPath: string, toPath: string) => {
    let relativePath = b3path.posixPath(b3path.relative(b3path.dirname(fromPath), toPath));
    if (!relativePath.startsWith(".")) {
        relativePath = `./${relativePath}`;
    }
    return relativePath;
};

const activeRuntimeModulesBySource = new Map<string, Set<string>>();
const runtimeModuleSourceByPath = new Map<string, string>();

const registerActiveRuntimeModule = (sourcePath: string, modulePath: string) => {
    // TS build scripts are emitted to temporary ESM files next to their sources for dynamic import.
    const normalizedSourcePath = b3path.posixPath(sourcePath);
    const normalizedModulePath = b3path.posixPath(modulePath);
    let activeModules = activeRuntimeModulesBySource.get(normalizedSourcePath);
    if (!activeModules) {
        activeModules = new Set<string>();
        activeRuntimeModulesBySource.set(normalizedSourcePath, activeModules);
    }
    activeModules.add(normalizedModulePath);
    runtimeModuleSourceByPath.set(normalizedModulePath, normalizedSourcePath);
};

const unregisterActiveRuntimeModule = (modulePath: string) => {
    const normalizedModulePath = b3path.posixPath(modulePath);
    const sourcePath = runtimeModuleSourceByPath.get(normalizedModulePath);
    if (!sourcePath) {
        return;
    }

    runtimeModuleSourceByPath.delete(normalizedModulePath);
    const activeModules = activeRuntimeModulesBySource.get(sourcePath);
    if (!activeModules) {
        return;
    }

    activeModules.delete(normalizedModulePath);
    if (activeModules.size === 0) {
        activeRuntimeModulesBySource.delete(sourcePath);
    }
};

const cleanupRuntimeModules = (paths: string[]) => {
    for (const filePath of [...paths].reverse()) {
        try {
            getFs().unlinkSync(filePath);
        } catch {
            /* ignore temp file cleanup failure */
        }
        unregisterActiveRuntimeModule(filePath);
    }
};

const runtimeModuleBaseName = (sourcePath: string) =>
    b3path.basenameWithoutExt(sourcePath).replace(/[^a-zA-Z0-9._-]/g, "_") || "module";

const cleanupStaleRuntimeModulesForSource = (sourcePath: string) => {
    const fsApi = getFs();
    const normalizedSourcePath = b3path.posixPath(sourcePath);
    const dir = b3path.dirname(normalizedSourcePath);
    const base = runtimeModuleBaseName(normalizedSourcePath);
    const activeModules = activeRuntimeModulesBySource.get(normalizedSourcePath);
    let entries: string[];
    try {
        entries = fsApi.readdirSync(dir);
    } catch {
        return;
    }

    cleanupRuntimeModules(
        entries
            .filter((entry) => entry.startsWith(`${base}.runtime.`) && entry.endsWith(".mjs"))
            .map((entry) => b3path.join(dir, entry))
            .filter((entry) => !activeModules?.has(b3path.posixPath(entry)))
    );
};

const deferredRuntimeModuleCleanup = new Set<string>();
let runtimeModuleExitCleanupRegistered = false;
const decoratorGlobalState: DecoratorGlobalState = {
    depth: 0,
    hadBehavior3: false,
    previousBehavior3: undefined,
};

const getRuntimeProcess = (): RuntimeProcess | undefined => {
    const candidate = (globalThis as typeof globalThis & { process?: unknown }).process;
    return candidate && typeof candidate === "object" ? (candidate as RuntimeProcess) : undefined;
};

const applyBehavior3DecoratorGlobal = () => {
    const runtimeGlobal = globalThis as RuntimeGlobals;
    if (decoratorGlobalState.depth === 0) {
        // Decorators run at module evaluation time, so expose behavior3 only while loading scripts.
        decoratorGlobalState.hadBehavior3 = Object.prototype.hasOwnProperty.call(
            runtimeGlobal,
            "behavior3"
        );
        decoratorGlobalState.previousBehavior3 = runtimeGlobal.behavior3;
    }

    decoratorGlobalState.depth += 1;
    runtimeGlobal.behavior3 = {
        ...(decoratorGlobalState.previousBehavior3 &&
        typeof decoratorGlobalState.previousBehavior3 === "object"
            ? (decoratorGlobalState.previousBehavior3 as Record<string, unknown>)
            : {}),
        build: markBuildHook,
        batch: markBatchHook,
        check: markCheckHook,
        visible: markVisibleHook,
    };
};

const restoreBehavior3DecoratorGlobal = () => {
    if (decoratorGlobalState.depth === 0) {
        return;
    }

    decoratorGlobalState.depth -= 1;
    if (decoratorGlobalState.depth > 0) {
        return;
    }

    const runtimeGlobal = globalThis as RuntimeGlobals;
    if (decoratorGlobalState.hadBehavior3) {
        runtimeGlobal.behavior3 = decoratorGlobalState.previousBehavior3;
    } else {
        delete runtimeGlobal.behavior3;
    }
    decoratorGlobalState.hadBehavior3 = false;
    decoratorGlobalState.previousBehavior3 = undefined;
};

const withBehavior3ScriptDecoratorGlobal = async <T>(loader: () => Promise<T>): Promise<T> => {
    applyBehavior3DecoratorGlobal();
    try {
        return await loader();
    } finally {
        restoreBehavior3DecoratorGlobal();
    }
};

const deferRuntimeModuleCleanup = (paths: string[]) => {
    paths.forEach((filePath) => deferredRuntimeModuleCleanup.add(filePath));
    const runtimeProcess = getRuntimeProcess();
    if (!runtimeModuleExitCleanupRegistered && typeof runtimeProcess?.once === "function") {
        runtimeModuleExitCleanupRegistered = true;
        runtimeProcess.once("exit", flushDeferredRuntimeModuleCleanup);
        runtimeProcess.once("beforeExit", flushDeferredRuntimeModuleCleanup);
        const signalExitCodes: Record<string, number> = {
            SIGHUP: 129,
            SIGINT: 130,
            SIGTERM: 143,
        };
        Object.entries(signalExitCodes).forEach(([signal, exitCode]) => {
            runtimeProcess.once?.(signal, () => {
                flushDeferredRuntimeModuleCleanup();
                runtimeProcess.exit?.(exitCode);
            });
        });
    }
};

const flushDeferredRuntimeModuleCleanup = () => {
    const paths = Array.from(deferredRuntimeModuleCleanup);
    deferredRuntimeModuleCleanup.clear();
    cleanupRuntimeModules(paths);
};

const isBuildScriptDebugEnabled = () => {
    const value = getRuntimeProcess()?.env?.BEHAVIOR3_BUILD_DEBUG?.toLowerCase();
    return value === "1" || value === "true" || value === "yes";
};

const createRuntimeTypeScriptModuleGraph = (
    ts: TypeScriptApi,
    entryPath: string,
    debug: boolean
): { modulePath: string; cleanupPaths: string[] } => {
    const cleanupPaths: string[] = [];
    const emitted = new Map<string, string>();
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let moduleIndex = 0;

    const createTempModulePath = (sourcePath: string) => {
        cleanupStaleRuntimeModulesForSource(sourcePath);
        const base = runtimeModuleBaseName(sourcePath);
        const tempPath = b3path.join(
            b3path.dirname(sourcePath),
            `${base || "module"}.runtime.${runId}.${moduleIndex++}.mjs`
        );
        registerActiveRuntimeModule(sourcePath, tempPath);
        cleanupPaths.push(tempPath);
        return tempPath;
    };

    const emitModule = (sourcePath: string): string => {
        const normalizedSourcePath = b3path.posixPath(sourcePath);
        const existing = emitted.get(normalizedSourcePath);
        if (existing) {
            // De-duplicate shared imports so one source file has one temp runtime module per load.
            return existing;
        }

        const tempModulePath = createTempModulePath(normalizedSourcePath);
        emitted.set(normalizedSourcePath, tempModulePath);

        const rewriteImports: TypeScriptTransformerFactory = (context) => {
            const rewriteSpecifier = (specifier: string) => {
                const importedPath = resolveRuntimeTypeScriptImport(
                    specifier,
                    normalizedSourcePath
                );
                // Local TS imports are rewritten to their emitted .mjs companions.
                return importedPath
                    ? toRuntimeImportSpecifier(tempModulePath, emitModule(importedPath))
                    : null;
            };

            const visit = (node: TypeScriptNode): TypeScriptNode => {
                if (
                    ts.isImportDeclaration(node) &&
                    !node.importClause?.isTypeOnly &&
                    ts.isStringLiteral(node.moduleSpecifier)
                ) {
                    const nextSpecifier = rewriteSpecifier(node.moduleSpecifier.text);
                    if (nextSpecifier) {
                        return ts.factory.updateImportDeclaration(
                            node,
                            node.modifiers,
                            node.importClause,
                            ts.factory.createStringLiteral(nextSpecifier),
                            node.attributes
                        );
                    }
                }

                if (
                    ts.isExportDeclaration(node) &&
                    !node.isTypeOnly &&
                    node.moduleSpecifier &&
                    ts.isStringLiteral(node.moduleSpecifier)
                ) {
                    const nextSpecifier = rewriteSpecifier(node.moduleSpecifier.text);
                    if (nextSpecifier) {
                        return ts.factory.updateExportDeclaration(
                            node,
                            node.modifiers,
                            node.isTypeOnly,
                            node.exportClause,
                            ts.factory.createStringLiteral(nextSpecifier),
                            node.attributes
                        );
                    }
                }

                return ts.visitEachChild(node, visit, context);
            };

            return (sourceFile) => ts.visitNode(sourceFile, visit) as TypeScriptSourceFile;
        };

        const source = getFs().readFileSync(normalizedSourcePath, "utf8");
        const transpiled = ts.transpileModule(source, {
            compilerOptions: {
                module: ts.ModuleKind.ESNext,
                target: ts.ScriptTarget.ES2020,
                sourceMap: false,
                inlineSourceMap: debug,
                inlineSources: debug,
                removeComments: false,
                experimentalDecorators: true,
            },
            transformers: {
                before: [rewriteImports],
            },
            fileName: normalizedSourcePath,
        });
        getFs().writeFileSync(tempModulePath, transpiled.outputText, "utf8");
        return tempModulePath;
    };

    return {
        modulePath: emitModule(entryPath),
        cleanupPaths,
    };
};

export const loadRuntimeModule = async (modulePath: string, options?: { debug?: boolean }) => {
    let tempModulePath: string | null = null;
    let cleanupPaths: string[] = [];
    const debugBuildScript = options?.debug ?? isBuildScriptDebugEnabled();
    try {
        /**
         * Build scripts may be TS/JS/MJS and can be edited between runs.
         * We evict require cache, transpile TS module graphs when needed, and
         * load through a timestamped ESM path so every build sees the latest script.
         */
        const optionalRequire = getOptionalRequire();
        if (optionalRequire?.cache) {
            try {
                const resolvedPath = optionalRequire.resolve?.(modulePath);
                if (resolvedPath) {
                    delete optionalRequire.cache[resolvedPath];
                }
            } catch {
                /* path may not be in require cache */
            }
        }
        if (getRuntimeProcess()?.type === "renderer") {
            return await withBehavior3ScriptDecoratorGlobal(
                () => import(/* @vite-ignore */ `${modulePath}?t=${Date.now()}`)
            );
        }

        const ext = b3path.extname(modulePath).toLowerCase();
        if (ext === ".ts" || ext === ".mts") {
            const ts = await import("typescript");
            const runtimeModule = createRuntimeTypeScriptModuleGraph(
                ts,
                modulePath,
                debugBuildScript
            );
            tempModulePath = runtimeModule.modulePath;
            cleanupPaths = runtimeModule.cleanupPaths;
        } else if (ext === ".mjs") {
            tempModulePath = modulePath;
        } else if (ext === ".js") {
            tempModulePath = modulePath.replace(".js", `.runtime.${Date.now()}.mjs`);
            getFs().copyFileSync(modulePath, tempModulePath);
            cleanupPaths = [tempModulePath];
        } else {
            logger.error(`unsupported build script extension '${ext || "(none)"}': ${modulePath}`);
            return null;
        }

        const normalizedModulePath = b3path.posixPath(tempModulePath);
        const result = await withBehavior3ScriptDecoratorGlobal(
            () => import(/* @vite-ignore */ `file:///${normalizedModulePath}?t=${Date.now()}`)
        );
        if (debugBuildScript && cleanupPaths.length) {
            logger.info(
                `build script debug: keeping runtime modules until build completes:\n${cleanupPaths.join(
                    "\n"
                )}`
            );
            deferRuntimeModuleCleanup(cleanupPaths);
        } else {
            cleanupRuntimeModules(cleanupPaths);
        }
        return result;
    } catch (error) {
        logger.error(`failed to load module: ${modulePath}`, error);
        if (debugBuildScript && cleanupPaths.length) {
            logger.info(
                `build script debug: keeping runtime modules after load failure:\n${cleanupPaths.join(
                    "\n"
                )}`
            );
        } else {
            cleanupRuntimeModules(cleanupPaths);
        }
        return null;
    }
};

export const buildProjectWithContext = async (
    project: string,
    buildDir: string,
    context: BuildContext
) => {
    /**
     * Batch build walks every tree file under the project, materializes it with
     * current subtree/import context, validates the result, then writes the
     * exported JSON into the mirrored build directory.
     */
    if (hasFs()) {
        syncFilesFromDiskWithContext(context.files, context.parsedVarDecl, context.workdir);
    }

    let hasError = false;
    const settings = readWorkspaceSettings(project);
    const buildSetting = settings.buildScript;
    const checkScriptSetting = settings.checkScripts ?? [];
    let buildScriptModule: unknown;
    const checkScriptModules: CheckScriptModule[] = [];
    context.setCheckExpr(context.checkExprOverride ?? settings.checkExpr ?? true);
    if (buildSetting) {
        const scriptPath = context.workdir + "/" + buildSetting;
        try {
            buildScriptModule = await loadRuntimeModule(scriptPath, {
                debug: context.buildScriptDebug,
            });
        } catch {
            logger.error(`'${scriptPath}' is not a valid build script`);
        }
    }

    const checkScriptPaths = resolveCheckScriptPaths(context.workdir, checkScriptSetting);
    for (const pattern of checkScriptPaths.missingPatterns) {
        logger.error(`checkScripts pattern matched no files: ${pattern}`);
        hasError = true;
    }
    for (const scriptPath of checkScriptPaths.paths) {
        const moduleExports = await loadRuntimeModule(scriptPath, {
            debug: context.buildScriptDebug,
        });
        if (!moduleExports) {
            logger.error(`'${scriptPath}' is not a valid check script`);
            hasError = true;
            continue;
        }
        checkScriptModules.push({ path: scriptPath, moduleExports });
    }

    const scriptEnv: BuildEnv = {
        fs: getFs(),
        path: b3path,
        workdir: context.workdir,
        nodeDefs: context.nodeDefs,
        logger,
    };
    const buildRuntime = createBuildScriptRuntimeWithCheckModules(
        buildScriptModule,
        checkScriptModules,
        scriptEnv
    );
    if (buildSetting && (!buildScriptModule || buildRuntime.hasError)) {
        hasError = true;
    }

    const allErrors: string[] = [];
    for (const candidatePath of b3path.lsdir(b3path.dirname(project), true)) {
        if (!isBehaviorTreeJsonPath(candidatePath)) {
            continue;
        }

        const buildPath = buildDir + "/" + candidatePath.substring(context.workdir.length + 1);
        let tree = await createBuildDataWithContext(candidatePath, context);
        const errors: string[] = [];
        if (buildRuntime.buildScript) {
            tree = processBatchTree(tree, candidatePath, buildRuntime.buildScript, errors);
        }
        if (!tree) {
            continue;
        }
        if (tree.export === false) {
            logger.log("skip:", buildPath);
            continue;
        }
        logger.log("build:", buildPath);
        if (errors.length) {
            hasError = true;
        }
        const declare: FileVarDecl = {
            import: tree.variables.imports.map((importPath) => ({
                path: importPath,
                vars: [],
                depends: [],
            })),
            vars: tree.variables.locals.map((variable) => ({
                name: variable.name,
                desc: variable.desc,
            })),
            subtree: [],
        };
        context.refreshVarDecl(tree.root, tree.group, declare);
        if (!context.checkNodeData(tree.root, (message) => errors.push(message))) {
            hasError = true;
        }
        const checkDiagnostics = collectNodeFieldCheckDiagnostics({
            tree,
            treePath: candidatePath,
            env: scriptEnv,
            checkers: buildRuntime.nodeFieldCheckers,
        });
        if (checkDiagnostics.length) {
            hasError = true;
            checkDiagnostics.forEach((diagnostic) =>
                errors.push(formatNodeFieldCheckBuildDiagnostic(diagnostic))
            );
        }
        if (errors.length) {
            allErrors.push(`${candidatePath}:`);
            errors.forEach((message) => allErrors.push(`  ${message}`));
        }
        buildRuntime.buildScript?.onWriteFile?.(buildPath, tree);
        getFs().mkdirSync(b3path.dirname(buildPath), { recursive: true });
        getFs().writeFileSync(buildPath, stringifyJson(tree, { indent: 2 }));
    }

    allErrors.forEach((message) => logger.error(message));
    buildRuntime.buildScript?.onComplete?.(hasError ? "failure" : "success");
    flushDeferredRuntimeModuleCleanup();
    return hasError;
};

export const batchProcessProjectWithContext = async (
    project: string,
    scriptPath: string,
    context: BuildContext
): Promise<BatchProcessProjectResult> => {
    /**
     * Source batch processing rewrites persisted tree files in place, so it
     * stages all script-produced writes before touching disk.
     */
    if (hasFs()) {
        syncFilesFromDiskWithContext(context.files, context.parsedVarDecl, context.workdir);
    }

    let hasError = false;
    let totalFiles = 0;
    let unchangedFiles = 0;
    let skippedFiles = 0;
    let failedFiles = 0;
    let writtenFiles = 0;
    const allErrors: string[] = [];
    const stagedWrites: Array<{ path: string; tree: TreeData; content: string }> = [];

    let buildScriptModule: unknown;
    try {
        buildScriptModule = await loadRuntimeModule(scriptPath, {
            debug: context.buildScriptDebug,
        });
    } catch {
        logger.error(`'${scriptPath}' is not a valid batch script`);
    }

    const scriptEnv: BuildEnv = {
        fs: getFs(),
        path: b3path,
        workdir: context.workdir,
        nodeDefs: context.nodeDefs,
        logger,
    };
    const buildScript = createBatchHooks(buildScriptModule, scriptEnv);
    if (!buildScriptModule || !buildScript) {
        hasError = true;
    }

    try {
        if (!hasError || buildScript) {
            for (const candidatePath of b3path.lsdir(b3path.dirname(project), true)) {
                if (!isBehaviorTreeJsonPath(candidatePath)) {
                    continue;
                }

                totalFiles += 1;
                const treeName = b3path.basenameWithoutExt(candidatePath);
                const originalDiskContent = getFs().readFileSync(candidatePath, "utf-8");
                const originalTree = readTreeFromFile(candidatePath);
                const originalContent = writeTree(originalTree, treeName);
                const errors: string[] = [];
                let tree: TreeData | null = originalTree;

                try {
                    tree = processBatchTree(tree, candidatePath, buildScript!, errors);
                } catch (error) {
                    errors.push(`batch script failed: ${formatRuntimeError(error)}`);
                }

                if (!tree) {
                    logger.log("skip:", candidatePath);
                    skippedFiles += 1;
                    continue;
                }

                if (errors.length) {
                    hasError = true;
                    failedFiles += 1;
                    allErrors.push(`${candidatePath}:`);
                    errors.forEach((message) => allErrors.push(`  ${message}`));
                    continue;
                }

                const nextContent = writeTree(tree, treeName);
                const changedByScript = nextContent !== originalContent;
                const changedByInputUpgrade =
                    buildScript?.shouldUpgradeTree?.(candidatePath, tree) === true &&
                    nextContent !== originalDiskContent;
                if (!changedByScript && !changedByInputUpgrade) {
                    unchangedFiles += 1;
                    continue;
                }

                stagedWrites.push({
                    path: candidatePath,
                    tree,
                    content: nextContent,
                });
            }
        }

        if (!hasError) {
            for (const staged of stagedWrites) {
                try {
                    buildScript?.onWriteFile?.(staged.path, staged.tree);
                } catch (error) {
                    hasError = true;
                    failedFiles += 1;
                    allErrors.push(`${staged.path}:`);
                    allErrors.push(`  onWriteFile failed: ${formatRuntimeError(error)}`);
                    break;
                }
            }
        }

        if (!hasError) {
            for (const staged of stagedWrites) {
                logger.log("write:", staged.path);
                getFs().writeFileSync(staged.path, staged.content, "utf-8");
            }
            writtenFiles = stagedWrites.length;
        }
    } finally {
        allErrors.forEach((message) => logger.error(message));
        try {
            buildScript?.onComplete?.(hasError ? "failure" : "success");
        } catch (error) {
            logger.error("batch script onComplete failed", error);
        }
        flushDeferredRuntimeModuleCleanup();
    }

    return {
        hasError,
        totalFiles,
        stagedWriteFiles: stagedWrites.length,
        writtenFiles,
        unchangedFiles,
        skippedFiles,
        failedFiles,
    };
};
