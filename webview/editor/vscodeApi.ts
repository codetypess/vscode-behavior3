/**
 * Bridge between the Editor Webview and the VSCode Extension Host.
 * The `acquireVsCodeApi()` function is injected by VSCode into the webview context.
 */
import type { EditorToHostMessage, HostToEditorMessage } from "../../src/types";

declare function acquireVsCodeApi(): {
  postMessage(message: EditorToHostMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

/** Send a message to the extension host */
export const postMessage = (msg: EditorToHostMessage) => {
  vscode.postMessage(msg);
};

function formatWebviewConsoleArg(a: unknown): string {
  if (typeof a === "string") {
    return a;
  }
  if (a instanceof Error) {
    return a.stack ?? a.message;
  }
  try {
    if (typeof a === "object" && a !== null) {
      return JSON.stringify(a);
    }
  } catch {
    /* ignore */
  }
  return String(a);
}

/**
 * Mirror webview `console.*` to the extension host Output channel ("Behavior3").
 * Original console still runs in DevTools.
 */
function installWebviewConsoleForward(): void {
  const levels = ["log", "info", "warn", "error", "debug"] as const;
  for (const level of levels) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      orig(...args);
      try {
        const message = args.map(formatWebviewConsoleArg).join(" ");
        postMessage({ type: "webviewLog", level, message });
      } catch {
        /* ignore bridge errors */
      }
    };
  }
}

installWebviewConsoleForward();

type MessageHandler = (msg: HostToEditorMessage) => void;
const handlers: MessageHandler[] = [];

window.addEventListener("message", (event) => {
  const msg = event.data as HostToEditorMessage;
  for (const handler of handlers) {
    handler(msg);
  }
});

/** Register a handler for messages from the extension host */
export const onMessage = (handler: MessageHandler): (() => void) => {
  handlers.push(handler);
  return () => {
    const idx = handlers.indexOf(handler);
    if (idx >= 0) {
      handlers.splice(idx, 1);
    }
  };
};

/** Persist minimal UI state across webview lifecycle (when panel is hidden) */
export const getState = () => vscode.getState() as Record<string, unknown> | null;
export const setState = (state: Record<string, unknown>) => vscode.setState(state);

/** Request a file from the extension host (returns a Promise) */
export const readFile = (filePath: string): Promise<string | null> => {
  return new Promise((resolve) => {
    const requestId = Math.random().toString(36).slice(2);
    const off = onMessage((msg) => {
      if (msg.type === "readFileResult" && msg.requestId === requestId) {
        off();
        resolve(msg.content);
      }
    });
    postMessage({ type: "readFile", requestId, path: filePath });
  });
};

/** Save a subtree file via extension host */
export const saveSubtree = (filePath: string, content: string): Promise<void> => {
  return new Promise((resolve) => {
    const requestId = Math.random().toString(36).slice(2);
    postMessage({ type: "saveSubtree", requestId, path: filePath, content });
    // saveSubtree has no reply, resolve immediately
    resolve();
  });
};
