export type SerialOperationQueue = <T>(operation: () => Promise<T> | T) => Promise<T>;

export const createSerialOperationQueue = (): SerialOperationQueue => {
    let queue: Promise<unknown> = Promise.resolve();

    return <T>(operation: () => Promise<T> | T): Promise<T> => {
        const task = queue.then(operation, operation);
        // Keep the queue alive after failures so later operations still run serially.
        queue = task.then(
            () => undefined,
            () => undefined
        );
        return task;
    };
};
