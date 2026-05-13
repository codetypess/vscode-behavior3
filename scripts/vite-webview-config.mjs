import react from "@vitejs/plugin-react";
import path from "path";
import ts from "typescript";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const normalizeModuleId = (id) => id.replaceAll("\\", "/");

const isNodeModule = (id) => normalizeModuleId(id).includes("/node_modules/");

const matchesAnySegment = (id, segments) => {
  const normalized = normalizeModuleId(id);
  return segments.some((segment) => normalized.includes(segment));
};

const vendorGroups = [
  {
    name: "graph-vendor",
    priority: 30,
    test: (id) =>
      isNodeModule(id) &&
      matchesAnySegment(id, ["/@antv/", "/dagre/", "/ml-matrix/", "/internmap/"]),
  },
  {
    name: "ui-vendor",
    priority: 20,
    test: (id) =>
      isNodeModule(id) &&
      matchesAnySegment(id, ["/antd/", "/@ant-design/", "/@rc-component/", "/rc-"]),
  },
  {
    name: "vendor",
    priority: 10,
    test: (id) => isNodeModule(id),
  },
];

const transpileBehavior3DecoratorsPlugin = ({ isDevelopment }) => {
  return {
    name: "transpile-behavior3-decorators",
    transform(code, id) {
      const normalizedId = normalizeModuleId(id);
      if (!normalizedId.includes("/node_modules/behavior3/dist/index.mjs")) {
        return null;
      }

      const result = ts.transpileModule(code, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.ESNext,
          experimentalDecorators: true,
          useDefineForClassFields: false,
          allowJs: true,
          sourceMap: isDevelopment,
          inlineSources: isDevelopment,
        },
        fileName: id,
        reportDiagnostics: true,
      });

      if (result.diagnostics?.length) {
        const message = ts.formatDiagnosticsWithColorAndContext(result.diagnostics, {
          getCanonicalFileName: (fileName) => fileName,
          getCurrentDirectory: () => repoRoot,
          getNewLine: () => "\n",
        });
        this.error(message);
      }

      return {
        code: result.outputText,
        map: result.sourceMapText ? JSON.parse(result.sourceMapText) : null,
      };
    },
  };
};

export const createWebviewBuildConfig = ({ mode = "production" } = {}) => {
  const isDevelopment = mode === "development";

  return {
    root: path.resolve(repoRoot, "webview"),
    base: "./",
    publicDir: path.resolve(repoRoot, "media"),
    plugins: [transpileBehavior3DecoratorsPlugin({ isDevelopment }), react()],
    build: {
      outDir: path.resolve(repoRoot, "dist/webview"),
      emptyOutDir: true,
      watch: null,
      rolldownOptions: {
        input: {
          editor: path.resolve(repoRoot, "webview/index.html"),
        },
        output: {
          codeSplitting: {
            groups: vendorGroups,
          },
        },
      },
      chunkSizeWarningLimit: 3000,
      minify: !isDevelopment,
      // dev mode: inline sourcemaps (CSP-safe, no separate .map files)
      // production: no sourcemaps to keep bundle size small
      sourcemap: isDevelopment ? "inline" : false,
    },
    css: {
      preprocessorOptions: {
        scss: {
          api: "modern",
        },
      },
    },
  };
};
