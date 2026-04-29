import type { NodeDef } from "../../shared/misc/b3type";
import type {
  PersistedNodeModel,
  PersistedTreeModel,
  ResolveGraphResult,
  ResolvedDocumentGraph,
  ResolvedNodeModel,
  WorkdirRelativeJsonPath,
} from "../shared/contracts";
import { normalizeWorkdirRelativePath } from "../shared/protocol";
import { clonePersistedNode } from "../shared/tree";

interface ResolveCursor {
  nodesByInstanceKey: Record<string, ResolvedNodeModel>;
  nodeOrder: string[];
  mainTreeDisplayIdsByStableId: Record<string, string>;
}

interface ResolveContext {
  parentKey: string | null;
  depth: number;
  subtreeStack: WorkdirRelativeJsonPath[];
  overrideSourceChain: PersistedTreeModel[];
  sourceTreePath: WorkdirRelativeJsonPath | null;
  insideExternalSubtree: boolean;
}

const applyPatchIfAny = (
  node: PersistedNodeModel,
  patch:
    | Pick<PersistedNodeModel, "desc" | "input" | "output" | "args" | "debug" | "disabled">
    | undefined
) => {
  if (!patch) {
    return;
  }
  if (patch.desc !== undefined) node.desc = patch.desc;
  if (patch.input !== undefined) node.input = patch.input;
  if (patch.output !== undefined) node.output = patch.output;
  if (patch.args !== undefined) node.args = { ...(node.args ?? {}), ...patch.args };
  if (patch.debug !== undefined) node.debug = patch.debug;
  if (patch.disabled !== undefined) node.disabled = patch.disabled;
};

const applyArgDefaults = (node: PersistedNodeModel, def: NodeDef | null) => {
  if (!def?.args?.length) {
    return;
  }
  node.args ||= {};
  for (const arg of def.args) {
    if (node.args[arg.name] === undefined && arg.default !== undefined) {
      node.args[arg.name] = arg.default;
    }
  }
};

const buildResolvedExternalNode = (
  sourceNode: PersistedNodeModel,
  overrideChain: PersistedTreeModel[],
  rootOverride: PersistedTreeModel["$override"]
) => {
  const value = clonePersistedNode(sourceNode);
  for (const tree of [...overrideChain].reverse()) {
    applyPatchIfAny(value, tree.$override[sourceNode.$id]);
  }
  const subtreeOriginal = clonePersistedNode(value);
  applyPatchIfAny(value, rootOverride[sourceNode.$id]);
  return { value, subtreeOriginal };
};

export const resolveDocumentGraph = (params: {
  persistedTree: PersistedTreeModel;
  subtreeSources: Record<WorkdirRelativeJsonPath, PersistedTreeModel | null>;
  nodeDefs: NodeDef[];
  editSubtreeNodeProps: boolean;
}): ResolveGraphResult => {
  const defsByName = new Map(params.nodeDefs.map((def) => [def.name, def] as const));
  const cursor: ResolveCursor = {
    nodesByInstanceKey: {},
    nodeOrder: [],
    mainTreeDisplayIdsByStableId: {},
  };

  const resolveNode = (
    structuredNode: PersistedNodeModel,
    context: ResolveContext,
    nextDisplayId: number
  ): { node: ResolvedNodeModel; nextDisplayId: number } => {
    const normalizedPath = structuredNode.path
      ? normalizeWorkdirRelativePath(structuredNode.path)
      : undefined;
    const isCyclic = normalizedPath ? context.subtreeStack.includes(normalizedPath) : false;
    const subtreeTree =
      normalizedPath && !isCyclic ? params.subtreeSources[normalizedPath] ?? null : null;
    const materialized = Boolean(normalizedPath && subtreeTree);

    let sourceNode = structuredNode;
    let resolutionError: ResolvedNodeModel["resolutionError"];
    let sourceTreePath = context.sourceTreePath;
    let subtreeOriginal: PersistedNodeModel | undefined;
    let overrideChain = context.overrideSourceChain;

    if (normalizedPath && isCyclic) {
      resolutionError = "cyclic-subtree";
    } else if (normalizedPath && !subtreeTree) {
      resolutionError = "missing-subtree";
    } else if (materialized && subtreeTree) {
      sourceNode = clonePersistedNode(subtreeTree.root);
      sourceNode.path = normalizedPath;
      sourceTreePath = normalizedPath!;
      overrideChain = [...context.overrideSourceChain, subtreeTree];
      const external = buildResolvedExternalNode(
        sourceNode,
        overrideChain,
        params.persistedTree.$override
      );
      sourceNode = external.value;
      subtreeOriginal = external.subtreeOriginal;
    } else if (context.sourceTreePath) {
      sourceTreePath = context.sourceTreePath;
      const external = buildResolvedExternalNode(
        sourceNode,
        context.overrideSourceChain,
        params.persistedTree.$override
      );
      sourceNode = external.value;
      subtreeOriginal = external.subtreeOriginal;
    } else {
      sourceNode = clonePersistedNode(sourceNode);
    }

    applyArgDefaults(sourceNode, defsByName.get(sourceNode.name) ?? null);

    const displayId = String(nextDisplayId);
    const renderedIdLabel = `${params.persistedTree.prefix ?? ""}${displayId}`;
    const instanceKey = displayId;
    let nextId = nextDisplayId + 1;

    const node: ResolvedNodeModel = {
      ref: {
        instanceKey,
        displayId,
        structuralStableId: structuredNode.$id,
        sourceStableId: sourceNode.$id,
        sourceTreePath: sourceTreePath ?? null,
        subtreeStack: materialized
          ? [...context.subtreeStack, normalizedPath!]
          : [...context.subtreeStack],
      },
      parentKey: context.parentKey,
      childKeys: [],
      depth: context.depth,
      renderedIdLabel,
      name: sourceNode.name,
      desc: sourceNode.desc,
      args: sourceNode.args,
      input: sourceNode.input,
      output: sourceNode.output,
      debug: sourceNode.debug,
      disabled: sourceNode.disabled,
      path: sourceNode.path,
      $status: sourceNode.$status,
      subtreeNode: context.insideExternalSubtree,
      subtreeEditable: !context.insideExternalSubtree || params.editSubtreeNodeProps,
      subtreeOriginal,
      resolutionError,
    };

    if (context.sourceTreePath === null) {
      cursor.mainTreeDisplayIdsByStableId[structuredNode.$id] = displayId;
    }

    cursor.nodesByInstanceKey[instanceKey] = node;
    cursor.nodeOrder.push(instanceKey);

    const nextChildren =
      materialized && subtreeTree
        ? subtreeTree.root.children ?? []
        : normalizedPath && !subtreeTree
          ? []
          : sourceNode.children ?? [];

    const childContext: ResolveContext =
      materialized && subtreeTree
        ? {
            parentKey: instanceKey,
            depth: context.depth + 1,
            subtreeStack: [...context.subtreeStack, normalizedPath!],
            overrideSourceChain: [...context.overrideSourceChain, subtreeTree],
            sourceTreePath: normalizedPath!,
            insideExternalSubtree: true,
          }
        : context.sourceTreePath
          ? {
              parentKey: instanceKey,
              depth: context.depth + 1,
              subtreeStack: [...context.subtreeStack],
              overrideSourceChain: overrideChain,
              sourceTreePath: context.sourceTreePath,
              insideExternalSubtree: true,
            }
          : {
              parentKey: instanceKey,
              depth: context.depth + 1,
              subtreeStack: [],
              overrideSourceChain: [],
              sourceTreePath: null,
              insideExternalSubtree: false,
            };

    for (const child of nextChildren) {
      const resolvedChild = resolveNode(child, childContext, nextId);
      nextId = resolvedChild.nextDisplayId;
      node.childKeys.push(resolvedChild.node.ref.instanceKey);
    }

    return {
      node,
      nextDisplayId: nextId,
    };
  };

  const rootResult = resolveNode(params.persistedTree.root, {
    parentKey: null,
    depth: 0,
    subtreeStack: [],
    overrideSourceChain: [],
    sourceTreePath: null,
    insideExternalSubtree: false,
  }, 1);

  const root = rootResult.node;

  const graph: ResolvedDocumentGraph = {
    rootKey: root.ref.instanceKey,
    nodesByInstanceKey: cursor.nodesByInstanceKey,
    nodeOrder: cursor.nodeOrder,
  };

  return {
    graph,
    mainTreeDisplayIdsByStableId: cursor.mainTreeDisplayIdsByStableId,
  };
};
