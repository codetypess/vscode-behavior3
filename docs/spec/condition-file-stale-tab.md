# Condition File Stale Tab

Status: Verifying
Date: 2026-11-01
Scope: extension host / condition files

## 1. Context

条件文件的地址按序号区分（`multiple-node-conditions.md` 4.4）：`…/<uuid>/condition.json` 是第 1 项，`condition-<n>.json` 是第 n 项。宿主内容变化时，打开的条件标签页按序号重新读取。

问题：条件文件打开期间，在宿主里删除或移动条件（包括撤销、重做、外部修改），同一个序号上换成了另一项。标签页会显示另一项，之后的修改也写回到那一项上；对应序号不存在时读不出来。

## 2. Rules

1. 宿主内容变化后，对每个打开的条件标签页，比较它当前显示的条件树根节点 uuid 和宿主里同一序号上那一项的根节点 uuid。
2. 不一致（这一项被移走或删掉了），并且标签页没有未保存的修改：关闭这个标签页，不重新读取。
3. 不一致但标签页有未保存的修改：不关闭，按原来的流程重新读取（走已有的外部修改冲突处理），避免丢掉用户的修改。
4. 一致：按原来的流程重新读取。
5. 条件标签页自己保存写回时（`savingConditionFiles`）不检查，和原来一样跳过。

## 3. Design

- `webview/shared/condition-file.ts`：`findConditionItemRootUuid(hostTree, hostStableId, index)`，返回宿主节点第 `index` 项条件根节点的 uuid，没有这一项时返回 `null`。
- `src/tree-editor-provider.ts`：`refreshConditionFiles` 先读一次宿主内容，逐个比较；需要关闭的标签页通过 `vscode.window.tabGroups` 找到（`TabInputCustom`，URI 相同）一起关闭。读宿主失败时退回原来的行为，全部重新读取。

## 4. Testing

- `findConditionItemRootUuid`：返回对应序号的根节点 uuid；删除第 1 项后，序号 0 上是原来第 2 项的 uuid；序号越界或宿主节点不存在时返回 `null`。
- 关闭标签页依赖 VS Code 运行时，在 VS Code 里手动验证。

## 5. Acceptance Criteria

- 打开某节点第 1 项的条件文件，在宿主里删除第 1 项或把它下移：条件标签页关闭。
- 只修改宿主里的其他内容：条件标签页保持打开并刷新。
- 条件标签页有未保存修改时删除这一项：标签页不关闭。
- `npm run check`、`npm run test:shared`、`npm run build` 通过。
