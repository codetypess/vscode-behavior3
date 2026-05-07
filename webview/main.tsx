import React from "react";
import ReactDOM from "react-dom/client";
import "./style.scss";
import { App } from "./app/app";
import { createEditorRuntime, RuntimeProvider } from "./app/runtime";
import { applyDocumentTheme, detectInitialThemeMode } from "./shared/theme-mode";
import { InspectorSidebarApp } from "./app/inspector-sidebar-app";
import { detectWebviewKind } from "./shared/webview-kind";

const webviewKind = detectWebviewKind();
const runtime = createEditorRuntime(webviewKind);

document.documentElement.setAttribute("data-webview-kind", webviewKind);
document.body?.setAttribute("data-webview-kind", webviewKind);
applyDocumentTheme(detectInitialThemeMode());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    webviewKind === "inspector-sidebar" ? (
        <InspectorSidebarApp runtime={runtime} />
    ) : (
        <React.StrictMode>
            <RuntimeProvider runtime={runtime}>
                <App />
            </RuntimeProvider>
        </React.StrictMode>
    )
);
