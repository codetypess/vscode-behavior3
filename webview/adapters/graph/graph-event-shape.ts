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
