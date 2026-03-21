/**
 * Bridge between the Inspector Sidebar Webview and the VSCode Extension Host.
 */
import type { HostToInspectorMessage, InspectorToHostMessage } from "../../src/types";

declare function acquireVsCodeApi(): {
  postMessage(message: InspectorToHostMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

export const postMessage = (msg: InspectorToHostMessage) => {
  vscode.postMessage(msg);
};

type MessageHandler = (msg: HostToInspectorMessage) => void;
const handlers: MessageHandler[] = [];

window.addEventListener("message", (event) => {
  const msg = event.data as HostToInspectorMessage;
  for (const handler of handlers) {
    handler(msg);
  }
});

export const onMessage = (handler: MessageHandler): (() => void) => {
  handlers.push(handler);
  return () => {
    const idx = handlers.indexOf(handler);
    if (idx >= 0) {
      handlers.splice(idx, 1);
    }
  };
};
