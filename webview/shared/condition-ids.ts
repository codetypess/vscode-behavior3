/**
 * Node ids inside condition trees. The main tree counts only its own nodes; the nodes of a host's
 * `n`-th condition tree (1-based) are `<host id>.<n>-<k>`, `k` counting from 1 in node, children
 * order. Conditions inside a condition tree nest the same way (`2.1-3.1-1`).
 */

interface IdTreeNode<T> {
    conditions?: readonly { root: T }[];
    children?: readonly T[];
}

/** Prefix of the ids in a host's `n`-th condition tree (1-based), e.g. `2.1-`. */
export const conditionIdPrefix = (hostId: string, n: number): string => `${hostId}.${n}-`;

/** Number a tree from 1 in node, children order as `<prefix><k>`, condition trees included. */
export const numberTreeIds = <T extends IdTreeNode<T>>(
    root: T,
    prefix: string,
    assign: (node: T, id: string) => void
): void => {
    let next = 1;
    const visit = (node: T) => {
        const id = `${prefix}${next}`;
        next += 1;
        assign(node, id);
        numberConditionTrees(node, id, assign);
        node.children?.forEach(visit);
    };
    visit(root);
};

/** Number each condition tree of a host whose id is `hostId`. */
export const numberConditionTrees = <T extends IdTreeNode<T>>(
    host: T,
    hostId: string,
    assign: (node: T, id: string) => void
): void => {
    host.conditions?.forEach((condition, index) =>
        numberTreeIds(condition.root, conditionIdPrefix(hostId, index + 1), assign)
    );
};

/** Rewrite every id in a tree, condition trees included. */
export const mapTreeIds = <T extends IdTreeNode<T> & { id: string }>(
    root: T,
    map: (id: string) => string
): void => {
    root.id = map(root.id);
    root.conditions?.forEach((condition) => mapTreeIds(condition.root, map));
    root.children?.forEach((child) => mapTreeIds(child, map));
};
