import { computeNodeOverride } from "./misc/b3util";
import type {
    DocumentMutation,
    EditNode,
    NodeDef,
    PersistedNodeModel,
    PersistedTreeModel,
    UpdateNodeInput,
} from "./contracts";
import { parseWorkdirRelativeJsonPath } from "./protocol";
import { clonePersistedNode, clonePersistedTree, findPersistedNodeByStableId } from "./tree";

export type DocumentMutationReducerError =
    | { code: "invalid-json-path"; path: string }
    | { code: "missing-selected-node" }
    | { code: "selected-node-mismatch" }
    | { code: "missing-target-node" }
    | { code: "missing-subtree-original" }
    | { code: "missing-detached-subtree-root" };

export type DocumentMutationReducerResult =
    | { status: "noop" }
    | { status: "changed"; tree: PersistedTreeModel; rebuildGraph: boolean }
    | { status: "error"; error: DocumentMutationReducerError };

interface DocumentMutationReducerContext {
    tree: PersistedTreeModel;
    nodeDefs: NodeDef[];
    selectedNode?: EditNode | null;
}

const isJsonEqual = (left: unknown, right: unknown): boolean =>
    JSON.stringify(left) === JSON.stringify(right);

const cloneVars = <T extends { name: string }>(entries: T[]): T[] =>
    entries.map((entry) => ({ ...entry }));

const overwritePersistedNode = (target: PersistedNodeModel, source: PersistedNodeModel): void => {
    for (const key of Object.keys(target) as Array<keyof PersistedNodeModel>) {
        delete target[key];
    }
    Object.assign(target, source);
};

const getNodeDef = (nodeDefs: NodeDef[], name: string): NodeDef | null => {
    return nodeDefs.find((def) => def.name === name) ?? null;
};

const matchesSelectedNodeTarget = (selectedNode: EditNode, payload: UpdateNodeInput): boolean => {
    return (
        selectedNode.ref.structuralStableId === payload.target.structuralStableId &&
        selectedNode.ref.sourceStableId === payload.target.sourceStableId &&
        selectedNode.ref.sourceTreePath === payload.target.sourceTreePath
    );
};

const reduceUpdateTreeMeta = (
    mutation: Extract<DocumentMutation, { type: "updateTreeMeta" }>,
    tree: PersistedTreeModel
): DocumentMutationReducerResult => {
    const { payload } = mutation;
    const nextDesc = payload.desc?.trim() || undefined;
    const nextPrefix = payload.prefix ?? "";
    const nextExport = payload.export !== false;
    const nextGroup = [...payload.group];
    const nextVars = cloneVars(payload.variables.locals).sort((a, b) => a.name.localeCompare(b.name));
    const nextImportRefs: NonNullable<typeof tree.variables>["imports"] = [];

    for (const rawPath of payload.variables.imports) {
        const parsedPath = parseWorkdirRelativeJsonPath(rawPath);
        if (!parsedPath) {
            return {
                status: "error",
                error: { code: "invalid-json-path", path: rawPath },
            };
        }
        nextImportRefs.push(parsedPath);
    }

    nextImportRefs.sort((a, b) => a.localeCompare(b));

    if (
        tree.desc === nextDesc &&
        tree.prefix === nextPrefix &&
        (tree.export !== false) === nextExport &&
        isJsonEqual(tree.group, nextGroup) &&
        isJsonEqual(tree.variables.locals, nextVars) &&
        isJsonEqual(tree.variables.imports, nextImportRefs)
    ) {
        return { status: "noop" };
    }

    const nextTree = clonePersistedTree(tree);
    nextTree.desc = nextDesc;
    nextTree.prefix = nextPrefix;
    nextTree.export = nextExport;
    nextTree.group = nextGroup;
    nextTree.variables = {
        imports: nextImportRefs,
        locals: nextVars,
    };

    return {
        status: "changed",
        tree: nextTree,
        rebuildGraph: tree.prefix !== nextPrefix || !isJsonEqual(tree.group, nextGroup),
    };
};

const reduceUpdateNode = (
    mutation: Extract<DocumentMutation, { type: "updateNode" }>,
    context: DocumentMutationReducerContext
): DocumentMutationReducerResult => {
    const selectedNode = context.selectedNode;
    if (!selectedNode) {
        return {
            status: "error",
            error: { code: "missing-selected-node" },
        };
    }

    if (!matchesSelectedNodeTarget(selectedNode, mutation.payload)) {
        return {
            status: "error",
            error: { code: "selected-node-mismatch" },
        };
    }

    const { payload } = mutation;
    const nextName = String(payload.data.name ?? selectedNode.data.name).trim() || selectedNode.data.name;
    const nextNodeDef = getNodeDef(context.nodeDefs, nextName);
    const nextNodeDefDesc = nextNodeDef?.desc?.trim() || undefined;
    const nextDescRaw = payload.data.desc?.trim() || undefined;
    const nextDesc = nextDescRaw === nextNodeDefDesc ? undefined : nextDescRaw;
    const rawNextPath = payload.data.path?.trim() || undefined;

    let nextPath: PersistedNodeModel["path"];
    if (rawNextPath) {
        const parsedPath = parseWorkdirRelativeJsonPath(rawNextPath);
        if (!parsedPath) {
            return {
                status: "error",
                error: { code: "invalid-json-path", path: rawNextPath },
            };
        }
        nextPath = parsedPath;
    }

    const nextDebug = payload.data.debug ? true : undefined;
    const nextDisabled = payload.data.disabled ? true : undefined;
    const nextInput = payload.data.input;
    const nextOutput = payload.data.output;
    const nextArgs = payload.data.args;

    if (
        nextName === selectedNode.data.name &&
        nextDesc === selectedNode.data.desc &&
        nextPath === selectedNode.data.path &&
        nextDebug === selectedNode.data.debug &&
        nextDisabled === selectedNode.data.disabled &&
        isJsonEqual(nextInput ?? [], selectedNode.data.input ?? []) &&
        isJsonEqual(nextOutput ?? [], selectedNode.data.output ?? []) &&
        isJsonEqual(nextArgs ?? {}, selectedNode.data.args ?? {})
    ) {
        return { status: "noop" };
    }

    const tree = clonePersistedTree(context.tree);

    if (selectedNode.subtreeNode) {
        const original = selectedNode.subtreeOriginal;
        if (!original) {
            return {
                status: "error",
                error: { code: "missing-subtree-original" },
            };
        }

        const editedNode: PersistedNodeModel = {
            uuid: selectedNode.ref.sourceStableId,
            id: selectedNode.ref.displayId,
            name: nextName,
            desc: nextDesc,
            args: nextArgs,
            input: nextInput,
            output: nextOutput,
            debug: nextDebug,
            disabled: nextDisabled,
            path: selectedNode.data.path,
        };

        const diff = computeNodeOverride(
            original as never,
            editedNode as never,
            { args: nextNodeDef?.args } as { args?: NodeDef["args"] } as never
        );

        if (diff) {
            tree.overrides[payload.target.sourceStableId] = diff;
        } else {
            delete tree.overrides[payload.target.sourceStableId];
        }

        return {
            status: "changed",
            tree,
            rebuildGraph: true,
        };
    }

    const node = findPersistedNodeByStableId(tree.root, payload.target.structuralStableId);
    if (!node) {
        return {
            status: "error",
            error: { code: "missing-target-node" },
        };
    }

    const isDetachingSubtree = Boolean(selectedNode.data.path) && !payload.data.path;
    if (isDetachingSubtree) {
        const detachedRoot = payload.detachedSubtreeRoot;
        if (!detachedRoot) {
            return {
                status: "error",
                error: { code: "missing-detached-subtree-root" },
            };
        }

        const detached = clonePersistedNode(detachedRoot);
        detached.name = nextName;
        detached.desc = nextDesc;
        detached.args = nextArgs;
        detached.input = nextInput;
        detached.output = nextOutput;
        detached.debug = nextDebug;
        detached.disabled = nextDisabled;
        detached.path = undefined;
        overwritePersistedNode(node, detached);
    } else {
        node.name = nextName;
        node.desc = nextDesc;
        node.args = nextArgs;
        node.input = nextInput;
        node.output = nextOutput;
        node.debug = nextDebug;
        node.disabled = nextDisabled;
        node.path = nextPath;
        if (nextPath && nextPath !== selectedNode.data.path) {
            node.children = undefined;
        }
    }

    return {
        status: "changed",
        tree,
        rebuildGraph: true,
    };
};

export const reduceDocumentMutation = (
    mutation: DocumentMutation,
    context: DocumentMutationReducerContext
): DocumentMutationReducerResult => {
    switch (mutation.type) {
        case "updateTreeMeta":
            return reduceUpdateTreeMeta(mutation, context.tree);

        case "updateNode":
            return reduceUpdateNode(mutation, context);
    }
};

export const formatDocumentMutationReducerError = (
    error: DocumentMutationReducerError,
    language: "zh" | "en"
): string => {
    switch (error.code) {
        case "invalid-json-path":
            return language === "zh"
                ? `无效的 JSON 路径: ${error.path}`
                : `Invalid JSON path: ${error.path}`;

        case "missing-selected-node":
            return language === "zh"
                ? "当前没有可用于提交此修改的选中节点。"
                : "No selected node is available for this mutation.";

        case "selected-node-mismatch":
            return language === "zh"
                ? "当前选中节点已变化，请重试。"
                : "The selected node changed before the mutation was applied.";

        case "missing-target-node":
            return language === "zh"
                ? "未找到目标节点，请重试。"
                : "The target node could not be found.";

        case "missing-subtree-original":
            return language === "zh"
                ? "缺少 subtree 原始节点快照，请重试。"
                : "Missing subtree original snapshot for this mutation.";

        case "missing-detached-subtree-root":
            return language === "zh"
                ? "缺少用于解绑 subtree 引用的快照，请重试。"
                : "Missing detached subtree snapshot for this mutation.";
    }
};
