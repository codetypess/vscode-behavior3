# Node Arg Visible Hooks

Status: Done
Date: 2026-05-29
Scope: build runtime / host protocol / inspector args

## 1. Context

`behavior3` 的 `NodeDef.args[].visible` 已经存在于上游类型中，但当前仓库没有保留该字段，也没有对应的脚本注册和执行链路。

当前自定义参数扩展只支持 `@behavior3.check(...)`：

- `checkScripts` 只注册 checker
- host 只暴露 `validateNodeChecks` 请求
- Inspector structured args 只消费固定 nodeDef 列表，不会按当前节点状态裁剪字段

因此即使节点定义声明了 `visible`，参数也始终展示。

## 2. Goals

- 支持通过 `@behavior3.visible(...)` 注册节点参数可见性函数。
- 让 `NodeDef.args[].visible` 可以在当前仓库内被解析、保留并执行。
- 让 Inspector structured args 根据函数返回结果决定当前字段是否展示。
- 保持现有 `checker` 运行时、提交语义和脚本发现规则兼容。

## 3. Non-Goals

- 不新增第二套文档写入或本地脚本执行运行时。
- 不改变 raw JSON 视图；该视图继续展示完整节点数据。
- 不为 `visible` 额外引入项目脚手架命令或 UI 配置入口。

## 4. Current Behavior

- `schema.ts` 在归一化 node defs 时会丢弃 `args[].visible`。
- `checkScripts` 只从匹配模块中识别 `@behavior3.check(...)`。
- Inspector structured args 无法向 host 请求可见性结果。

## 5. Proposed Behavior

- 节点定义中的 `args[].visible` 作为非空字符串被保留。
- `@behavior3.visible(name?)` 与 `@behavior3.check(name?)` 一样注册类导出；函数签名复用 `(value, ctx)`，其中 `ctx` 与 `NodeArgCheckContext` 相同。
- `visible(value, ctx)` 返回 `false` 时隐藏对应 structured arg；返回 `true`、`undefined` 或 `null` 时保持显示。
- 若 arg 引用的 `visible` 名称未注册，记录 output warning，并回退为保持显示。
- Inspector 只对当前选中节点请求参数可见性结果，并按返回结果过滤 structured args。
- 若 structured arg 的可见性结果为 `false`，Inspector 会清除该 arg 的 committed 值，并同步清空本地表单缓存；切换到 raw JSON 视图时仍可查看节点当前剩余数据。
- `checkScripts` 匹配的模块可同时导出 build / batch / check / visible；只有实际装饰过的 check/visible 类参与各自注册。
- `visible` 只影响 Inspector structured args 的展示，不改变现有 build/check 的导出判定、CLI 构建结果或节点参数校验行为。

## 6. Design

### 6.1 Shared Script Runtime

- 在 `b3build-model.d.ts` 中新增 `NodeArgVisibleResult`、`NodeArgVisible`、`NodeArgVisibleClass`、`VisibleDecorator`。
- `BuildRuntime` 新增 `visible` 装饰器入口，仅用于脚本装饰器注册。
- `b3build.ts` 为 `@behavior3.visible` 建立独立 marker、名称元数据和注册表。
- editor session 额外收集 `nodeArgVisibleHandlers`，但不改动现有 `BuildScriptRuntime` 的导出检查、`hasEntries` / `hasError` 语义。

### 6.2 Host Protocol

- 新增 host request `resolveNodeArgVisibility` / `resolveNodeArgVisibilityResult`。
- 请求只携带当前文档内容、树路径和一个目标节点快照；不扩展到整棵树。
- 结果返回当前节点每个 arg 的显式可见状态以及可选错误文案。
- sidebar coordinator 在缺少激活 editor 时，为该请求返回空结果与错误，保持与现有 request 行为一致。

### 6.3 Inspector Rendering

- controller runtime 在 graph rebuild 后与选中节点变化时，按需请求当前节点的 arg visibility。
- 可见性结果存入 `workspaceStore` 的派生状态，由 Node Inspector selector 过滤 structured args；当某个 structured arg 变为隐藏时，Node Inspector 追加一次标准 `updateNode` 提交来移除该 arg 的 committed 值。
- raw JSON 视图、unknown node fallback、字段提交与 override 语义保持不变。

## 7. Implementation Plan

1. 补齐 spec、shared types 和 node def 归一化。
   Exit: `visible` 字段能进入 webview 侧 nodeDef。
2. 扩展 build runtime、host request registry 与 session 处理器。
   Exit: host 能返回当前节点参数可见性结果。
3. 接入 Inspector 派生状态、隐藏字段清理与字段过滤。
   Exit: structured args 可按返回结果显示/隐藏，且隐藏字段的 committed 值被清除。
4. 增加 shared tests 与协议相关测试。
   Exit: 新增行为有稳定回归覆盖。

## 8. Testing Plan

- shared schema/inspector tests：验证 `visible` 字段被保留、structured args 过滤生效，且隐藏字段会从 committed args 中移除。
- shared build tests：验证 `@behavior3.visible` 可注册、可加载、可与 `checkScripts` 共存。
- host request tests：验证 `resolveNodeArgVisibility` 超时/错误与正常结果解析。
- 运行最窄共享测试和 `npm run check`。

## 9. Acceptance Criteria

- 节点定义中的 `args[].visible` 在 shared schema 归一化后仍可从 Inspector 侧读取。
- 使用 `@behavior3.visible("name")` 注册的类能被 `checkScripts` 或 build script runtime 发现。
- 当 `visible(value, ctx)` 返回 `false` 时，对应 structured arg 不渲染；返回非 `false` 时渲染。
- 当某个 structured arg 的可见性结果变为 `false` 时，该 arg 会从节点 committed args 中移除。
- 同一节点切换控制参数后，Inspector 能重新请求并刷新 arg 可见性，而不需要切换文件或重载扩展。

## 10. Risks and Rollback

- 风险：host request 频率过高导致 Inspector 输入过程抖动。
  缓解：只对当前选中节点请求，并复用现有 request sequencing 防止过期响应覆盖。
- 风险：可见性函数抛错后 structured args 全量消失。
  缓解：单字段失败默认回退为可见，并只记录日志，不改变现有运行时检查结果。
- 回滚：删除 `visible` 请求与注册表扩展后，structured args 回退到无条件展示。
