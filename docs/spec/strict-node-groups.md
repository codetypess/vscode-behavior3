# Strict Node Groups

Status: Verifying
Date: 2026-11-02
Scope: node group validation / workspace settings / Tree Inspector / build

## 1. Context

节点定义可以声明 `group`，树文件用 `group` 选择启用哪些分组。节点声明了 `group` 时，树必须启用其中一个，否则报 `group-not-enabled`；没有声明 `group` 的节点不检查，在哪棵树里都合法。检查有两处：编辑器的 `collectResolvedNodeDiagnostics`（画布、Inspector）和构建的 `checkNodeDataWithState`。

behavior3-ts 给所有内置节点加上了 `group: ["Core"]`，运行时 `Core` 节点总会注册，不受 `supportGroupTypes` 限制。编辑器加载重新生成的 `.b3-setting` 后，`Core` 节点也进入分组检查，所有没勾选 `Core` 的树里 `Selector`、`Sequence` 等都会报错，和运行时不一致。

## 2. Goals

- 默认（非严格模式）和运行时一致：`Core` 分组视为每棵树都启用，已有树不受影响。
- 严格模式：树必须先选分组；没勾选 `Core` 时，`Selector` 等核心节点不合法。
- 编辑器（画布、节点 Inspector、Tree Inspector）和构建的结论一致。

## 3. Non-Goals

- 运行时不改：严格模式只是编辑器和构建阶段的检查。
- 不让 `Core` 可配置：`Core` 是 behavior3-ts 定的分组名，写死在编辑器里。
- 没有声明 `group` 的节点规则不变：严格模式下也合法。

## 4. Proposed Behavior

`.b3-workspace` 新增 `settings.strictGroup`（布尔，默认 `false`）：

```json
{ "settings": { "strictGroup": true } }
```

节点合法的条件：节点没有声明 `group`；或者它的某个分组在树的 `group` 里；或者非严格模式下它的分组包含 `Core`。

严格模式下，树的 `group` 为空、且节点配置里有分组可选时，树本身报错：

- Tree Inspector 的分组选择框标红，提示"严格模式下必须选择节点分组"。只显示错误，不阻止提交，用户仍可以清空分组。
- 构建报 `tree group is required in strict group mode`，构建失败。
- 节点照常报 `group-not-enabled`，画布上可以直接看到哪些节点不合法。

非严格模式下，节点配置里有 `Core` 分组时，Tree Inspector 的分组框下面提示"`Core` 分组始终启用"。

条件文件复制宿主树的 `group`，结论跟着宿主一致。修改 `.b3-workspace` 后设置实时刷新，画布重新校验。

## 5. Design

- `webview/shared/node-utils.ts`：`CORE_NODE_GROUP = "Core"`；`isNodeGroupEnabled(groups, usingGroups, strictGroup)` 是唯一的判断；`isTreeGroupMissing(tree group, groupDefs, strictGroup)` 是树级判断。
- `usingGroups` 仍然只记树自己的分组，不把 `Core` 加进去：构建的 `refreshVarDeclNode` 用 `usingGroups` 的键判断树的分组有没有变化，加进 `Core` 会让每棵树都被当成变化。
- `webview/shared/b3type.ts`、`schema.ts`：`WorkspaceModel.settings.strictGroup`。
- 宿主：`setting-resolver.ts` 读出 `strictGroup`，`live-settings.ts` 放进 `EditorLiveSettings`，经 `init`、`settingLoaded` 消息到 webview 的 `Settings.strictGroup`。
- 编辑器校验：`collectResolvedNodeDiagnostics` 新增可选参数 `strictGroup`；`controller-runtime` 渲染画布时传入；节点 Inspector 的分组校验改用 `isNodeGroupEnabled`。
- 构建：`buildProject` 读 `settings.strictGroup` 后调用 `context.setStrictGroup`；`checkNodeDataWithState` 改用 `isNodeGroupEnabled`；每棵树检查前判断 `isTreeGroupMissing`。
- 基线 spec：`11-document-model.md`（树的 `group` 字段）、`16-inspector-contract.md`（树和节点的分组字段）、`17-editor-semantics.md`（节点分组规则）；README 的 workspace 设置说明。

## 6. Testing Plan

shared tests：

- `isNodeGroupEnabled`：无分组的节点总合法；非严格模式 `Core` 合法；严格模式 `Core` 需要启用；其他分组两种模式一样。
- `isTreeGroupMissing`：只在严格模式、树分组为空、有分组可选时为真。
- `collectResolvedNodeDiagnostics`：`Core` 节点在非严格模式无 `group-not-enabled`，严格模式有。
- workspace 解析：`strictGroup` 读出布尔值，非布尔值忽略。
- 构建：非严格模式下未选分组的树里用 `Core` 节点通过；严格模式下失败，并报树分组缺失。

## 7. Acceptance Criteria

- 加载带 `Core` 分组的 `.b3-setting`，默认设置下已有树不报错。
- `strictGroup: true` 时，没选分组的树里 `Selector` 标红，Tree Inspector 分组框提示必须选择；勾选 `Core` 后错误消失。
- 构建结果和编辑器一致。
- `npm run check`、`npm run test:shared`、`npm run build` 通过。

## 8. Risks and Rollback

- 打开严格模式后，所有没选 `Core` 的树都会报错，这是预期的：用户主动打开。
- 旧版 behavior3-ts 的 `.b3-setting` 里核心节点没有 `group`，严格模式下照样合法，只是不受约束。
- 回滚：删掉 `strictGroup` 设置即可，数据格式不变。
