export type ThemeMode = "dark" | "light";

export const detectInitialThemeMode = (): ThemeMode => {
    if (typeof document === "undefined") {
        return "dark";
    }

    const classes = document.body?.classList;
    if (classes?.contains("vscode-light") || classes?.contains("vscode-high-contrast-light")) {
        return "light";
    }
    if (classes?.contains("vscode-dark") || classes?.contains("vscode-high-contrast")) {
        return "dark";
    }

    return window.matchMedia?.("(prefers-color-scheme: light)")?.matches ? "light" : "dark";
};

export const applyDocumentTheme = (theme: ThemeMode): void => {
    if (typeof document === "undefined") {
        return;
    }

    document.documentElement.setAttribute("data-theme", theme);
    document.body?.setAttribute("data-theme", theme);
};

export type WebviewKind = "editor" | "inspector-sidebar";

export const normalizeWebviewKind = (value: unknown): WebviewKind =>
    value === "inspector-sidebar" ? "inspector-sidebar" : "editor";

export const detectWebviewKind = (): WebviewKind =>
    typeof window === "undefined" ? "editor" : normalizeWebviewKind(window.__B3_WEBVIEW_KIND__);
