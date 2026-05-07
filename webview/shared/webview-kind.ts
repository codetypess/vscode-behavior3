export type WebviewKind = "editor" | "inspector-sidebar";

export const normalizeWebviewKind = (value: unknown): WebviewKind =>
    value === "inspector-sidebar" ? "inspector-sidebar" : "editor";

export const detectWebviewKind = (): WebviewKind =>
    typeof window === "undefined" ? "editor" : normalizeWebviewKind(window.__B3_WEBVIEW_KIND__);
