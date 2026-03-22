# Behavior Tree Editor

A visual behavior tree editor for VSCode, designed for game AI development.

## Features

- **Visual canvas** — drag-and-drop behavior tree editing powered by AntV G6
- **Inspector panel** — click any node or tree to edit its properties in the right-hand panel of the editor
- **`.b3tree` file format** — dedicated extension to avoid conflict with plain JSON; also supports opening `.json` files via right-click → "Open With"
- **Node definitions** — load custom node types from a `.b3-setting` config file
- **Build command** — compile behavior trees with a single click (requires `.b3-setting`)
- **Expression validation** — optional syntax checking for expression-type arguments
- **Dark / light theme** — follows VSCode's current color theme

## Getting Started

### 1. Open a behavior tree file

Open any `.b3tree` file — the editor will open automatically in the custom canvas view.

To open a `.json` behavior tree:
- Right-click the file in Explorer → **Open With** → **Behavior Tree Editor**

To **always** open JSON under a given folder with this editor (without “Open With” each time), set **`workbench.editorAssociations`** in **User** or **Workspace** settings. Value is the custom editor id `behavior3.treeEditor`.

**Important:** If the pattern contains a `/`, VS Code matches it against **`scheme:absolutePath`** (e.g. `file:/Users/you/project/vars/foo.json`), **not** relative to the workspace root. So do **not** use `vars/**/*.json` — it will never match. Start the pattern with `**/` so any path prefix is allowed:

```json
"workbench.editorAssociations": {
  "**/vars/**/*.json": "behavior3.treeEditor",
  "**/workdir/**/*.json": "behavior3.treeEditor"
}
```

Use forward slashes in patterns. Keep globs narrow so other JSON files still open in the default editor. After changing settings, run **Developer: Reload Window** once. If it still opens wrong, use **View: Reopen Editor With…** and reset any remembered choice for that file type.

### 2. Create a new tree

Right-click a folder in the Explorer → **Behavior Tree: New .b3tree File**

### 3. Configure node definitions

Create a `.b3-setting` JSON file in your workspace that defines your custom node types:

```json
{
  "nodes": [
    {
      "name": "MyAction",
      "type": "Action",
      "desc": "Does something useful",
      "args": [
        { "name": "duration", "type": "float", "desc": "Duration in seconds" }
      ]
    }
  ]
}
```

The extension will automatically discover `.b3-setting` files in your workspace root. You can also specify a path explicitly via settings.

### 4. Build

Click the **▶ Build** button in the editor title bar (requires a `.b3-setting` file with a build configuration).

## Extension Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `behavior3.settingFile` | string | `""` | Path to node config file (relative to workspace root). Leave empty for auto-discovery. |
| `behavior3.checkExpr` | boolean | `true` | Enable expression syntax validation for expression-type node arguments. |

The extension **does not read or write** breadcrumb settings in code or `package.json`. If breadcrumbs disappeared after trying an experimental build, your **User** or **Workspace** `settings.json` may still contain values written at runtime. Open **Settings (JSON)** and remove or fix entries such as:

- `"breadcrumbs.enabled": false` → delete the line or set to `true`
- `"breadcrumbs.filePath": "off"` → use `"on"` or `"last"` if you want a visible path

Then **Developer: Reload Window**.

## Inspector (embedded)

The Inspector is the **right-hand panel inside the tree editor** (not a separate activity-bar view).

- **Select a node** on the canvas → edit its `args`, `input`/`output` variables, `desc`, `debug`, `disabled`
- **Click empty canvas** → edit tree-level properties (`name`, `desc`, `vars`, `import`, `group`)

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Ctrl/Cmd+Z` | Undo |
| `Ctrl/Cmd+Shift+Z` | Redo |
| `Delete` / `Backspace` | Delete selected node |
| `Ctrl/Cmd+C` | Copy node |
| `Ctrl/Cmd+V` | Paste node |
| `Ctrl/Cmd+A` | Select all |
| `Ctrl/Cmd+F` | Fit canvas to screen |

## Developing this extension

**Shared misc** lives in **`webview/shared/misc/`** (single source for webview + extension build). **`b3fs.ts`** exposes **`setFs` / `getFs` / `hasFs`**: until **`setFs`** is called, **`b3util`** behaves in **browser-safe** mode (no disk reads); the **extension host build** (`behavior3.build`) loads **`buildProject`** / **`initWorkdirFromSettingFile`** from the same **`b3util`**, and **`src/build/runBuild.ts`** calls **`setFs(fs)`** with Node’s **`fs`** so file access uses the real filesystem.

**Logs:** Open **View → Output**, choose channel **Behavior3**. **Extension host** `console.log` / `console.info` / `console.warn` / `console.error` are mirrored there (still also in the Debug Console). **Webview** `console.log` / `info` / `warn` / `error` / `debug` are mirrored the same way (still in DevTools).

**Build scripts** (`settings.buildScript` in `.b3-workspace`): the extension temporarily **`process.chdir`**s to the workspace file’s directory (same as desktop). Prefer **`path.join(env.workdir, …)`** for any `fs` paths in `onSetup` / hooks so it works even if cwd differs.

## Requirements

- VSCode 1.85.0 or higher

## License

MIT
