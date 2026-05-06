declare module "*.scss";
declare module "*.css";
declare module "*.svg" {
    const src: string;
    export default src;
}

declare global {
    interface Window {
        __B3_WEBVIEW_KIND__?: "editor" | "inspector-sidebar";
    }
}

export {};
