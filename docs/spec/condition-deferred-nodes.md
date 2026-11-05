# Deferred Nodes in Condition Trees

Status: Verifying
Date: 2026-11-05
Scope: node definitions / node validation / condition files / Node Inspector / build

## 1. Context

behavior3-ts 的节点定义可以声明 `deferred: true`（`Listen`、`WaitForEvent`、`Delay`、`RunTree` 等）：这类节点每次执行都会注册回调，或者到运行时才加载别的树。条件可能被反复求值，放进条件树里每次都会多注册一次，所以运行时加载树时，条件树里有启用的 `deferred` 节点就报错。被禁用的节点运行时不会创建，不受限制。

编辑器现在不知道 `deferred`：`.b3-setting` 解析时丢掉了这个字段，条件文件里放 `Listen` 不报错，构建也能通过，到运行时加载才失败。

## 2. Goals

- 条件文件里，启用的 `deferred` 节点按现有的检查机制报错：画布上节点标红，节点 Inspector 的「名称」字段显示错误提示。
- 构建时，条件树里有启用的 `deferred` 节点就报错，构建失败。
- 编辑器和构建的结论一致，也和运行时一致。

## 3. Non-Goals

- 不拦截编辑操作：和分组检查一样只报错，可以先放进去再改。
- 宿主树的画布不展开条件树，宿主上不额外标记；打开条件文件或构建时才看到错误。
- 运行时不改。

## 4. Proposed Behavior

节点「在条件树里生效」：所在文档是条件文件，并且它自己和祖先都没有被禁用。子树引用展开后的节点也算（解析后的图里已经展开）。

- 在条件树里生效的 `deferred` 节点报 `deferred-in-condition`：画布标红；名称字段提示「“Listen” 是 deferred 节点，不能放在条件树里：条件可能被反复求值，每次都会多注册一次」。
- 禁用它（或它的祖先）后错误消失。
- 构建：条件树里启用的 `deferred` 节点报 `check <id>|<name>: '<name>' is deferred, not allowed in a condition tree`，构建失败。被禁用的节点和它的子节点不报这一项。条件根被禁用时整项条件不生效，也不报。

## 5. Design

- `webview/shared/b3type.ts` / `schema.ts`：`NodeDef.deferred`（来自 behavior3 的 `NodeDef`），`parseNodeDefsContent` 保留 `deferred: true`。
- `webview/shared/condition-branch.ts`：`isActiveInConditionFile(graph, node, conditionFile)`，自己和祖先都没有禁用时为真。
- `webview/shared/validation.ts`：`ValidatableNode` 不变；`collectResolvedNodeDiagnostics` 新增可选参数 `inConditionTree`，为真且 `def.deferred` 时加 `{ code: "deferred-in-condition", nodeName }`。
- 画布：`buildResolvedGraphModel` 的 `validation` 新增 `conditionFile`，逐个节点算出 `inConditionTree` 传进去；`controller-runtime` 传入 `settings.conditionFile`。
- 节点 Inspector：`EditNode.inConditionTree`（`controller-runtime` 用同一个函数算出）；名称字段的校验在名字对应的定义是 `deferred` 且 `inConditionTree` 时报错，改名时按新名字判断。
- 构建：`checkNodeDataWithState` 新增参数 `inConditionTree`，条件根传 `true`，往下传 `inConditionTree && !disabled`。
- 文案：`node.deferredInCondition`（zh / en）；构建文案和运行时一致。
- 基线 spec：`16-inspector-contract.md`（名称字段校验）、`17-editor-semantics.md`（条件树规则）。

## 6. Testing Plan

shared tests：

- `parseNodeDefsContent` 保留 `deferred`。
- `collectResolvedNodeDiagnostics`：`inConditionTree` 时 `deferred` 节点报 `deferred-in-condition`，不在条件树里或节点不是 `deferred` 不报。
- `buildResolvedGraphModel`：`conditionFile` 时 `deferred` 节点标红；节点或祖先禁用后不标红；不是条件文件不标红。
- 构建：条件树里的 `Listen` 构建失败并报 deferred；禁用后通过；宿主树里的 `Listen` 通过。

## 7. Acceptance Criteria

- 条件文件里放 `Listen`：节点标红，名称字段显示错误；禁用后错误消失。
- 宿主树里条件挂着 `Listen` 时构建失败，错误信息指出节点；普通位置的 `Listen` 构建通过。
- `npm run check`、`npm run test:shared`、`npm run build` 通过。

## 8. Risks and Rollback

- 旧的 `.b3-setting` 没有 `deferred` 字段，不报错，行为和现在一样；重新从 behavior3-ts 生成配置后生效。
- 已有条件树里放了 `deferred` 节点的项目，构建会开始失败，这是预期的：运行时加载本来就会失败。
- 回滚：去掉检查即可，数据格式不变。
