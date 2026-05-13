import { defineConfig } from "vite";
import { createWebviewBuildConfig } from "./scripts/vite-webview-config.mjs";

export default defineConfig(({ mode }) => createWebviewBuildConfig({ mode }));
