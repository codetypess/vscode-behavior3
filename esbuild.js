const esbuild = require("esbuild");
const isWatch = process.argv.includes("--watch");
const isDev = isWatch || process.argv.includes("--dev");

const buildOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: isDev,
  minify: false,
};

if (isWatch) {
  esbuild.context(buildOptions).then((ctx) => {
    ctx.watch();
    console.log("[esbuild] watching...");
  });
} else {
  esbuild.build(buildOptions).then(() => {
    console.log("[esbuild] built extension.js");
  });
}
