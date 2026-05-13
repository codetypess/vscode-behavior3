# Webview Watch Stability and Vite 8 Migration

Status: Verifying
Date: 2026-05-14
Scope: 稳定 Behavior3 webview 的开发态 watch 构建，并迁移到 Vite 8 / plugin-react 5。

## 1. Context

当前 `watch:webview` 直接运行 `vite build --watch --mode development`。全量开发构建通常可以完成，但用户在编辑 webview 文件后的增量 rebuild 中遇到：

- 超大单 chunk 警告，主 bundle 在开发态达到数十 MB。
- watch 第二轮 build 偶发抛出 `[commonjs] Cannot read properties of undefined (reading 'resolved')`，导致 webview watch 中断。

和 `vscode-xlsx-diff` 相比，Behavior3 还缺少一层显式的脚本化 webview build/watch 包装，因此 task problem matcher、watch 生命周期日志和构建配置都直接耦合在 Vite CLI 默认输出上。

另外，用户已明确要求升级到 Vite 8。Vite 8 自 2026-03-12 稳定发布后，构建底层切到 Rolldown/Oxc，并要求 Node.js `20.19+` 或 `22.12+`。当前仓库仍停留在 Vite 6 与 `@vitejs/plugin-react` 4，且 `engines.node` 仍为 `>=18`，不满足官方迁移要求。

## 2. Goals

- 让 `watch:webview` 通过专用脚本启动，而不是直接依赖 `vite build --watch` CLI。
- 保持 webview 开发构建支持 watch，并为 VS Code tasks 输出稳定的开始/结束标记。
- 降低开发态 webview 单 bundle 体积，避免所有第三方依赖长期落进一个超大 chunk。
- 将 webview 工具链升级到 Vite 8，并保持 React webview 能正常构建与 watch。
- 让仓库 Node 引擎声明与 Vite 8 官方要求一致。
- 不改变 webview 产物目录、入口 HTML 路径或运行时加载方式。

## 3. Non-Goals

- 不把 webview 开发链改成 Vite dev server/HMR。
- 不升级 React、Ant Design、G6 或 Vite 主版本。
- 不把 extension host 的 `esbuild` 构建链替换成 Vite。
- 不重构业务代码来做大规模动态 import 切分。
- 不改变扩展宿主 `watch:ext` / `build:dev` 的责任边界。

## 4. Current Behavior

- `package.json` 中 `watch:webview` 直接执行 `vite build --watch --mode development`。
- `.vscode/tasks.json` 需要靠 Vite CLI 的自然输出去匹配 background begin/end。
- webview 只有一个 HTML 入口，当前没有显式 `manualChunks`，因此开发态容易把大量 `node_modules` 依赖压进单一入口 chunk。
- 用户保存文件后，第二轮 watch rebuild 存在 CLI/插件链路不稳定的问题，错误来自 CommonJS transform 阶段，而不是业务源码本身的类型或语法错误。
- 当前 `package.json` 仍声明 `engines.node: >=18`，与 Vite 7/8 官方所需的 `20.19+ / 22.12+` 不一致。
- 当前 webview build 配置使用 `build.rollupOptions.output.manualChunks` 函数式写法；Vite 8 迁移指南明确标记该写法已 deprecated，并建议迁移到 Rolldown 的 `codeSplitting` 能力。
- `behavior3@1.1.0` 的发布产物仍包含 `@registerNode` decorator 语法；Vite 6 旧链路未暴露问题，但 Vite 8 / Rolldown 在 webview build 中会直接保留该语法，导致 Chromium webview 在解析 vendor chunk 时抛出 `Invalid or unexpected token`。

## 5. Proposed Behavior

- 新增仓库内的 webview Vite 构建脚本，统一承载普通 build、开发 build 和 watch build。
- `watch:webview` 改为执行该脚本的 `--watch` 模式，并输出 `[watch] build started` / `[watch] build finished`。
- 脚本内显式声明 webview build 配置，并用 Rolldown 兼容的代码分组方式减少单一超大 chunk。
- watch 模式不再依赖 Rolldown 内建 watch，而是由脚本用 `chokidar` 监听源码变更后串行触发 Vite 单次 build。
- 对 `behavior3/dist/index.mjs` 注入一层窄范围转译，使其 decorator 语法在 webview 产物中降级为普通 ES2020 代码。
- `.vscode/tasks.json` 的 `watch:webview` problem matcher 改为匹配脚本输出，而不是直接依赖 Vite 默认文案。
- `vite` 升到 8.x，`@vitejs/plugin-react` 升到与 Vite 8 兼容的 5.x。
- `engines.node` 至少提升到 `>=20.19`。

## 6. Design

- 新增 `scripts/vite-webview.mjs`，使用 Vite JS API 调用 `build()`。
- 脚本保留当前 `root`、`publicDir`、`outDir`、开发态 sourcemap 与 React plugin 行为。
- 在 watch 模式下由脚本自身输出 problem matcher 所需的开始/结束日志，并在错误时输出 `✘ [ERROR] ...`。
- 额外加入一个只命中 `behavior3/dist/index.mjs` 的 transform plugin，用 TypeScript transpile 将 decorator 语法转成浏览器可解析的输出。
- 依赖版本策略：
  - `vite` 升到 `^8`
  - `@vitejs/plugin-react` 升到 `^5`
  - `engines.node` 提升到 `>=20.19`
- 使用 Rolldown 兼容的 `build.rolldownOptions.output.codeSplitting.groups` 将大型第三方依赖至少拆成：
  - `graph-vendor`：G6、布局与图相关依赖
  - `ui-vendor`：Ant Design 与其 RC 生态
  - `vendor`：其余 `node_modules`
- `chokidar` 监听范围仅覆盖 `webview/`、`media/` 及 webview Vite 配置文件，避免把 `dist/` 产物重新喂回 watch。
- 视最终产物情况调整 `chunkSizeWarningLimit`，避免开发态长期输出低价值噪音。

## 7. Implementation Plan

1. 新建 work-item spec，固定范围与验收标准。
2. 添加或完善 `scripts/vite-webview.mjs`，迁移当前 webview build 配置，并以 `chokidar` 接管源码 watch。
3. 升级 `vite` / `@vitejs/plugin-react` 及 lockfile，并同步更新 `engines.node`。
4. 更新 webview build 配置为 Vite 8 / Rolldown 兼容写法。
5. 更新 `.vscode/tasks.json` 的 `watch:webview` problem matcher，使其匹配脚本日志。
6. 运行开发构建与 watch 验证，确认产物、日志与调试链路可用。

## 8. Testing Plan

自动检查：

- 运行 `npm run build:dev`。
- 运行 `npm run watch:webview`，确认首轮 build 完成并保持 watch 运行。

手动回归：

1. 启动 VS Code 扩展调试。
2. 触发默认 `watch` task，确认 `watch:webview` 能进入 background ready。
3. 修改一个 webview 文件并保存，确认 watch 会触发增量 rebuild，且不因 CommonJS rebuild 错误直接退出。
4. 打开 webview，确认静态资源与页面加载未回归。
5. 打开 webview，确认不再出现 `vendor-*.js` 的 `Invalid or unexpected token` decorator 解析错误。

## 9. Acceptance Criteria

- `watch:webview` 不再直接调用 `vite build --watch --mode development`。
- `watch:webview` 输出稳定的 `[watch] build started` / `[watch] build finished` 日志。
- `npm run build:dev` 成功生成 webview 产物。
- 开发态 webview 不再把绝大多数第三方依赖压进单一入口 chunk。
- 仓库依赖升级到 Vite 8，并且 React webview 构建链仍然可用。
- `package.json` 的 Node 引擎声明与 Vite 8 官方要求一致。
- VS Code `Run Extension` 默认 watch 调试链路仍能正常启动。
- webview 运行时不再因为 `behavior3` 依赖中的 decorator 语法而在 vendor chunk 解析阶段崩溃。

## 10. Risks and Rollback

风险：

- chunk 切分后，资源命名或注入顺序若处理不当，可能影响 webview HTML 的静态资源引用。
- 若 CommonJS rebuild 崩溃来自 Vite/Rollup 更底层的问题，仅脚本化包装可能不足以完全消除，需要进一步收紧配置。

回滚：

- 保留当前入口、输出目录与 build 模式不变，因此可以直接把 `package.json` 脚本切回原始 `vite build` CLI，并删除新脚本与 matcher 调整。
