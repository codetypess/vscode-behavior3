# Invalid Condition Trees on the Host Node

Status: Verifying
Date: 2026-11-06
Scope: graph node VM / condition cards / host vars message / Node Inspector

## 1. Context

宿主树的画布不展开条件树，条件卡片只在两种情况下标错：宿主是树的根节点，或 `lower` / `both` 但父节点不是 preemptive。条件树里的节点有错（未定义的节点、分组未启用、变量未声明、参数缺失、`deferred` 节点等）时，宿主树上看不出来，要打开条件文件或构建才发现（`condition-deferred-nodes.md` 的 Non-Goals 里明确留下了这一点）。

出错的卡片现在只是描边和 `abort` 文字变红，卡片底色仍是宿主的主题色，宿主节点本身也不标红，不够醒目。

## 2. Goals

- 条件树里有不合法的节点时，这一项条件不合法：卡片标红。
- 有任何一项条件不合法时，宿主节点整体进入错误态（`nodeStyleKind = "Error"`，和节点自身校验失败一样）。
- 节点 Inspector 在「子树」字段下面、其他分组（输入变量等）前面加一组「条件」，按顺序列出这个节点的每一项条件（图标、根节点名、说明、`abort`），不合法的一项显示为红色；点一项选中这张条件卡片。

## 3. Non-Goals

- 不在宿主树上展开条件树，也不指出是条件树里的哪个节点出错：打开条件文件看。
- 不跑用户的构建脚本检查（`nodeFieldDiagnostics`）：它按当前文档的节点实例请求，条件树节点不在宿主的解析图里。
- 条件树里的子树引用节点不展开、不检查：子树内容在它自己的文件里检查。
- `running` 状态、嵌套条件这些条件分支规则仍由保存时的检查负责，这里不重复。

## 4. Proposed Behavior

### 4.1 什么算不合法

一项条件不合法，满足任一条：

1. 宿主是树的根节点（已有）。
2. `abort` 是 `lower` / `both` 但父节点不是 preemptive（已有）。
3. 条件树里有节点的共享校验报错（`collectResolvedNodeDiagnostics`），检查口径和条件文件画布一致：
    - 变量：宿主树的 `usingVars` 加上这一项自己的 `variables`（本地变量 + 导入文件里的变量），和条件文件、构建一致。
    - 分组、`strictGroup`、`checkExpr` 用宿主当前的设置。
    - 节点和它的祖先（到条件根为止）都没有禁用时才算「在条件树里生效」，这时 `deferred` 节点报错。
    - 子树引用节点（有 `path`）跳过，不往下走。

### 4.2 画布

- 不合法的卡片底色用错误色叠在画布背景上：未选中 60%，选中 85%（正常卡片是宿主主题色 22% / 45%）。描边和其他卡片一样跟随宿主节点颜色，`abort` 文字为白色加粗。
- 宿主节点有不合法的条件时进入错误态，主题色变成错误色。

### 4.3 节点 Inspector

- 节点有条件时，在「子树」字段下面、输入变量分组前面显示「条件」分组，每项一行：条件图标（和画布卡片一样用 `media/icons/Flush.svg`，以 CSS mask 跟随文字颜色）、根节点名、说明（根节点的 `desc`，没有时用节点定义的 `desc`）、右侧 `abort`。
- 不合法的一行用错误色的边框、底色和文字；鼠标悬停显示「条件不合法，打开条件文件查看」。
- 单击一行选中对应的条件卡片（和单击画布上的卡片一样），Inspector 切到条件面板；双击打开这一项的条件文件。
- 合法与否在 Inspector 里按工作区当前的变量、分组、设置实时计算，sidebar 和 embedded 两种模式都一样。

## 5. Design

- `webview/domain/condition-validation.ts`（新）：
    - `resolveConditionUsingVars(usingVars, variables, importVars)`：宿主变量 + 条件本地变量 + 条件导入文件的变量。
    - `hasInvalidConditionTreeNode(root, ctx)`：遍历条件树，按 4.1 第 3 条判断。
    - `isConditionInvalid(condition, parent, ctx)`：4.1 的三条。
- `webview/domain/graph-selectors.ts`：`attachedConditions[i].invalid` 用 `isConditionInvalid`；任一项不合法时节点 `invalid`。`validation` 增加 `conditionImportVars`。
- 宿主变量消息：`varDeclLoaded` / `HostVarsPayload` / `WorkspaceState` 增加 `conditionImportVars: Record<导入路径, VarDecl[]>`，宿主 `ProjectIndex.buildUsingVars` 收集主树（含 overrides）和可达子树文件里所有条件的 `variables.imports`，按路径算出传递导入的变量。`applyHostVars` 在它变化时重建画布；sidebar 同步写入。
- `webview/adapters/graph/g6-graph-node.ts`：`invalid` 时卡片填色改用错误色。
- `webview/features/inspector/node-inspector-condition-section.tsx`（新）：「条件」分组，放在 `NodeMetaFields` 之后、输入变量分组之前。点击调用 `controller.selectNode(ref, { surface: "condition", conditionIndex })`。
- 文案：`node.conditions`、`node.conditionInvalid`（zh / en）。
- 基线 spec：`15-graph-contract.md`（`attachedConditions.invalid`、卡片颜色、节点错误态）、`16-inspector-contract.md`（「条件」分组）。

## 6. Testing Plan

shared tests：

- 条件树里有未定义节点 / 缺参数 / 未声明变量时，卡片 `invalid`，宿主 `nodeStyleKind = "Error"`；全部合法时都不变。
- 条件自己的本地变量、导入变量（`conditionImportVars`）声明的变量不报未声明。
- 禁用的 `deferred` 节点不报，启用的报。
- 条件树里的子树引用节点不检查。
- 宿主变量消息归一化带上 `conditionImportVars`。

## 7. Acceptance Criteria

- 条件树里放一个缺参数的节点：宿主树上这张条件卡片变红，宿主节点变红；Inspector「子树」下面的「条件」分组里这一项为红色。修好后恢复。
- 点「条件」分组里的一项，画布选中对应卡片，Inspector 显示条件面板。
- `npm run check`、`npm run test:shared`、`npm run build` 通过。

## 8. Risks and Rollback

- 以前只在卡片上标错的条件（`abort` 不生效、条件在树根上）现在也会让宿主节点变红，这是有意的：它们本来就是构建错误。
- 条件树很大时每次重建画布多一次遍历，和条件文件画布的校验量相当。
- 回滚：`isConditionInvalid` 去掉第 3 条、节点 `invalid` 不再看条件即可，数据格式不变；`conditionImportVars` 是可选字段，旧消息按空处理。
