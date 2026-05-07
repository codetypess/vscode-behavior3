export const queueInspectorTask = (task: () => void) => {
    window.setTimeout(() => {
        task();
    }, 0);
};

const pendingInspectorEdits = new Set<Promise<unknown>>();

export const trackPendingInspectorEdit = (promise: Promise<unknown>): void => {
    const tracked = promise
        .catch(() => undefined)
        .finally(() => {
            pendingInspectorEdits.delete(tracked);
        });
    pendingInspectorEdits.add(tracked);
};

const waitForPendingInspectorEdits = async (): Promise<void> => {
    while (pendingInspectorEdits.size > 0) {
        await Promise.allSettled([...pendingInspectorEdits]);
    }
};

export const flushPendingInspectorEdits = async (): Promise<void> => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) {
        active.blur();
    }

    await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 0);
    });
    await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 0);
    });
    await waitForPendingInspectorEdits();
};
