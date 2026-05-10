export interface Logger {
    log(...args: unknown[]): void;
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
}

export function createConsoleLogger(): Logger {
    return {
        log: console.log.bind(console),
        debug: console.debug.bind(console),
        info: console.info.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
    };
}

let current: Logger = createConsoleLogger();

/**
 * Stable handle for `logger.log` / `logger.error` / … — always forwards to the
 * implementation set by `setLogger` (unlike capturing `getLogger()` once).
 */
export const logger: Logger = {
    log: (...args: unknown[]) => current.log(...args),
    debug: (...args: unknown[]) => current.debug(...args),
    info: (...args: unknown[]) => current.info(...args),
    warn: (...args: unknown[]) => current.warn(...args),
    error: (...args: unknown[]) => current.error(...args),
};

export function getLogger(): Logger {
    return current;
}

export function setLogger(next: Logger): void {
    current = next;
}

/** Invoke both loggers in order (e.g. DevTools + Output / host bridge). */
export function composeLoggers(a: Logger, b: Logger): Logger {
    return {
        log: (...args: unknown[]) => {
            a.log(...args);
            b.log(...args);
        },
        debug: (...args: unknown[]) => {
            a.debug(...args);
            b.debug(...args);
        },
        info: (...args: unknown[]) => {
            a.info(...args);
            b.info(...args);
        },
        warn: (...args: unknown[]) => {
            a.warn(...args);
            b.warn(...args);
        },
        error: (...args: unknown[]) => {
            a.error(...args);
            b.error(...args);
        },
    };
}
