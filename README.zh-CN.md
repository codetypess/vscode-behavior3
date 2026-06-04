# Behavior3 Editor 中文使用说明

Behavior3 Editor 是一个面向 Behavior3 JSON 行为树的 VS Code 自定义编辑器与构建工具链，提供图形化画布、Inspector、项目脚手架，以及 build / batch / check 脚本能力，适合游戏 AI 工作流。

英文说明见 [README.md](README.md)。

## 相关项目

- **[behavior3-ts](https://github.com/codetypess/behavior3-ts)** - TypeScript 运行时库
- **[behavior3lua](https://github.com/zhandouxiaojiji/behavior3lua)** - Lua 运行时库

## 预览

![Behavior3 Editor Preview](media/images/pic.png)

## 功能概览

- 图形化编辑 Behavior3 主树与可达子树
- Inspector 支持 `sidebar` 与 `embedded` 两种模式，并可切换节点原始 JSON 视图
- Explorer 中提供 `Behavior3` 子菜单，用于创建项目、行为树与脚本脚手架
- 支持项目构建、调试构建、字段检查器、字段可见性钩子与批处理脚本
- 当 JSON 文件看起来像行为树且存在匹配的 `*.b3-setting` 时，可自动以 Behavior3 编辑器预览打开
- 通过 `*.b3-setting` 自定义节点定义
- 通过 `*.b3-workspace` 控制校验、脚本加载与节点颜色覆盖
- 自动适配 VS Code 深色/浅色主题

## 快速开始

### 1. 创建或打开项目

在 Explorer 中右键文件夹，打开 `Behavior3` 子菜单，可以使用以下命令：

- **Create Project**
- **Create Behavior Tree File**
- **Create Build Script**
- **Create Batch Script**
- **Create Checker Script**
- **Run Script as Batch Process**

`Create Project` 会生成一套最小可运行项目骨架：

- `node-config.b3-setting`
- `workspace.b3-workspace`
- `example.json`

你也可以直接打开一个已有项目目录，只要其中包含行为树 `*.json`、节点定义 `*.b3-setting`，并可选包含 `*.b3-workspace`。

### 2. 打开与切换编辑器

- 在 Explorer 中右键行为树 `.json` 文件，选择 **Open With** -> **Behavior3 Editor**
- 或在该 `.json` 文件的 `Behavior3` 子菜单中执行 **Open with Behavior3**
- 按 `F4` 可在文本编辑器与 Behavior3 编辑器之间切换当前树文件

如果某个 JSON 文件具备行为树结构，且它的父目录或上级目录中能解析到 `*.b3-setting`，扩展会自动以预览模式打开该文件；普通 JSON 文件仍会继续使用默认文本编辑器打开。

### 3. 使用 Inspector 编辑

- 使用活动栏中的 **Behavior3** 视图，在 `sidebar` 模式下查看独立 Inspector
- 或将 `behavior3.inspectorMode` 设置为 `embedded`，把 Inspector 嵌入编辑器 webview 中
- 使用 **Toggle Node JSON** 在表单式编辑与节点原始 JSON 之间切换

### 4. 构建或批处理

- 点击编辑器标题栏中的 **Build Behavior Tree**，或按 `Ctrl/Cmd+B`
- 按 `Ctrl/Cmd+Shift+B` 启动 **Debug Build Behavior Tree**
- 在文件夹上使用 **Run Script as Batch Process** 时会先选择脚本；直接在 `.ts`、`.mts`、`.js`、`.mjs` 文件上执行时会直接运行该脚本

## 典型项目结构

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

Behavior3 会从当前激活的行为树或脚本上下文出发，向上查找 `*.b3-workspace` 与 `*.b3-setting`。

## 配置节点定义

在工作区中创建一个 `*.b3-setting` 文件：

```json
[
    {
        "name": "MyAction",
        "type": "Action",
        "desc": "执行一个动作",
        "args": [{ "name": "duration", "type": "float", "desc": "持续时间（秒）" }]
    },
    {
        "name": "CheckScore",
        "type": "Condition",
        "desc": "判断分数是否符合规则",
        "args": [{ "name": "value", "type": "expr", "desc": "表达式" }]
    }
]
```

如果使用 `Create Project`，生成的 `node-config.b3-setting` 会自动带上运行时内置节点定义。

## 配置工作区行为

通过 `*.b3-workspace` 控制校验、脚本加载与编辑器表现：

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

- `checkExpr`：开启表达式参数校验
- `allowNewFunction`：允许执行依赖 `new Function` 的内联可见性表达式；默认值为 `false`
- `buildScript`：指定项目 build hook 模块
- `checkScripts`：加载匹配到的自定义 `@behavior3.check(...)` 与 `@behavior3.visible(...)` 模块
- `nodeColors`：覆盖图中 `Composite`、`Decorator`、`Condition`、`Action`、`Other`、`Error` 节点颜色

`buildScript` 和 `checkScripts` 都是相对 `*.b3-workspace` 文件所在目录解析的。修改 `allowNewFunction` 与 `nodeColors` 后，无需重开编辑器即可刷新生效。

完整示例可参考 [sample/workspace.b3-workspace](sample/workspace.b3-workspace)。

## Inspector 模式

通过 `behavior3.inspectorMode` 控制 Inspector 呈现方式：

- `sidebar`：在独立的 Behavior3 侧边视图中显示 Inspector
- `embedded`：在主编辑器 webview 中显示 Inspector

两种模式共用同一套文档语义与命令，差别只在界面位置。

## Build / Batch / Check / Visible 脚本

Behavior3 支持 ESM JavaScript 与 TypeScript 脚本：

- JavaScript：`.js`、`.mjs`
- TypeScript：`.ts`、`.mts`（运行时转译，不做类型检查）

如果脚本里导入本地 TypeScript 辅助文件，请使用显式扩展名，例如 `./helper.ts`。
运行时会自动注入 `behavior3` 装饰器命名空间，因此脚本只需要从 `vscode-behavior3/build` 导入类型。

示例脚本可参考：

- [sample/scripts/build.ts](sample/scripts/build.ts)
- [sample/scripts/batch.ts](sample/scripts/batch.ts)
- [sample/scripts/checkers/checker_and_visible.ts](sample/scripts/checkers/checker_and_visible.ts)

### Build 脚本

Build 脚本使用 `@behavior3.build` 声明，可在构建输出阶段变换树数据，而不改写源文件。

```ts
import type { BuildEnv, BuildScript } from "vscode-behavior3/build";

@behavior3.build
export class ProjectBuild implements BuildScript {
    constructor(private readonly env: BuildEnv) {}
}
```

支持的 hook：

- `onProcessTree(tree, path, errors)`
- `onProcessNode(node, errors)`
- `onWriteFile(path, tree)`
- `onComplete(status)`

### Batch 脚本

Batch 脚本使用 `@behavior3.batch` 声明，由 **Run Script as Batch Process** 调用，用于批量原地改写项目中的源树文件。

支持的 hook：

- `shouldUpgradeTree(path, tree)`
- `onProcessTree(tree, path, errors)`
- `onProcessNode(node, errors)`
- `onWriteFile(path, tree)`
- `onComplete(status)`

默认情况下，batch 只会把脚本本身造成的树变更写回源文件；如果你想把规范化或升级结果也写回去，可以通过 `shouldUpgradeTree()` 显式声明。

### Checker 与 Visible 钩子

- `@behavior3.check("name")`：注册字段校验器，同时用于 Inspector 校验与项目构建
- `@behavior3.visible("name")`：注册字段可见性钩子，用于 Inspector 展示与隐藏字段清理
- `checkScripts` 匹配到的模块可以同时注册 checker 和 visible

依赖 `new Function` 的内联可见性表达式只有在 `*.b3-workspace` 中开启 `allowNewFunction` 后才会执行。

为兼容旧形式，受支持的脚本模块仍可以通过命名导出 `Hook`、`BuildHook`、`BatchHook` 或 `default` 暴露类，但推荐优先使用上面的装饰器形式。

## 构建与 CLI

Behavior3 支持从编辑器、Inspector 视图或 CLI 发起构建。

- **Build Behavior Tree** 会先选择输出目录，并按工作区记住上一次使用的输出目录
- **Debug Build Behavior Tree** 会在 VS Code 调试器下启动 CLI，方便调试经过运行时转译的 TypeScript build 脚本
- CLI 会优先从 `--project` 指定路径开始解析；如果没有提供，则从当前工作目录开始向上查找

安装为开发依赖：

```bash
npm install -D vscode-behavior3
```

在 `package.json` 中作为脚本使用：

```json
{
    "scripts": {
        "build:behavior": "behavior3-build --project ./workdir/hero.json --output ./dist/behavior3"
    }
}
```

直接运行：

```bash
npm exec -- behavior3-build --project ./workdir/hero.json --output ./dist/behavior3
```

或者不安装直接使用：

```bash
npx --package vscode-behavior3 behavior3-build --project ./workdir/hero.json --output ./dist/behavior3
```

CLI 参数：

- `--output <dir>`：输出目录
- `--project <path>`：解析起点，可为树文件、项目目录或 `*.b3-workspace`
- `--workspace-file <file>`：显式指定 `*.b3-workspace`
- `--setting-file <file>`：显式指定 `*.b3-setting`
- `--workspace-root <dir>`：限制向上查找的根目录
- `--check-expr` / `--no-check-expr`：启用或关闭表达式校验
- `--build-script-debug`：启用带 sourcemap 的 build script 调试模式

## 命令入口

### Explorer 中的 `Behavior3` 子菜单

- 文件夹上：**Create Project**、**Create Behavior Tree File**、**Create Build Script**、**Create Batch Script**、**Create Checker Script**、**Run Script as Batch Process**
- 脚本文件上：**Run Script as Batch Process**
- `.json` 文件上：**Open with Behavior3**

### 命令面板与视图操作

- **Open Node Config (.b3-setting)**：打开最近解析到的节点定义文件
- **Toggle Text / Behavior3**：在当前文件的文本编辑器与自定义编辑器之间切换
- **Toggle Node JSON**：在 Inspector 中切换结构化表单与原始节点 JSON

## 扩展设置

| 设置项                      | 类型      | 默认值      | 说明                                 |
| --------------------------- | --------- | ----------- | ------------------------------------ |
| `behavior3.checkExpr`       | `boolean` | `true`      | 是否启用表达式参数校验               |
| `behavior3.language`        | `string`  | `"auto"`    | UI 语言，可选 `auto`、`zh`、`en`     |
| `behavior3.subtreeEditable` | `boolean` | `true`      | 是否允许在当前上下文编辑可支持的子树 |
| `behavior3.inspectorMode`   | `string`  | `"sidebar"` | Inspector 显示在侧栏还是嵌入编辑器中 |

## 快捷键

| 快捷键                   | 作用                        |
| ------------------------ | --------------------------- |
| `Ctrl/Cmd+Z`             | 撤销                        |
| `Ctrl+Y` / `Cmd+Shift+Z` | 重做                        |
| `Ctrl/Cmd+C`             | 复制节点                    |
| `Ctrl/Cmd+V`             | 粘贴节点                    |
| `Ctrl/Cmd+Shift+V`       | 替换节点                    |
| `Enter` / `Insert`       | 插入节点                    |
| `Delete` / `Backspace`   | 删除选中节点                |
| `Ctrl/Cmd+F`             | 搜索节点内容                |
| `Ctrl/Cmd+G`             | 按节点 id 跳转              |
| `Ctrl/Cmd+B`             | 构建                        |
| `Ctrl/Cmd+Shift+B`       | 调试构建                    |
| `F4`                     | 切换文本 / Behavior3 编辑器 |

## 进一步阅读

- [README.md](README.md) - 英文总览
- [docs/README.md](docs/README.md) - 文档入口
- [docs/spec-driven-development.md](docs/spec-driven-development.md) - 仓库内 SDD 工作流
- [docs/spec/README.md](docs/spec/README.md) - 基线 spec 地图与 work-item 索引
- [sample/](sample) - 示例工作区、行为树与脚本

## 开发

- `npm run build` - 生产构建扩展与 webview
- `npm run build:dev` - 开发构建
- `npm run watch:ext` - 监听扩展 bundle
- `npm run watch:webview` - 监听 webview bundle
- `npm run check` - 对扩展与 webview 做 TypeScript 检查
- `npm run test:shared` - 运行 shared 测试
- 日志输出：**View -> Output** -> **Behavior3**
- Webview 日志也可在 DevTools 中查看

## 运行环境要求

- VS Code `^1.105.0`
- Node `>=20.19`，用于 CLI 与 TypeScript 脚本运行时

## 许可证

MIT
