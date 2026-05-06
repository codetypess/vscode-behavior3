import React from "react";
import ReactDOM from "react-dom/client";
import "./style.scss";
import { App } from "./app/app";
import { createEditorRuntime, RuntimeProvider } from "./app/runtime";
import { applyDocumentTheme, detectInitialThemeMode } from "./shared/theme-mode";
import { InspectorSidebarApp } from "./app/inspector-sidebar-app";

const editorRuntime = createEditorRuntime();
const webviewKind = window.__B3_WEBVIEW_KIND__ ?? "editor";

document.documentElement.setAttribute("data-webview-kind", webviewKind);
document.body?.setAttribute("data-webview-kind", webviewKind);
applyDocumentTheme(detectInitialThemeMode());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    webviewKind === "inspector-sidebar" ? (
        <InspectorSidebarApp />
    ) : (
        <React.StrictMode>
            <RuntimeProvider runtime={editorRuntime}>
                <App />
            </RuntimeProvider>
        </React.StrictMode>
    )
);
