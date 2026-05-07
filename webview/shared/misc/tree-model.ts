import type { NodeData } from "./b3type";
import { generateUuid } from "../stable-id";

export const dfs = <T extends { children?: T[] }>(
    node: T,
    visitor: (node: T, depth: number) => unknown,
    depth = 0
) => {
    const traverse = (current: T, currentDepth: number) => {
        if (visitor(current, currentDepth) === false) {
            return false;
        }
        if (current.children) {
            for (const child of current.children) {
                if (traverse(child, currentDepth + 1) === false) {
                    return false;
                }
            }
        }
    };
    traverse(node, depth);
};

export const isSubtreeRoot = (data: Pick<NodeData, "path" | "id">) => {
    return Boolean(data.path) && data.id !== "1";
};

export const createNode = (data: NodeData, includeChildren: boolean = true): NodeData => {
    const stableIdentity = data as NodeData & { $id?: string };
    const node: NodeData = {
        uuid: stableIdentity.uuid || stableIdentity.$id || generateUuid(),
        id: data.id,
        name: data.name,
        desc: data.desc?.trim() || undefined,
        path: data.path,
        debug: data.debug || undefined,
        disabled: data.disabled || undefined,
    };

    if (data.input) {
        node.input = [];
        for (const value of data.input) {
            node.input.push(value ?? "");
        }
    }

    if (data.output) {
        node.output = [];
        for (const value of data.output) {
            node.output.push(value ?? "");
        }
    }

    if (data.args) {
        const args: Record<string, unknown> = {};
        for (const key in data.args) {
            const value = data.args[key];
            if (value !== undefined) {
                args[key] = value;
            }
        }
        if (Object.keys(args).length > 0) {
            node.args = args;
        }
    }

    if (data.children?.length && !isSubtreeRoot(data) && includeChildren) {
        node.children = [];
        for (const child of data.children) {
            node.children.push(createNode(child));
        }
    }

    return node;
};

export const subtreeNeedsMissingIds = (root: unknown): boolean => {
    if (!root || typeof root !== "object") {
        return false;
    }

    const node = root as { uuid?: string; $id?: string; children?: unknown[] };
    if (!node.uuid || node.$id) {
        return true;
    }

    if (node.children) {
        for (const child of node.children) {
            if (subtreeNeedsMissingIds(child)) {
                return true;
            }
        }
    }

    return false;
};
