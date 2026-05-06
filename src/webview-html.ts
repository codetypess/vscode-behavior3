import * as fs from "fs";
import * as vscode from "vscode";

export type Behavior3WebviewMode = "editor" | "inspector-sidebar";

interface BuildBehaviorWebviewHtmlOptions {
    title: string;
    mode?: Behavior3WebviewMode;
}

/**
 * Read the Vite-generated HTML for a webview entry and rewrite all asset
 * references to proper vscode-webview-resource URIs.
 */
export function buildBehaviorWebviewHtml(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    options: BuildBehaviorWebviewHtmlOptions
): string {
    const htmlPath = vscode.Uri.joinPath(extensionUri, "dist", "webview", "index.html");
    let html = fs.readFileSync(htmlPath.fsPath, "utf-8");

    const webviewRootUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, "dist", "webview")
    );

    const assetsUri = `${webviewRootUri}/assets`;
    html = html.replace(/(?:\.\.\/|\.\/)assets\//g, `${assetsUri}/`);
    html = html.replace(/<title>.*?<\/title>/, `<title>${options.title}</title>`);

    const baseTag = `<base href="${webviewRootUri}/">`;
    const modeScript = `<script>window.__B3_WEBVIEW_KIND__ = ${JSON.stringify(options.mode ?? "editor")};</script>`;
    const src = webview.cspSource;
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${src} data: blob:; style-src ${src} 'unsafe-inline'; script-src ${src} 'unsafe-inline'; font-src ${src} data:; worker-src blob:; connect-src ${src};">`;
    html = html.replace("<head>", `<head>\n  ${baseTag}\n  ${csp}\n  ${modeScript}`);

    return html;
}

interface ConfigureBehaviorWebviewOptions {
    title: string;
    mode?: Behavior3WebviewMode;
}

export function configureBehaviorWebview(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    workspaceFolderUri: vscode.Uri,
    options: ConfigureBehaviorWebviewOptions
): void {
    webview.options = {
        enableScripts: true,
        localResourceRoots: [
            vscode.Uri.joinPath(extensionUri, "dist", "webview"),
            vscode.Uri.joinPath(extensionUri, "media"),
            workspaceFolderUri,
        ],
    };
    webview.html = buildBehaviorWebviewHtml(webview, extensionUri, options);
}
