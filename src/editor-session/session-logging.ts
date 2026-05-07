import { formatConsoleArgs, getBehavior3OutputChannel } from "../output-channel";
import type { BuildEnv } from "../../webview/shared/misc/b3build";

function formatRuntimeError(error: unknown): string {
    if (error instanceof Error) {
        return error.stack ?? error.message;
    }
    return String(error);
}

export function logRuntimeError(scope: string, error: unknown): void {
    getBehavior3OutputChannel().error(`[${scope}] ${formatRuntimeError(error)}`);
}

export function logAsyncRuntimeError(scope: string): (error: unknown) => void {
    return (error) => logRuntimeError(scope, error);
}

export function createBuildScriptLogger(): BuildEnv["logger"] {
    const write =
        (level: "debug" | "info" | "warn" | "error") =>
        (...args: unknown[]) => {
            getBehavior3OutputChannel()[level](formatConsoleArgs(args));
        };

    return {
        log: write("info"),
        debug: write("debug"),
        info: write("info"),
        warn: write("warn"),
        error: write("error"),
    };
}
