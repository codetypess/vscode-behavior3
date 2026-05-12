# Build Hotkey Single Dispatch

Status: Verifying
Date: 2026-05-12
Scope: 修复 Behavior3 custom editor 中 build 快捷键一次按键重复派发的问题。

## 1. Context

在 Behavior3 custom editor 获得焦点时，`Ctrl+B` / `Cmd+B` 当前可能同时经过两条路径进入 build：

1. VS Code 在 `package.json` 中贡献的 `behavior3.build` keybinding。
2. webview graph pane 中的 `Hotkey.Build` DOM key handler，该 handler 再向 extension host 发送 `build` message。

两条路径最终都会调用 `runBuild()`。第一次调用会设置 `buildInFlight = true`，第二次紧随其后的调用会命中单飞保护并提示 “A build is already running. Please wait for it to finish.”。

根因不是构建流程真的被用户重复触发，而是同一次快捷键按下被两个 keyboard owner 同时消费。

## 2. Goals

- 一次 `Ctrl+B` / `Cmd+B` 在 Behavior3 custom editor 中最多启动一次 build。
- 一次 `Ctrl+Shift+B` / `Cmd+Shift+B` 在 Behavior3 custom editor 中最多启动一次 debug build。
- 保留 `runBuild()` 的单飞保护，用于真实重叠构建。
- 保持 build 与 build debug 作为 extension-host command 的所有权。

## 3. Non-Goals

- 不重构 build pipeline。
- 不改变输出目录选择、节点参数检查、build result 回推或 debug launch 行为。
- 不移除真实重叠构建时的 already-running warning。
- 不清理 webview 到 host 的 build protocol 或 `buildDocument(opts?)` command。

## 4. Current Behavior

`package.json` 贡献了 custom editor 范围内的 `behavior3.build` / `behavior3.buildDebug` 快捷键，同时 `webview/features/graph/graph-pane.tsx` 也监听 `Hotkey.Build` / `Hotkey.BuildDebug`。

当图画布聚焦时，一次 build 快捷键可能先触发 extension-host command，再由 webview handler 发送第二个 build request。第二个 request 进入同一个 `runBuild()` 单飞保护，导致用户看到已经有 build 正在运行的提示。

## 5. Proposed Behavior

Build 与 build debug 快捷键只由 VS Code contributed keybindings 负责。

webview graph pane 不再绑定 build/build-debug 快捷键；webview 中仍保留搜索、结构编辑、undo/redo 等需要 graph-local 语义的快捷键。

## 6. Design

- 保留 `package.json` 中的 `behavior3.build` 与 `behavior3.buildDebug` keybinding contribution。
- 移除 graph pane 中的 `useKeyPress([Hotkey.Build, Hotkey.BuildDebug], ...)` handler。
- 若 `Hotkey.Build` 与 `Hotkey.BuildDebug` 不再被引用，则从 `webview/shared/keys.ts` 删除。
- 保留 `buildDocument(opts?)`、host adapter `sendBuild(opts)` 与 dispatcher 中的 `build` message 处理，避免把本次 bug fix 扩大成 protocol 清理。
- 保留 `src/build/run-build.ts` 的 `buildInFlight` guard。

## 7. Implementation Plan

1. 更新本 work-item spec 与受影响的 baseline spec。
2. 删除 graph pane 的 build/build-debug webview key handler。
3. 清理不再使用的 build hotkey 常量。
4. 运行类型检查和相关测试。
5. 手动验证 custom editor 图画布聚焦时 build 快捷键只触发一次。

## 8. Testing Plan

自动检查：

- 运行 `npm run check`。
- 如果仓库存在 `npm run test:shared`，运行该共享测试套件。

手动回归：

1. 启动 Extension Development Host。
2. 打开 Behavior3 JSON 文件并进入 custom editor。
3. 聚焦 graph canvas，按一次 `Ctrl+B` / `Cmd+B`。
4. 确认只出现一次 build 启动或输出目录选择，且不出现 already-running warning。
5. 按一次 `Ctrl+Shift+B` / `Cmd+Shift+B`，确认 debug build 只启动一次。
6. 在真实 build 仍在运行时再次触发 build，确认 already-running warning 仍出现。

## 9. Acceptance Criteria

- 一次 build 快捷键最多产生一次 `behavior3.build` 执行。
- 一次 build debug 快捷键最多产生一次 debug build 执行。
- 命令面板、编辑器标题 build action 与 host build message 仍能触发 build。
- `runBuild()` 仍拒绝真实并发 build，并显示 already-running warning。
- `npm run check` 通过。

## 10. Risks and Rollback

风险：VS Code contributed keybinding 在某些 webview focus 状态下可能不触发。当前缺陷本身说明 contributed keybinding 已经在图画布聚焦时触发，但仍需手动覆盖 graph canvas focus。

回滚方式：恢复 graph pane build key handler，并改为在 host dispatch 边界做显式来源感知的重复派发抑制。该方案范围更大，只有在 VS Code contributed keybinding 无法覆盖 graph focus 时再采用。
