import { generateUuid } from "./stable-id";
import { DOCUMENT_VERSION } from "./b3type";
import type {
    DocumentMutation,
    EditNode,
    NodeDef,
    PersistedNodeModel,
    PersistedNodeOverride,
    PersistedTreeModel,
    UpdateNodeInput,
} from "./contracts";
import { isJsonEqual } from "./json";
import { getNodeArgOverrideCompareValue } from "./node-overrides";
import { createNodeDefMap, findNodeDef, parseSlotDefinition } from "./node-utils";
import { parseWorkdirRelativeJsonPath } from "./protocol";
import { translateRuntimeMessage, type SupportedLanguage } from "./runtime-i18n";
import {
    CONDITION_TYPE_CUSTOM_KEY,
    createConditionData,
    DEFAULT_CONDITION_TYPE,
    ensureConditionTypeCustom,
    findConditionBranchViolation,
    findEnclosingConditionBranch,
    nodeDefReturnsRunning,
    readConditionType,
    treeUsesConditions,
} from "./condition-branch";
import {
    cloneJsonValue,
    clonePersistedConditions,
    clonePersistedNode,
    clonePersistedTree,
    findPersistedNodeByStableId,
} from "./tree";

export const compareDocumentVersion = (left: string, right: string): number => {
    const leftParts = left.split(".").map(Number);
    const rightParts = right.split(".").map(Number);

    for (let index = 0; index < 3; index += 1) {
        const leftPart = leftParts[index] ?? 0;
        const rightPart = rightParts[index] ?? 0;

        if (leftPart > rightPart) {
            return 1;
        }
        if (leftPart < rightPart) {
            return -1;
        }
    }

    return 0;
};

export const isDocumentVersionNewer = (fileVersion: string): boolean => {
    return compareDocumentVersion(fileVersion, DOCUMENT_VERSION) > 0;
};

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
    | { code: "edit-subtree-denied" }
    | { code: "condition-already-attached" }
    | { code: "condition-not-attached" }
    | { code: "condition-clear-denied" }
    | { code: "condition-running-status" }
    | { code: "condition-nested" }
    | { code: "missing-node-def" };

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
    | { type: "attachCondition" }
    | { type: "removeCondition" }
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

const conditionViolationResult = (
    violation: ReturnType<typeof findConditionBranchViolation>
): DocumentMutationReducerResult | null => {
    if (violation === "nested-condition") {
        return { status: "error", error: { code: "condition-nested" } };
    }
    if (violation === "running-status") {
        return { status: "error", error: { code: "condition-running-status" } };
    }
    return null;
};

const touchedConditionError = (
    tree: PersistedTreeModel,
    nodeDefs: NodeDef[],
    stableIds: Array<string | undefined>
): DocumentMutationReducerResult | null => {
    for (const stableId of stableIds) {
        if (!stableId) {
            continue;
        }
        const branch = findEnclosingConditionBranch(tree.root, stableId);
        if (!branch) {
            continue;
        }
        const violation = conditionViolationResult(
            findConditionBranchViolation(branch, nodeDefs)
        );
        if (violation) {
            return violation;
        }
    }
    return null;
};

const assignFreshStableIds = (node: PersistedNodeModel): void => {
    node.uuid = generateUuid();
    for (const condition of node.conditions ?? []) {
        assignFreshStableIds(condition.root);
    }
    for (const child of node.children ?? []) {
        assignFreshStableIds(child);
    }
};

const getNodeDef = (nodeDefs: NodeDef[], name: string): NodeDef | null => {
    return findNodeDef(createNodeDefMap(nodeDefs), name);
};

const toOptionalBoolean = (value: unknown): boolean | undefined =>
    typeof value === "boolean" ? value : undefined;

const hasBooleanStateChanged = (
    left: boolean | undefined,
    right: boolean | undefined
): boolean => Boolean(left) !== Boolean(right);

const computeNodeOverride = (
    original: PersistedNodeModel,
    edited: PersistedNodeModel,
    def: Pick<NodeDef, "args"> | null | undefined
): PersistedNodeOverride | null => {
    const diff: PersistedNodeOverride = {};
    let hasDiff = false;

    if ((edited.desc || undefined) !== (original.desc || undefined)) {
        diff.desc = edited.desc || undefined;
        hasDiff = true;
    }

    if (hasBooleanStateChanged(edited.debug, original.debug)) {
        diff.debug = Boolean(edited.debug);
        hasDiff = true;
    }

    if (hasBooleanStateChanged(edited.disabled, original.disabled)) {
        diff.disabled = Boolean(edited.disabled);
        hasDiff = true;
    }

    if (def?.args?.length) {
        const diffArgs: Record<string, unknown> = {};
        for (const arg of def.args) {
            const originalValue = getNodeArgOverrideCompareValue(original.args, arg);
            const editedValue = getNodeArgOverrideCompareValue(edited.args, arg);
            if (!isJsonEqual(originalValue, editedValue)) {
                diffArgs[arg.name] = editedValue;
            }
        }
        if (Object.keys(diffArgs).length > 0) {
            diff.args = diffArgs;
            hasDiff = true;
        }
    }

    const originalInput = (original.input ?? []).filter(Boolean);
    const editedInput = (edited.input ?? []).filter(Boolean);
    if (!isJsonEqual(originalInput, editedInput)) {
        diff.input = editedInput.length ? edited.input : undefined;
        hasDiff = true;
    }

    const originalOutput = (original.output ?? []).filter(Boolean);
    const editedOutput = (edited.output ?? []).filter(Boolean);
    if (!isJsonEqual(originalOutput, editedOutput)) {
        diff.output = editedOutput.length ? edited.output : undefined;
        hasDiff = true;
    }

    // An override can replace subtree conditions but never clear them (see reduceRemoveCondition).
    if (!isJsonEqual(original.conditions ?? [], edited.conditions ?? []) && edited.conditions?.length) {
        diff.conditions = clonePersistedConditions(edited.conditions);
        hasDiff = true;
    }

    return hasDiff ? diff : null;
};

const pruneNodeArgsByDefinition = (
    args: PersistedNodeModel["args"],
    nodeDef: NodeDef | null
): PersistedNodeModel["args"] => {
    if (!args || !nodeDef) {
        return args;
    }

    const argDefs = nodeDef.args ?? [];
    if (argDefs.length === 0) {
        return undefined;
    }

    const declaredNames = new Set(argDefs.map((arg) => arg.name));
    const nextEntries = Object.entries(args).filter(([argName]) => declaredNames.has(argName));
    if (nextEntries.length === Object.keys(args).length) {
        return args;
    }

    return nextEntries.length > 0 ? Object.fromEntries(nextEntries) : undefined;
};

const pruneNodeSlotsByDefinition = (
    slots: PersistedNodeModel["input"] | PersistedNodeModel["output"],
    slotDefs: NodeDef["input"] | NodeDef["output"] | undefined
): string[] | undefined => {
    if (!slots) {
        return slots;
    }

    if (!slotDefs?.length) {
        return undefined;
    }

    const lastIndex = slotDefs.length - 1;
    const keepVariadicTail = parseSlotDefinition(
        slotDefs[lastIndex] ?? "",
        slotDefs,
        lastIndex
    ).variadic;
    const nextSlots = keepVariadicTail ? slots.slice(0) : slots.slice(0, slotDefs.length);

    return isJsonEqual(nextSlots, slots) ? slots : nextSlots;
};

const matchesSelectedNodeTarget = (
    selectedNode: EditNode,
    payload: { target: UpdateNodeInput["target"] }
): boolean => {
    // Inspector edits are rejected if selection moved between render and commit.
    return (
        selectedNode.ref.structuralStableId === payload.target.structuralStableId &&
        selectedNode.ref.sourceStableId === payload.target.sourceStableId &&
        selectedNode.ref.sourceTreePath === payload.target.sourceTreePath
    );
};

const resolveUpdateNodeSnapshot = (
    payload: {
        target: UpdateNodeInput["target"];
        currentNodeSnapshot?: UpdateNodeInput["currentNodeSnapshot"];
    },
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
    if (treeUsesConditions(tree)) {
        const nextType = readConditionType(nextCustom[CONDITION_TYPE_CUSTOM_KEY]);
        const previousType = readConditionType(tree.custom[CONDITION_TYPE_CUSTOM_KEY]);
        nextCustom[CONDITION_TYPE_CUSTOM_KEY] = nextType ?? previousType ?? DEFAULT_CONDITION_TYPE;
    }
    const nextVars = cloneVars(payload.variables.locals).sort((a, b) =>
        a.name.localeCompare(b.name)
    );
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
    const nextName =
        String(payload.data.name ?? selectedNode.data.name).trim() || selectedNode.data.name;
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

    const nextDebug = toOptionalBoolean(payload.data.debug);
    const nextDisabled = toOptionalBoolean(payload.data.disabled);
    const nextInput = pruneNodeSlotsByDefinition(payload.data.input, nextNodeDef?.input);
    const nextOutput = pruneNodeSlotsByDefinition(payload.data.output, nextNodeDef?.output);
    const nextArgs = pruneNodeArgsByDefinition(payload.data.args, nextNodeDef);
    const conditionsProvided = Object.prototype.hasOwnProperty.call(payload.data, "conditions");
    const nextConditions = conditionsProvided
        ? clonePersistedConditions(payload.data.conditions)
        : selectedNode.data.conditions;

    if (
        nextName === selectedNode.data.name &&
        nextDesc === selectedNode.data.desc &&
        nextPath === selectedNode.data.path &&
        !hasBooleanStateChanged(nextDebug, selectedNode.data.debug) &&
        !hasBooleanStateChanged(nextDisabled, selectedNode.data.disabled) &&
        isJsonEqual(nextInput ?? [], selectedNode.data.input ?? []) &&
        isJsonEqual(nextOutput ?? [], selectedNode.data.output ?? []) &&
        isJsonEqual(nextArgs ?? {}, selectedNode.data.args ?? {}) &&
        isJsonEqual(nextConditions ?? [], selectedNode.data.conditions ?? [])
    ) {
        return { status: "noop" };
    }

    for (const condition of conditionsProvided ? (nextConditions ?? []) : []) {
        const violation = conditionViolationResult(
            findConditionBranchViolation(condition.root, context.nodeDefs)
        );
        if (violation) {
            return violation;
        }
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
            conditions: nextConditions,
        };

        const diff = computeNodeOverride(original, editedNode, nextNodeDef);

        if (diff) {
            tree.overrides[payload.target.sourceStableId] = diff;
        } else {
            delete tree.overrides[payload.target.sourceStableId];
        }

        const subtreeViolation = touchedConditionError(tree, context.nodeDefs, [
            payload.target.structuralStableId,
            payload.target.sourceStableId,
        ]);
        if (subtreeViolation) {
            return subtreeViolation;
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
        detached.conditions = nextConditions;
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
        if (conditionsProvided) {
            node.conditions = nextConditions;
        }
        if (nextPath && nextPath !== selectedNode.data.path) {
            node.children = undefined;
        }
    }

    const inlineViolation = touchedConditionError(tree, context.nodeDefs, [
        payload.target.structuralStableId,
    ]);
    if (inlineViolation) {
        return inlineViolation;
    }

    return {
        status: "changed",
        tree,
        rebuildGraph: true,
    };
};

const reducePerformDrop = (
    mutation: Extract<ReducibleDocumentMutation, { type: "performDrop" }>,
    tree: PersistedTreeModel,
    nodeDefs: NodeDef[]
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
    const sourceIndex = sourceSiblings.findIndex(
        (entry) => entry.uuid === sourceLocation.node.uuid
    );
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

    const dropViolation = touchedConditionError(nextTree, nodeDefs, [
        movedNode.uuid,
        mutation.payload.target.structuralStableId,
    ]);
    if (dropViolation) {
        return dropViolation;
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
    tree: PersistedTreeModel,
    nodeDefs: NodeDef[]
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

    const pasteViolation = touchedConditionError(nextTree, nodeDefs, [nextNode.uuid]);
    if (pasteViolation) {
        return pasteViolation;
    }

    return {
        status: "changed",
        tree: nextTree,
        rebuildGraph: true,
        nextSelection: { kind: "node", structuralStableId: nextNode.uuid },
    };
};

const reduceInsertNode = (
    mutation: Extract<ReducibleDocumentMutation, { type: "insertNode" }>,
    tree: PersistedTreeModel,
    nodeDefs: NodeDef[]
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

    const insertViolation = touchedConditionError(nextTree, nodeDefs, [nextNode.uuid]);
    if (insertViolation) {
        return insertViolation;
    }

    return {
        status: "changed",
        tree: nextTree,
        rebuildGraph: true,
        nextSelection: { kind: "node", structuralStableId: nextNode.uuid },
    };
};

const reduceReplaceNode = (
    mutation: Extract<ReducibleDocumentMutation, { type: "replaceNode" }>,
    tree: PersistedTreeModel,
    nodeDefs: NodeDef[]
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
    for (const condition of replacement.conditions ?? []) {
        assignFreshStableIds(condition.root);
    }
    for (const child of replacement.children ?? []) {
        // Children are copied content and must not alias nodes from their source tree.
        assignFreshStableIds(child);
    }
    if (replacement.path) {
        replacement.children = undefined;
    }
    overwritePersistedNode(targetNode, replacement);

    const replaceViolation = touchedConditionError(nextTree, nodeDefs, [replacement.uuid]);
    if (replaceViolation) {
        return replaceViolation;
    }

    return {
        status: "changed",
        tree: nextTree,
        rebuildGraph: true,
        nextSelection: { kind: "node", structuralStableId: replacement.uuid },
    };
};

const reduceAttachCondition = (
    mutation: Extract<ReducibleDocumentMutation, { type: "attachCondition" }>,
    context: DocumentMutationReducerContext
): DocumentMutationReducerResult => {
    const entryName = mutation.payload.entryName.trim();
    const entryDef = getNodeDef(context.nodeDefs, entryName);
    if (!entryDef) {
        return { status: "error", error: { code: "missing-node-def" } };
    }
    if (nodeDefReturnsRunning(entryDef)) {
        return { status: "error", error: { code: "condition-running-status" } };
    }
    if (
        findEnclosingConditionBranch(
            context.tree.root,
            mutation.payload.target.structuralStableId
        )
    ) {
        return { status: "error", error: { code: "condition-nested" } };
    }

    const tree = clonePersistedTree(context.tree);
    const inlineNode = findPersistedNodeByStableId(
        tree.root,
        mutation.payload.target.structuralStableId
    );
    const entryNode: PersistedNodeModel = {
        uuid: generateUuid(),
        id: "",
        name: entryName,
    };

    if (inlineNode) {
        // The editor edits one condition per node for now; the file format allows more.
        if (inlineNode.conditions?.length) {
            return { status: "error", error: { code: "condition-already-attached" } };
        }
        inlineNode.conditions = [
            createConditionData(mutation.payload.target.displayId || inlineNode.id, entryNode),
        ];
        return {
            status: "changed",
            tree,
            rebuildGraph: true,
        };
    }

    const snapshot = resolveUpdateNodeSnapshot(mutation.payload, context);
    if ("error" in snapshot) {
        return { status: "error", error: snapshot.error };
    }
    if (!snapshot.subtreeNode) {
        return { status: "error", error: { code: "missing-target-node" } };
    }
    const original = snapshot.subtreeOriginal;
    if (!original) {
        return { status: "error", error: { code: "missing-subtree-original" } };
    }
    const hostDef = getNodeDef(context.nodeDefs, snapshot.data.name);
    if (snapshot.data.conditions?.length) {
        return { status: "error", error: { code: "condition-already-attached" } };
    }

    const editedNode: PersistedNodeModel = {
        ...clonePersistedNode(snapshot.data),
        conditions: [
            createConditionData(mutation.payload.target.displayId || snapshot.data.id, entryNode),
        ],
    };
    const diff = computeNodeOverride(original, editedNode, hostDef);
    if (diff) {
        tree.overrides[mutation.payload.target.sourceStableId] = diff;
    } else {
        delete tree.overrides[mutation.payload.target.sourceStableId];
    }

    return {
        status: "changed",
        tree,
        rebuildGraph: true,
    };
};

const reduceRemoveCondition = (
    mutation: Extract<ReducibleDocumentMutation, { type: "removeCondition" }>,
    context: DocumentMutationReducerContext
): DocumentMutationReducerResult => {
    const tree = clonePersistedTree(context.tree);
    const inlineNode = findPersistedNodeByStableId(
        tree.root,
        mutation.payload.target.structuralStableId
    );

    if (inlineNode) {
        if (!inlineNode.conditions?.length) {
            return { status: "error", error: { code: "condition-not-attached" } };
        }
        // Remove the condition the editor shows; any further hand-written items stay.
        inlineNode.conditions = clonePersistedConditions(inlineNode.conditions.slice(1));
        return {
            status: "changed",
            tree,
            rebuildGraph: true,
        };
    }

    const snapshot = resolveUpdateNodeSnapshot(mutation.payload, context);
    if ("error" in snapshot) {
        return { status: "error", error: snapshot.error };
    }
    if (!snapshot.subtreeNode) {
        return { status: "error", error: { code: "missing-target-node" } };
    }
    const original = snapshot.subtreeOriginal;
    if (!original) {
        return { status: "error", error: { code: "missing-subtree-original" } };
    }
    const hostDef = getNodeDef(context.nodeDefs, snapshot.data.name);
    if (!snapshot.data.conditions?.length) {
        return { status: "error", error: { code: "condition-not-attached" } };
    }
    if (original.conditions?.length) {
        return { status: "error", error: { code: "condition-clear-denied" } };
    }

    const editedNode = clonePersistedNode(snapshot.data);
    delete editedNode.conditions;
    const diff = computeNodeOverride(original, editedNode, hostDef);
    if (diff) {
        tree.overrides[mutation.payload.target.sourceStableId] = diff;
    } else {
        delete tree.overrides[mutation.payload.target.sourceStableId];
    }

    return {
        status: "changed",
        tree,
        rebuildGraph: true,
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
    mutation.type === "attachCondition" ||
    mutation.type === "removeCondition" ||
    mutation.type === "performDrop" ||
    mutation.type === "pasteNode" ||
    mutation.type === "insertNode" ||
    mutation.type === "replaceNode" ||
    mutation.type === "deleteNode";

// Reducers stay filesystem-free; host session code handles saves, subtree files, and watcher state.
export const reduceDocumentMutation = (
    mutation: ReducibleDocumentMutation,
    context: DocumentMutationReducerContext
): DocumentMutationReducerResult => {
    const reduced = reduceDocumentMutationUnchecked(mutation, context);
    if (reduced.status === "changed") {
        ensureConditionTypeCustom(reduced.tree);
    }
    return reduced;
};

const reduceDocumentMutationUnchecked = (
    mutation: ReducibleDocumentMutation,
    context: DocumentMutationReducerContext
): DocumentMutationReducerResult => {
    switch (mutation.type) {
        case "updateTreeMeta":
            return reduceUpdateTreeMeta(mutation, context.tree);

        case "updateNode":
            return reduceUpdateNode(mutation, context);

        case "attachCondition":
            return reduceAttachCondition(mutation, context);

        case "removeCondition":
            return reduceRemoveCondition(mutation, context);

        case "performDrop":
            return reducePerformDrop(mutation, context.tree, context.nodeDefs);

        case "pasteNode":
            return reducePasteNode(mutation, context.tree, context.nodeDefs);

        case "insertNode":
            return reduceInsertNode(mutation, context.tree, context.nodeDefs);

        case "replaceNode":
            return reduceReplaceNode(mutation, context.tree, context.nodeDefs);

        case "deleteNode":
            return reduceDeleteNode(mutation, context.tree);
    }
};

export const formatDocumentMutationReducerError = (
    error: DocumentMutationReducerError,
    language: SupportedLanguage
): string => {
    switch (error.code) {
        case "invalid-json-path":
            return translateRuntimeMessage(language, "mutation.invalidJsonPath", {
                path: error.path,
            });

        case "missing-selected-node":
            return translateRuntimeMessage(language, "mutation.missingSelectedNode");

        case "selected-node-mismatch":
            return translateRuntimeMessage(language, "mutation.selectedNodeMismatch");

        case "missing-target-node":
            return translateRuntimeMessage(language, "mutation.missingTargetNode");

        case "missing-source-node":
            return translateRuntimeMessage(language, "mutation.missingSourceNode");

        case "missing-subtree-original":
            return translateRuntimeMessage(language, "mutation.missingSubtreeOriginal");

        case "missing-detached-subtree-root":
            return translateRuntimeMessage(language, "mutation.missingDetachedSubtreeRoot");

        case "move-root-denied":
            return translateRuntimeMessage(language, "mutation.moveRootDenied");

        case "drop-around-root-denied":
            return translateRuntimeMessage(language, "mutation.dropAroundRootDenied");

        case "add-child-to-subtree-ref-denied":
            return translateRuntimeMessage(language, "mutation.addChildToSubtreeRefDenied");

        case "move-into-descendant-denied":
            return translateRuntimeMessage(language, "mutation.moveIntoDescendantDenied");

        case "delete-root-node-denied":
            return translateRuntimeMessage(language, "mutation.deleteRootNodeDenied");

        case "edit-subtree-denied":
            return translateRuntimeMessage(language, "mutation.editSubtreeDenied");


        case "condition-already-attached":
            return translateRuntimeMessage(language, "mutation.conditionAlreadyAttached");

        case "condition-not-attached":
            return translateRuntimeMessage(language, "mutation.conditionNotAttached");

        case "condition-clear-denied":
            return translateRuntimeMessage(language, "mutation.conditionClearDenied");

        case "condition-running-status":
            return translateRuntimeMessage(language, "mutation.conditionRunningStatus");

        case "condition-nested":
            return translateRuntimeMessage(language, "mutation.conditionNested");

        case "missing-node-def":
            return translateRuntimeMessage(language, "mutation.missingNodeDef");
    }
};
