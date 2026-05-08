import { computeNodeOverride } from "./misc/b3util";
import { generateUuid } from "./stable-id";
import type {
    DocumentMutation,
    EditNode,
    NodeDef,
    PersistedNodeModel,
    PersistedTreeModel,
    UpdateNodeInput,
} from "./contracts";
import { isJsonEqual } from "./equality";
import { parseWorkdirRelativeJsonPath } from "./protocol";
import {
    cloneJsonValue,
    clonePersistedNode,
    clonePersistedTree,
    findPersistedNodeByStableId,
} from "./tree";

// Internal reducer follow-up selection consumed by the host session only.
export type DocumentMutationSelection =
    | { kind: "tree" }
    | { kind: "node"; structuralStableId: string };

export type DocumentMutationReducerError =
    | { code: "invalid-json-path"; path: string }
    | { code: "missing-selected-node" }
    | { code: "selected-node-mismatch" }
    | { code: "missing-target-node" }
    | { code: "missing-source-node" }
    | { code: "missing-subtree-original" }
    | { code: "missing-detached-subtree-root" }
    | { code: "move-root-denied" }
    | { code: "drop-around-root-denied" }
    | { code: "add-child-to-subtree-ref-denied" }
    | { code: "move-into-descendant-denied" }
    | { code: "delete-root-node-denied" }
    | { code: "edit-subtree-denied" };

export type DocumentMutationReducerResult =
    | { status: "noop" }
    | {
          status: "changed";
          tree: PersistedTreeModel;
          rebuildGraph: boolean;
          nextSelection?: DocumentMutationSelection;
      }
    | { status: "error"; error: DocumentMutationReducerError };

export type ReducibleDocumentMutation = Extract<
    DocumentMutation,
    | { type: "updateTreeMeta" }
    | { type: "updateNode" }
    | { type: "performDrop" }
    | { type: "pasteNode" }
    | { type: "insertNode" }
    | { type: "replaceNode" }
    | { type: "deleteNode" }
>;

interface DocumentMutationReducerContext {
    tree: PersistedTreeModel;
    nodeDefs: NodeDef[];
    selectedNode?: EditNode | null;
}

const cloneVars = <T extends { name: string }>(entries: T[]): T[] =>
    entries.map((entry) => ({ ...entry }));

const overwritePersistedNode = (target: PersistedNodeModel, source: PersistedNodeModel): void => {
    // Preserve the object reference held by the cloned tree while replacing every persisted field.
    for (const key of Object.keys(target) as Array<keyof PersistedNodeModel>) {
        delete target[key];
    }
    Object.assign(target, source);
};

const findPersistedNodeLocationByStableId = (
    root: PersistedNodeModel,
    stableId: string
): { node: PersistedNodeModel; parent: PersistedNodeModel | null } | null => {
    let found: { node: PersistedNodeModel; parent: PersistedNodeModel | null } | null = null;

    const walk = (node: PersistedNodeModel, parent: PersistedNodeModel | null): void => {
        if (found) {
            return;
        }

        if (node.uuid === stableId) {
            found = { node, parent };
            return;
        }

        for (const child of node.children ?? []) {
            walk(child, node);
        }
    };

    walk(root, null);
    return found;
};

const isDescendantStableId = (
    root: PersistedNodeModel,
    ancestorStableId: string,
    targetStableId: string
): boolean => {
    const ancestor = findPersistedNodeByStableId(root, ancestorStableId);
    if (!ancestor) {
        return false;
    }

    let found = false;
    const walk = (node: PersistedNodeModel): void => {
        if (found) {
            return;
        }

        if (node.uuid === targetStableId) {
            found = true;
            return;
        }

        for (const child of node.children ?? []) {
            walk(child);
        }
    };

    for (const child of ancestor.children ?? []) {
        walk(child);
    }

    return found;
};

const assignFreshStableIds = (node: PersistedNodeModel): void => {
    node.uuid = generateUuid();
    for (const child of node.children ?? []) {
        assignFreshStableIds(child);
    }
};

const getNodeDef = (nodeDefs: NodeDef[], name: string): NodeDef | null => {
    return nodeDefs.find((def) => def.name === name) ?? null;
};

const matchesSelectedNodeTarget = (selectedNode: EditNode, payload: UpdateNodeInput): boolean => {
    // Inspector edits are rejected if selection moved between render and commit.
    return (
        selectedNode.ref.structuralStableId === payload.target.structuralStableId &&
        selectedNode.ref.sourceStableId === payload.target.sourceStableId &&
        selectedNode.ref.sourceTreePath === payload.target.sourceTreePath
    );
};

const resolveUpdateNodeSnapshot = (
    payload: UpdateNodeInput,
    context: DocumentMutationReducerContext
):
    | {
          data: PersistedNodeModel;
          subtreeNode: boolean;
          subtreeOriginal?: PersistedNodeModel;
      }
    | { error: DocumentMutationReducerError } => {
    if (payload.currentNodeSnapshot) {
        return payload.currentNodeSnapshot;
    }

    const selectedNode = context.selectedNode;
    if (!selectedNode) {
        return {
            error: { code: "missing-selected-node" },
        };
    }

    if (!matchesSelectedNodeTarget(selectedNode, payload)) {
        return {
            error: { code: "selected-node-mismatch" },
        };
    }

    return {
        data: selectedNode.data,
        subtreeNode: selectedNode.subtreeNode,
        subtreeOriginal: selectedNode.subtreeOriginal,
    };
};

const reduceUpdateTreeMeta = (
    mutation: Extract<ReducibleDocumentMutation, { type: "updateTreeMeta" }>,
    tree: PersistedTreeModel
): DocumentMutationReducerResult => {
    const { payload } = mutation;
    const nextDesc = payload.desc?.trim() || undefined;
    const nextPrefix = payload.prefix ?? "";
    const nextExport = payload.export !== false;
    const nextGroup = [...payload.group];
    const nextCustom = payload.custom
        ? cloneJsonValue(payload.custom)
        : cloneJsonValue(tree.custom);
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
        isJsonEqual(tree.custom, nextCustom) &&
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
    nextTree.custom = nextCustom;
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
    mutation: Extract<ReducibleDocumentMutation, { type: "updateNode" }>,
    context: DocumentMutationReducerContext
): DocumentMutationReducerResult => {
    const selectedNode = resolveUpdateNodeSnapshot(mutation.payload, context);
    if ("error" in selectedNode) {
        return {
            status: "error",
            error: selectedNode.error,
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
        // External subtree nodes are not edited in-place; the main tree stores a sparse override.
        const original = selectedNode.subtreeOriginal;
        if (!original) {
            return {
                status: "error",
                error: { code: "missing-subtree-original" },
            };
        }

        const editedNode: PersistedNodeModel = {
            uuid: payload.target.sourceStableId,
            id: payload.target.displayId,
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
        // Removing a subtree path turns the materialized external root back into inline data.
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

const reducePerformDrop = (
    mutation: Extract<ReducibleDocumentMutation, { type: "performDrop" }>,
    tree: PersistedTreeModel
): DocumentMutationReducerResult => {
    if (mutation.payload.source.structuralStableId === mutation.payload.target.structuralStableId) {
        return { status: "noop" };
    }

    const nextTree = clonePersistedTree(tree);
    const sourceLocation = findPersistedNodeLocationByStableId(
        nextTree.root,
        mutation.payload.source.structuralStableId
    );
    if (!sourceLocation) {
        return { status: "error", error: { code: "missing-source-node" } };
    }

    const targetLocation = findPersistedNodeLocationByStableId(
        nextTree.root,
        mutation.payload.target.structuralStableId
    );
    if (!targetLocation) {
        return { status: "error", error: { code: "missing-target-node" } };
    }

    if (sourceLocation.parent === null) {
        return { status: "error", error: { code: "move-root-denied" } };
    }

    if (
        (mutation.payload.position === "before" || mutation.payload.position === "after") &&
        targetLocation.parent === null
    ) {
        return { status: "error", error: { code: "drop-around-root-denied" } };
    }

    if (mutation.payload.position === "child" && targetLocation.node.path) {
        return { status: "error", error: { code: "add-child-to-subtree-ref-denied" } };
    }

    if (isDescendantStableId(nextTree.root, sourceLocation.node.uuid, targetLocation.node.uuid)) {
        return { status: "error", error: { code: "move-into-descendant-denied" } };
    }

    const sourceSiblings = sourceLocation.parent.children ?? [];
    const sourceIndex = sourceSiblings.findIndex((entry) => entry.uuid === sourceLocation.node.uuid);
    if (sourceIndex < 0) {
        return { status: "error", error: { code: "missing-source-node" } };
    }

    const [movedNode] = sourceSiblings.splice(sourceIndex, 1);
    if (!movedNode) {
        return { status: "error", error: { code: "missing-source-node" } };
    }

    if (mutation.payload.position === "child") {
        targetLocation.node.children ||= [];
        targetLocation.node.children.push(movedNode);
    } else {
        const targetParent = targetLocation.parent;
        if (!targetParent?.children) {
            return { status: "error", error: { code: "missing-target-node" } };
        }

        const targetIndex = targetParent.children.findIndex(
            (entry) => entry.uuid === targetLocation.node.uuid
        );
        if (targetIndex < 0) {
            return { status: "error", error: { code: "missing-target-node" } };
        }

        targetParent.children.splice(
            mutation.payload.position === "before" ? targetIndex : targetIndex + 1,
            0,
            movedNode
        );
    }

    return {
        status: "changed",
        tree: nextTree,
        rebuildGraph: true,
        nextSelection: { kind: "node", structuralStableId: movedNode.uuid },
    };
};

const reducePasteNode = (
    mutation: Extract<ReducibleDocumentMutation, { type: "pasteNode" }>,
    tree: PersistedTreeModel
): DocumentMutationReducerResult => {
    const nextTree = clonePersistedTree(tree);
    const targetNode = findPersistedNodeByStableId(
        nextTree.root,
        mutation.payload.target.structuralStableId
    );
    if (!targetNode) {
        return { status: "error", error: { code: "missing-target-node" } };
    }
    if (targetNode.path) {
        return { status: "error", error: { code: "edit-subtree-denied" } };
    }

    const nextNode = clonePersistedNode(mutation.payload.snapshot);
    assignFreshStableIds(nextNode);
    targetNode.children ||= [];
    targetNode.children.push(nextNode);

    return {
        status: "changed",
        tree: nextTree,
        rebuildGraph: true,
        nextSelection: { kind: "node", structuralStableId: nextNode.uuid },
    };
};

const reduceInsertNode = (
    mutation: Extract<ReducibleDocumentMutation, { type: "insertNode" }>,
    tree: PersistedTreeModel
): DocumentMutationReducerResult => {
    const nextTree = clonePersistedTree(tree);
    const targetNode = findPersistedNodeByStableId(
        nextTree.root,
        mutation.payload.target.structuralStableId
    );
    if (!targetNode) {
        return { status: "error", error: { code: "missing-target-node" } };
    }
    if (targetNode.path) {
        return { status: "error", error: { code: "edit-subtree-denied" } };
    }

    const nextNode: PersistedNodeModel = {
        uuid: generateUuid(),
        id: "",
        name: "unknown",
    };
    targetNode.children ||= [];
    targetNode.children.push(nextNode);

    return {
        status: "changed",
        tree: nextTree,
        rebuildGraph: true,
        nextSelection: { kind: "node", structuralStableId: nextNode.uuid },
    };
};

const reduceReplaceNode = (
    mutation: Extract<ReducibleDocumentMutation, { type: "replaceNode" }>,
    tree: PersistedTreeModel
): DocumentMutationReducerResult => {
    const nextTree = clonePersistedTree(tree);
    const targetNode = findPersistedNodeByStableId(
        nextTree.root,
        mutation.payload.target.structuralStableId
    );
    if (!targetNode) {
        return { status: "error", error: { code: "missing-target-node" } };
    }
    if (targetNode.path) {
        return { status: "error", error: { code: "edit-subtree-denied" } };
    }

    const replacement = clonePersistedNode(mutation.payload.snapshot);
    // Preserve the target identity so existing selections/edges still point at the replaced slot.
    replacement.uuid = targetNode.uuid;
    for (const child of replacement.children ?? []) {
        // Children are copied content and must not alias nodes from their source tree.
        assignFreshStableIds(child);
    }
    if (replacement.path) {
        replacement.children = undefined;
    }
    overwritePersistedNode(targetNode, replacement);

    return {
        status: "changed",
        tree: nextTree,
        rebuildGraph: true,
        nextSelection: { kind: "node", structuralStableId: replacement.uuid },
    };
};

const reduceDeleteNode = (
    mutation: Extract<ReducibleDocumentMutation, { type: "deleteNode" }>,
    tree: PersistedTreeModel
): DocumentMutationReducerResult => {
    const nextTree = clonePersistedTree(tree);
    const location = findPersistedNodeLocationByStableId(
        nextTree.root,
        mutation.payload.target.structuralStableId
    );
    if (!location) {
        return { status: "error", error: { code: "missing-target-node" } };
    }
    if (location.parent === null) {
        return { status: "error", error: { code: "delete-root-node-denied" } };
    }

    location.parent.children = (location.parent.children ?? []).filter(
        (entry) => entry.uuid !== location.node.uuid
    );

    return {
        status: "changed",
        tree: nextTree,
        rebuildGraph: true,
        nextSelection: { kind: "node", structuralStableId: location.parent.uuid },
    };
};

export const isReducibleDocumentMutation = (
    mutation: DocumentMutation
): mutation is ReducibleDocumentMutation =>
    mutation.type === "updateTreeMeta" ||
    mutation.type === "updateNode" ||
    mutation.type === "performDrop" ||
    mutation.type === "pasteNode" ||
    mutation.type === "insertNode" ||
    mutation.type === "replaceNode" ||
    mutation.type === "deleteNode";

export const reduceDocumentMutation = (
    mutation: ReducibleDocumentMutation,
    context: DocumentMutationReducerContext
): DocumentMutationReducerResult => {
    switch (mutation.type) {
        case "updateTreeMeta":
            return reduceUpdateTreeMeta(mutation, context.tree);

        case "updateNode":
            return reduceUpdateNode(mutation, context);

        case "performDrop":
            return reducePerformDrop(mutation, context.tree);

        case "pasteNode":
            return reducePasteNode(mutation, context.tree);

        case "insertNode":
            return reduceInsertNode(mutation, context.tree);

        case "replaceNode":
            return reduceReplaceNode(mutation, context.tree);

        case "deleteNode":
            return reduceDeleteNode(mutation, context.tree);
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

        case "missing-source-node":
            return language === "zh"
                ? "未找到源节点，请重试。"
                : "The source node could not be found.";

        case "missing-subtree-original":
            return language === "zh"
                ? "缺少 subtree 原始节点快照，请重试。"
                : "Missing subtree original snapshot for this mutation.";

        case "missing-detached-subtree-root":
            return language === "zh"
                ? "缺少用于解绑 subtree 引用的快照，请重试。"
                : "Missing detached subtree snapshot for this mutation.";

        case "move-root-denied":
            return language === "zh" ? "不能移动根节点。" : "Cannot move the root node.";

        case "drop-around-root-denied":
            return language === "zh"
                ? "不能围绕根节点插入。"
                : "Cannot drop before or after the root node.";

        case "add-child-to-subtree-ref-denied":
            return language === "zh"
                ? "不能直接向 subtree 引用添加子节点。"
                : "Cannot add a child directly to a subtree reference.";

        case "move-into-descendant-denied":
            return language === "zh"
                ? "不能移动到自己的后代下。"
                : "Cannot move a node into its own descendant.";

        case "delete-root-node-denied":
            return language === "zh" ? "不能删除根节点。" : "Cannot delete the root node.";

        case "edit-subtree-denied":
            return language === "zh"
                ? "不能在 subtree 引用上直接修改结构。"
                : "Cannot edit structure on a subtree reference.";
    }
};
