import type { NodeInstanceRef } from "../shared/contracts";

export const canOpenSubtreeTarget = (
    path: string | null | undefined,
    ref: Pick<NodeInstanceRef, "subtreeStack"> | null | undefined
): boolean => Boolean(path || (ref?.subtreeStack.length ?? 0) > 0);
