import { formatConsoleArgs, getBehavior3OutputChannel } from "../../output-channel";
import type { BuildEnv } from "../../../webview/shared/b3build";
import type { EditorToHostMessage } from "../../../webview/shared/message-protocol";

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

export function writeWebviewLogMessage(
    msg: Extract<EditorToHostMessage, { type: "webviewLog" }>
): void {
    const out = getBehavior3OutputChannel();
    switch (msg.level) {
        case "debug":
            out.debug(msg.message);
            break;
        case "warn":
            out.warn(msg.message);
            break;
        case "error":
            out.error(msg.message);
            break;
        case "log":
        case "info":
        default:
            out.info(msg.message);
            break;
    }
}
