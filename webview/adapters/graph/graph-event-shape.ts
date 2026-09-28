type ShapeLike = {
    className?: unknown;
    parentElement?: ShapeLike | null;
} | null;

type EventLike = {
    originalTarget?: ShapeLike;
    target?: ShapeLike;
};

const hasShapeClassInChain = (
    target: ShapeLike | undefined,
    shapeClassName: string
): boolean => {
    let current = target ?? null;
    while (current) {
        if (current.className === shapeClassName) {
            return true;
        }
        current = current.parentElement ?? null;
    }
    return false;
};

export const eventHasShapeClass = (
    event: EventLike,
    shapeClassName: string
): boolean =>
    hasShapeClassInChain(event.originalTarget, shapeClassName) ||
    hasShapeClassInChain(event.target, shapeClassName);

export const DECORATOR_DOUBLE_CLICK_MS = 500;

export type ShapeClickStamp = {
    key: string;
    time: number;
};

/** True when two clicks land on the same logical target inside one double-click window. */
export const isDoubleShapeClick = (
    previous: ShapeClickStamp | null,
    next: ShapeClickStamp,
    intervalMs = DECORATOR_DOUBLE_CLICK_MS
): boolean =>
    previous !== null &&
    previous.key === next.key &&
    next.time >= previous.time &&
    next.time - previous.time <= intervalMs;
