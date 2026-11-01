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

const CONDITION_CARD_CLASS_PATTERN = /^condition-card-(\d+)$/;

/** Class of every shape in condition card `index`, read back from pointer events. */
export const conditionCardClassName = (index: number) => `condition-card-${index}`;

/** The condition card a pointer event hit, or `null` for anything else. */
export const readEventConditionCardIndex = (event: EventLike): number | null => {
    for (const start of [event.originalTarget, event.target]) {
        let current = start ?? null;
        while (current) {
            const match =
                typeof current.className === "string"
                    ? CONDITION_CARD_CLASS_PATTERN.exec(current.className)
                    : null;
            if (match) {
                return Number(match[1]);
            }
            current = current.parentElement ?? null;
        }
    }
    return null;
};

export const eventHasShapeClass = (
    event: EventLike,
    shapeClassName: string
): boolean =>
    hasShapeClassInChain(event.originalTarget, shapeClassName) ||
    hasShapeClassInChain(event.target, shapeClassName);

export const CONDITION_DOUBLE_CLICK_MS = 500;

export type ShapeClickStamp = {
    key: string;
    time: number;
};

/** True when two clicks land on the same logical target inside one double-click window. */
export const isDoubleShapeClick = (
    previous: ShapeClickStamp | null,
    next: ShapeClickStamp,
    intervalMs = CONDITION_DOUBLE_CLICK_MS
): boolean =>
    previous !== null &&
    previous.key === next.key &&
    next.time >= previous.time &&
    next.time - previous.time <= intervalMs;
