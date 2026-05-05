const WHEEL_ZOOM_SENSITIVITY = 1;

const clampNumber = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));

type WheelDeltaEvent = Pick<WheelEvent, "deltaX" | "deltaY">;
type WheelControlEvent = Pick<WheelEvent, "preventDefault" | "stopPropagation">;

export type NativeWheelZoomPoint = [number, number];

export const getWheelZoomRatio = (event: WheelDeltaEvent): number | null => {
    const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
    if (!Number.isFinite(delta) || delta === 0) {
        return null;
    }

    return 1 + (clampNumber(-delta, -50, 50) * WHEEL_ZOOM_SENSITIVITY) / 100;
};

export const handleNativeWheelZoom = (options: {
    event: WheelDeltaEvent & WheelControlEvent;
    isEnabled: () => boolean;
    getOrigin: () => NativeWheelZoomPoint | undefined;
    zoomTo: (ratio: number, origin: NativeWheelZoomPoint | undefined) => Promise<void>;
}) => {
    const { event, isEnabled, getOrigin, zoomTo } = options;
    if (!isEnabled()) {
        return;
    }

    const ratio = getWheelZoomRatio(event);
    if (!ratio) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    void zoomTo(ratio, getOrigin());
};
