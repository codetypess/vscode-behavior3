# Inspector Mode Config

Status: Verifying
Date: 2026-05-11
Scope: inspector host/editor presentation mode

## 1. Context

当前产品基线把 Inspector 固定为独立的 VS Code Sidebar webview。主编辑器只展示画布，`InspectorSidebarCoordinator` 负责把当前激活 Behavior3 编辑器的上下文镜像到侧栏，并代理侧栏发起的 mutation/save/undo/redo。

用户现在希望 Inspector 支持二选一：

- `sidebar`
- `embedded`

这里的重点不是“同时支持两套业务逻辑”，而是“用一份配置决定唯一启用哪条展示路径”。

## 2. Goals

- 新增 `behavior3.inspectorMode` 配置，支持 `sidebar` 和 `embedded`。
- 保持默认行为与当前版本兼容，即默认仍为 `sidebar`。
- `embedded` 模式下，主编辑器在同一 webview 内同时展示 graph 与 Inspector。
- `sidebar` 模式下，继续沿用当前独立 sidebar + host proxy 语义。
- 配置变更后，已打开的编辑器与侧栏能吸收新模式，而不要求重启扩展。

## 3. Non-Goals

- 不支持 `both`。
- 不新增第二套 Inspector 业务实现；Tree/Node Inspector 继续复用同一套 feature 组件。
- 不在本次实现中引入 editor 内嵌 inspector 的可拖拽宽度调节；第一版使用固定宽度。
- 不重构当前 host-first mutation、selection snapshot 或 sidebar proxy 语义。
- 不要求通过配置把 VS Code 贡献出来的 sidebar 视图节点彻底从 UI 树上移除；嵌入模式下允许其退化为非主通路。

## 4. Current Behavior

- `package.json` 只贡献一个 `behavior3.inspectorView` sidebar view。
- `InspectorSidebarProvider` 固定以 `mode: "inspector-sidebar"` 启动 webview。
- editor webview 只渲染 graph，不渲染 `InspectorPane`。
- `InspectorSidebarCoordinator` 默认假设 sidebar 是 Inspector 的唯一宿主，并会在 selection reassert 时 reveal/focus 该 view。
- session `settings` 中没有 inspector 展示模式字段。

## 5. Proposed Behavior

### 5.1 Config

新增 VS Code 配置：

- `behavior3.inspectorMode = "sidebar" | "embedded"`

默认值：

- `sidebar`

### 5.2 Sidebar Mode

- 当前行为保持不变。
- 主编辑器只显示 graph。
- sidebar 继续展示 Tree/Node Inspector，并通过 host proxy 把编辑操作路由回当前激活编辑器对应的 session。
- selection reassert 继续可以 re-reveal sidebar。

### 5.3 Embedded Mode

- 主编辑器显示 graph + 内嵌 Inspector，两者共享同一 editor runtime/store。
- 内嵌 Inspector 直接调用 editor runtime/controller，不通过 sidebar proxy。
- `InspectorSidebarCoordinator` 不再主动 reveal/focus sidebar，也不把 sidebar 作为当前文档的主展示通路。
- 若用户手动打开 sidebar，它不再承载主编辑流，而应显示嵌入模式提示或等价的不可用状态，避免形成第二套可编辑入口。

### 5.4 Live Updates

- 打开的 editor session 在收到 `settingLoaded` 后应更新 `inspectorMode`。
- 从 `sidebar -> embedded`：
  - editor 内嵌布局出现
  - sidebar 不再被 reveal/focus
- 从 `embedded -> sidebar`：
  - editor 恢复纯 graph
  - coordinator 恢复 sidebar reveal/同步职责

## 6. Design

### 6.1 Settings / Protocol

将 `inspectorMode` 视为 stable `Settings` 的一部分，并通过：

- host `init`
- host `settingLoaded`
- webview `workspaceStore.settings`

统一下发。

`webviewKind` 继续只表达“当前 webview 宿主是什么”：

- `editor`
- `inspector-sidebar`

它不承担业务展示模式选择。

### 6.2 Editor Layout

editor `AppShell` 根据 `workspaceStore.settings.inspectorMode` 决定是否渲染内嵌 `InspectorPane`：

- `sidebar`: 仅 graph content
- `embedded`: graph content + fixed-width inspector sider

内嵌 inspector 使用 `InspectorModeProvider`，但不额外引入第二份 runtime/store。

### 6.3 Sidebar Coordinator

`InspectorSidebarCoordinator` 增加当前 inspector mode 概念：

- `sidebar` 时按现有语义工作
- `embedded` 时：
  - 不主动 reveal/focus sidebar
  - 不把 sidebar 当作活跃文档上下文的展示终点
  - 可在 sidebar 已打开时投递“当前模式为 embedded”的降级状态

### 6.4 Sidebar View Fallback

由于 VS Code view contribution 是静态声明，本次不把 sidebar contribution 从 manifest 中彻底移除。嵌入模式下的侧栏退化为只读/提示态，而不是第二个活跃编辑入口。

### 6.5 Fixed Width

内嵌 inspector 第一版使用固定宽度侧栏。宽度后续若要可调，应作为单独 work item 处理，并验证 graph viewport stability。

## 7. Implementation Plan

### Phase 1. Spec and Settings Plumbing

- 新增 work-item spec
- 扩展 `Settings` / host message / settings merge 通路
- 在 session 配置刷新里读取 `behavior3.inspectorMode`

Exit:

- editor 与 sidebar runtime 都能看到同一份 `inspectorMode`

### Phase 2. Host Mode Routing

- 让 `InspectorSidebarCoordinator` 感知当前模式
- `embedded` 模式下关闭 sidebar reveal/active-context 主通路语义

Exit:

- selection / theme / config 更新不会在 `embedded` 模式下强行拉起 sidebar

### Phase 3. Editor Embedded Layout

- editor `AppShell` 渲染 graph + embedded inspector
- 复用现有 `InspectorPane`

Exit:

- `embedded` 模式下在主编辑器内可完成 tree/node inspector 编辑

### Phase 4. Docs and Verification

- 更新相关基线 spec
- 跑 `npm run check` 与 `npm run build`
- 做最小人工回归

## 8. Testing Plan

- `npm run check`
- `npm run build`
- 人工验证：
  - `sidebar` 模式下打开编辑器、点 tree/node、确认 sidebar 仍同步且可编辑
  - `embedded` 模式下打开编辑器、点 tree/node、确认 editor 内出现 inspector 且可编辑
  - 在两种模式间切换配置，不重启扩展，确认布局与交互路径切换
  - `embedded` 模式下重复点击 node/tree 不再触发 sidebar reveal
  - `sidebar` 模式下重复点击 node/tree 仍能 re-reveal sidebar

## 9. Acceptance Criteria

- `behavior3.inspectorMode` 可配置为 `sidebar` 或 `embedded`，默认 `sidebar`。
- `sidebar` 模式下，当前主编辑器只显示 graph，sidebar 继续承担 Inspector 主入口。
- `embedded` 模式下，当前主编辑器显示 graph 与内嵌 Inspector，且可完成 tree/node 编辑。
- `embedded` 模式下，selection reassert 不会再主动 reveal/focus sidebar。
- `settingLoaded` 或 VS Code 配置变化后，已打开 editor 能吸收新的 inspector mode。
- `npm run check` 成功。
- `npm run build` 成功。

## 10. Risks and Rollback

- 风险：sidebar coordinator 仍按旧逻辑 reveal，导致嵌入模式下焦点被抢。
- 风险：editor 内嵌 inspector 与 graph 共用 runtime 后，某些 sidebar-only 分支仍走 host relay。
- 风险：manifest 中保留的 sidebar view 可能让用户误以为可同时编辑两处。

缓解：

- 把 reveal gating 收口到 coordinator。
- 保持 `webviewKind` 和 `settings.inspectorMode` 分离，避免把宿主种类和展示模式混为一谈。
- 在嵌入模式下给 sidebar 明确提示态。

Rollback:

- 删除 `inspectorMode` 配置并回退到默认 `sidebar`
- 移除 editor 内嵌布局
- 恢复 coordinator 始终驱动 sidebar 的现状
