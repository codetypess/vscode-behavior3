import chokidar from "chokidar";
import path from "path";
import { fileURLToPath } from "url";
import { build } from "vite";
import { createWebviewBuildConfig } from "./vite-webview-config.mjs";

const watch = process.argv.includes("--watch");
const mode = process.argv.includes("--development") ? "development" : "production";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const watchTargets = [
  path.resolve(repoRoot, "webview"),
  path.resolve(repoRoot, "media"),
  path.resolve(repoRoot, "scripts/vite-webview-config.mjs"),
  path.resolve(repoRoot, "vite.config.ts"),
];

const createInlineConfig = ({ preserveOutDir = false } = {}) => {
  const config = createWebviewBuildConfig({ mode });
  config.build.emptyOutDir = !preserveOutDir;
  return {
    configFile: false,
    logLevel: "info",
    mode,
    ...config,
  };
};

const formatBuildError = (error) => {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown Vite build failure";
};

const printBuildError = (error) => {
  console.error(`✘ [ERROR] ${formatBuildError(error)}`);

  if (!error || typeof error !== "object") {
    return;
  }

  const location = "loc" in error ? error.loc : null;
  if (location && typeof location === "object" && "file" in location && location.file) {
    const relativeFile = path.relative(repoRoot, location.file);
    const line = "line" in location ? location.line : undefined;
    const column = "column" in location ? location.column : undefined;
    console.error(`    ${relativeFile}:${line ?? 0}:${column ?? 0}:`);
  }

  if ("frame" in error && typeof error.frame === "string" && error.frame.trim()) {
    for (const line of error.frame.trimEnd().split("\n")) {
      console.error(`    ${line}`);
    }
  }
};

const buildWebview = async ({ preserveOutDir = false } = {}) => {
  await build(createInlineConfig({ preserveOutDir }));
};

const runWatch = async () => {
  const watcher = chokidar.watch(watchTargets, {
    ignoreInitial: true,
    usePolling: true,
    interval: 100,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });

  let isBuilding = false;
  let rebuildQueued = false;
  let debounceTimer = null;

  const runBuild = async () => {
    if (isBuilding) {
      rebuildQueued = true;
      return;
    }

    isBuilding = true;
    console.log("[watch] build started");

    try {
      await buildWebview({ preserveOutDir: true });
    } catch (error) {
      printBuildError(error);
    } finally {
      console.log("[watch] build finished");
      isBuilding = false;

      if (rebuildQueued) {
        rebuildQueued = false;
        void runBuild();
      }
    }
  };

  const scheduleBuild = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void runBuild();
    }, 120);
  };

  watcher.on("all", () => {
    scheduleBuild();
  });

  watcher.on("error", (error) => {
    printBuildError(error);
  });

  const closeWatcher = async () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    await watcher.close();
  };

  process.once("SIGINT", () => {
    void closeWatcher().finally(() => process.exit(130));
  });

  process.once("SIGTERM", () => {
    void closeWatcher().finally(() => process.exit(143));
  });

  await new Promise((resolve) => {
    watcher.once("ready", resolve);
  });

  await runBuild();
};

const run = async () => {
  if (watch) {
    await runWatch();
    return;
  }

  await buildWebview();
};

run().catch((error) => {
  printBuildError(error);
  process.exit(1);
});
