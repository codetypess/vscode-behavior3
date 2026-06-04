# Behavior3 Editor

VS Code custom editor and build toolchain for Behavior3 JSON behavior trees. It combines a graph canvas, a dedicated Inspector, project scaffolding, and build/batch/check scripting for game AI workflows.

Chinese guide: [README.zh-CN.md](README.zh-CN.md)

## Related Projects

- **[behavior3-ts](https://github.com/codetypess/behavior3-ts)** - TypeScript runtime library
- **[behavior3lua](https://github.com/zhandouxiaojiji/behavior3lua)** - Lua runtime

## Preview

![Behavior3 Editor Preview](media/images/pic.png)

## Highlights

- Visual graph editor for Behavior3 trees and reachable subtrees
- Dedicated Inspector in `sidebar` or `embedded` mode, with optional raw node JSON view
- Explorer `Behavior3` submenu for project, tree, and script scaffolding
- Project build, debug build, checker hooks, visibility hooks, and batch processing
- Auto-open for likely behavior-tree JSON files when a matching `*.b3-setting` is available
- Custom node definitions via `*.b3-setting`
- Workspace-driven validation, script loading, and node color overrides via `*.b3-workspace`
- Theme-aware UI for dark and light VS Code themes

## Quick Start

### 1. Create or open a project

From a folder's Explorer `Behavior3` submenu you can run:

- **Create Project**
- **Create Behavior Tree File**
- **Create Build Script**
- **Create Batch Script**
- **Create Checker Script**
- **Run Script as Batch Process**

`Create Project` scaffolds a minimal starter project with:

- `node-config.b3-setting`
- `workspace.b3-workspace`
- `example.json`

You can also open an existing workspace that already contains `*.json` trees, a `*.b3-setting` node-definition file, and optionally a `*.b3-workspace` file.

### 2. Open and switch editors

- Right-click a tree `.json` file in Explorer and select **Open With** -> **Behavior3 Editor**
- Or use **Open with Behavior3** from the Explorer `Behavior3` submenu on a `.json` file
- Press `F4` to toggle between the text editor and the Behavior3 editor for the current tree file

If a JSON file looks like a behavior tree and a parent `*.b3-setting` exists, Behavior3 can auto-open it in preview mode. Plain JSON files continue to open in the default text editor.

### 3. Inspect and edit

- Use the **Behavior3** activity bar view for the dedicated Inspector in `sidebar` mode
- Or set `behavior3.inspectorMode` to `embedded` to show the Inspector inside the editor webview
- Use **Toggle Node JSON** to switch between form-based Inspector editing and raw node JSON

### 4. Build or batch process

- Click **Build Behavior Tree** in the editor title bar, or press `Ctrl/Cmd+B`
- Press `Ctrl/Cmd+Shift+B` to start **Debug Build Behavior Tree**
- Use **Run Script as Batch Process** on a folder to pick a script, or run it directly from a `.ts`, `.mts`, `.js`, or `.mjs` file

## Typical Project Layout

```text
my-project/
  node-config.b3-setting
  workspace.b3-workspace
  example.json
  scripts/
    build.ts
    batch.ts
    checkers/
      checker_and_visible.ts
```

Behavior3 discovers `*.b3-workspace` and `*.b3-setting` by walking upward from the active tree or script context.

## Configure Node Definitions

Create a `*.b3-setting` file in the workspace:

```json
[
    {
        "name": "MyAction",
        "type": "Action",
        "desc": "Does something useful",
        "args": [{ "name": "duration", "type": "float", "desc": "Duration in seconds" }]
    },
    {
        "name": "CheckScore",
        "type": "Condition",
        "desc": "Checks whether the score matches the rule",
        "args": [{ "name": "value", "type": "expr", "desc": "Expression" }]
    }
]
```

`Create Project` seeds `node-config.b3-setting` with the built-in node definitions from the runtime.

## Configure Workspace Behavior

Use a `*.b3-workspace` file to control validation, script loading, and editor presentation:

```json
{
    "settings": {
        "checkExpr": true,
        "allowNewFunction": true,
        "buildScript": "scripts/build.ts",
        "checkScripts": ["scripts/checkers/**/*.ts"],
        "nodeColors": {
            "Action": "#0f766e",
            "Condition": "#b45309"
        }
    }
}
```

- `checkExpr`: enable expression validation for expression-like args
- `allowNewFunction`: allow inline visibility expressions that rely on `new Function`; defaults to `false`
- `buildScript`: load one build hook module for project builds
- `checkScripts`: load custom `@behavior3.check(...)` and `@behavior3.visible(...)` modules from glob matches
- `nodeColors`: override graph colors for `Composite`, `Decorator`, `Condition`, `Action`, `Other`, and `Error`

`buildScript` and `checkScripts` are resolved relative to the `*.b3-workspace` file. Changes to `allowNewFunction` and `nodeColors` are refreshed without reopening the editor.

See [sample/workspace.b3-workspace](sample/workspace.b3-workspace) for a complete sample.

## Inspector Modes

Set `behavior3.inspectorMode` to choose the active Inspector presentation:

- `sidebar`: show the Inspector in the dedicated Behavior3 side view
- `embedded`: show the Inspector inside the main editor webview

Both modes share the same document semantics and commands. Only the presentation changes.

## Build, Batch, Checker, and Visibility Scripts

Behavior3 supports ESM JavaScript and TypeScript scripts:

- JavaScript: `.js`, `.mjs`
- TypeScript: `.ts`, `.mts` (runtime transpile, no type-check)

When importing local TypeScript helpers, use explicit extensions such as `./helper.ts`.
The `behavior3` decorator namespace is provided by the runtime, so script files only need type imports from `vscode-behavior3/build`.

Example scripts are available in:

- [sample/scripts/build.ts](sample/scripts/build.ts)
- [sample/scripts/batch.ts](sample/scripts/batch.ts)
- [sample/scripts/checkers/checker_and_visible.ts](sample/scripts/checkers/checker_and_visible.ts)

### Build Scripts

Build scripts are declared with `@behavior3.build` and can transform build output without rewriting source trees.

```ts
import type { BuildEnv, BuildScript } from "vscode-behavior3/build";

@behavior3.build
export class ProjectBuild implements BuildScript {
    constructor(private readonly env: BuildEnv) {}
}
```

Supported hooks:

- `onProcessTree(tree, path, errors)`
- `onProcessNode(node, errors)`
- `onWriteFile(path, tree)`
- `onComplete(status)`

### Batch Scripts

Batch scripts are declared with `@behavior3.batch` and are used by **Run Script as Batch Process** to rewrite source trees in place across the current project.

Supported hooks:

- `shouldUpgradeTree(path, tree)`
- `onProcessTree(tree, path, errors)`
- `onProcessNode(node, errors)`
- `onWriteFile(path, tree)`
- `onComplete(status)`

By default, batch processing only writes back tree changes made by the batch script itself. Use `shouldUpgradeTree()` when you want to persist normalization or upgrade writes for a source tree.

### Checker and Visibility Hooks

- `@behavior3.check("name")` registers a custom field validator used by both Inspector validation and project builds
- `@behavior3.visible("name")` registers a field-visibility hook used by the Inspector and hidden-field cleanup
- `checkScripts` modules can register both checker hooks and visibility hooks

Inline visibility expressions that rely on `new Function` only run when `allowNewFunction` is enabled in `*.b3-workspace`.

For compatibility, supported script files may still export classes through named `Hook`, `BuildHook`, `BatchHook`, or `default`, but the decorator-based APIs above are the canonical forms.

## Build and CLI

Behavior3 can build from the editor UI, the Inspector view, or the CLI.

- **Build Behavior Tree** chooses an output folder and remembers the last output folder per workspace
- **Debug Build Behavior Tree** launches the CLI under the VS Code debugger so source maps from transpiled TypeScript build scripts work
- CLI discovery starts from `--project` when provided, otherwise from the current working directory

Install as a dev dependency:

```bash
npm install -D vscode-behavior3
```

Use it from a package script:

```json
{
    "scripts": {
        "build:behavior": "behavior3-build --project ./workdir/hero.json --output ./dist/behavior3"
    }
}
```

Run it directly:

```bash
npm exec -- behavior3-build --project ./workdir/hero.json --output ./dist/behavior3
```

Or without installing first:

```bash
npx --package vscode-behavior3 behavior3-build --project ./workdir/hero.json --output ./dist/behavior3
```

CLI options:

- `--output <dir>`: output directory for built JSON files
- `--project <path>`: tree file, project directory, or `*.b3-workspace` file to resolve from
- `--workspace-file <file>`: use an explicit `*.b3-workspace` file
- `--setting-file <file>`: use an explicit `*.b3-setting` file
- `--workspace-root <dir>`: limit upward discovery to a specific directory
- `--check-expr` / `--no-check-expr`: enable or disable expression validation
- `--build-script-debug`: enable sourcemapped build script debugging

## Command Surface

### Explorer `Behavior3` submenu

- On folders: **Create Project**, **Create Behavior Tree File**, **Create Build Script**, **Create Batch Script**, **Create Checker Script**, **Run Script as Batch Process**
- On script files: **Run Script as Batch Process**
- On `.json` files: **Open with Behavior3**

### Command Palette and view actions

- **Open Node Config (.b3-setting)** opens the nearest resolved node-definition file
- **Toggle Text / Behavior3** switches the current file between the custom editor and the text editor
- **Toggle Node JSON** switches the Inspector between structured fields and raw node JSON

## Extension Settings

| Setting                     | Type      | Default     | Description                                                              |
| --------------------------- | --------- | ----------- | ------------------------------------------------------------------------ |
| `behavior3.checkExpr`       | `boolean` | `true`      | Enable expression validation for expression-type args.                   |
| `behavior3.language`        | `string`  | `"auto"`    | UI language: `auto`, `zh`, or `en`.                                      |
| `behavior3.subtreeEditable` | `boolean` | `true`      | Allow editing supported subtree content from the current editor context. |
| `behavior3.inspectorMode`   | `string`  | `"sidebar"` | Choose whether the Inspector is shown in `sidebar` or `embedded` mode.   |

## Keyboard Shortcuts

| Key                      | Action                         |
| ------------------------ | ------------------------------ |
| `Ctrl/Cmd+Z`             | Undo                           |
| `Ctrl+Y` / `Cmd+Shift+Z` | Redo                           |
| `Ctrl/Cmd+C`             | Copy node                      |
| `Ctrl/Cmd+V`             | Paste node                     |
| `Ctrl/Cmd+Shift+V`       | Replace node                   |
| `Enter` / `Insert`       | Insert node                    |
| `Delete` / `Backspace`   | Delete selected node           |
| `Ctrl/Cmd+F`             | Search node content            |
| `Ctrl/Cmd+G`             | Jump to node by id             |
| `Ctrl/Cmd+B`             | Build                          |
| `Ctrl/Cmd+Shift+B`       | Debug build                    |
| `F4`                     | Toggle Text / Behavior3 editor |

## Docs

- [docs/README.md](docs/README.md) - documentation entry point
- [docs/spec-driven-development.md](docs/spec-driven-development.md) - SDD workflow
- [docs/spec/README.md](docs/spec/README.md) - baseline spec map and work-item index
- [sample/](sample) - sample workspace, trees, and scripts

## Development

- `npm run build` - production extension + webview build
- `npm run build:dev` - development build
- `npm run watch:ext` - watch extension bundle
- `npm run watch:webview` - watch webview bundle
- `npm run check` - type-check extension and webview TypeScript
- `npm run test:shared` - run shared test suite
- Output logs: **View -> Output** -> **Behavior3**
- Webview logs are also available in DevTools

## Requirements

- VS Code `^1.105.0`
- Node `>=20.19` for the CLI and TypeScript script runtime

## License

MIT
