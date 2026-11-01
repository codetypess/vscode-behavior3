# Condition File Item Identity

Status: Verifying
Date: 2026-11-01
Scope: extension host / condition files / open condition command

## 1. Context

条件文件原来按序号定位（`multiple-node-conditions.md` 4.4）：`…/<uuid>/condition.json` 是第 1 项，`condition-<n>.json` 是第 n 项。条件文件打开期间在宿主里删除或移动条件（包括撤销、重做、外部修改），同一个序号上换成了另一项，标签页会显示另一项，修改也写回到那一项上。

第一版修复在序号上的条件换了时关闭标签页。但移动只改变顺序，条件本身没变，不应该关闭；有未保存修改时也应该能保存回去。

## 2. Rules

1. 条件文件按**条件树根节点的 uuid** 定位这一项，不按序号。根节点 uuid 在条件树内部编辑时不变（替换节点保留 uuid），所以可以作为这一项的身份。
2. 地址：`/<宿主文件名>/<宿主节点 uuid>/condition-<条件根节点 uuid>.json`，宿主文件完整路径仍放在 `host` 查询参数里。同一项条件只对应一个地址，从画布或 Inspector 再次打开时回到同一个标签页。
3. 移动顺序：标签页不关闭，继续显示这一项；有未保存修改时可以照常保存，写回这一项现在的位置。
4. 删除（宿主里找不到这个根节点 uuid）：
   - 标签页没有未保存修改：直接关闭。
   - 有未保存修改：先不关闭。回到这个标签页时提示「这项条件已在宿主里被移除，标签页里的编辑将被丢弃」，确认后丢弃修改并关闭。此期间保存会失败，提示同样的原因。
   - 删除后又撤销，这一项回来了：恢复正常。
5. 有未保存修改的标签页，只有这一项自己的内容（条件树和 `custom`，不计节点 id）或宿主的 `overrides` 变了，才走外部修改冲突提示；只是顺序变化、或宿主其他地方的修改导致 id 重新编号，不提示。
6. 没有未保存修改的标签页照常重新读取（id 跟着宿主更新）。

## 3. Design

- `webview/shared/condition-file.ts`：地址的构造和解析改用条件根节点 uuid；`buildConditionFileTree(hostTree, hostStableId, rootUuid)` 按 uuid 找这一项；`findConditionItemIndex` 返回这一项现在的序号（找不到时 -1）；`conditionItemSignature` 给出这一项不含 id 的内容摘要（条件树、`custom`、宿主 `overrides`）。
- 打开条件文件：webview 发送 `openConditionFile` 时带上这一项根节点的 uuid（`rootUuid`），不再带序号。
- `src/tree-editor-provider.ts`：
  - 读条件文件时记下这一项的内容摘要。
  - 写回时按 uuid 找到现在的序号，再用 `setConditionRoot` 写回；找不到时报错。
  - 宿主内容变化时逐个检查打开的条件标签页：找不到这一项时按规则 4 处理；有未保存修改且摘要没变时不重新读取；其余照常重新读取。
  - 被移除、有未保存修改的标签页记在一个集合里；标签页变成活动状态时弹出提示，然后 `revertAndCloseActiveEditor`。对这样的文档，revert 不读取内容，直接视为已还原。

## 4. Testing

- 地址构造和解析（uuid 编码、`host` 参数校验、错误地址返回 `null`）。
- `buildConditionFileTree` 和 `findConditionItemIndex` 按 uuid 定位；删除、移动后序号正确，删除后找不到。
- `conditionItemSignature`：只改 id 时不变，改条件树内容、`custom` 或 `overrides` 时变化。
- webview 打开条件文件时消息里带根节点 uuid。
- 关闭标签页和提示依赖 VS Code 运行时，在 VS Code 里手动验证。

## 5. Acceptance Criteria

- 打开某一项的条件文件，在宿主里移动它：标签页不关闭，内容不变，也不弹出冲突提示；有未保存修改时保存成功，修改写回这一项。
- 在宿主里删除这一项：没有未保存修改时标签页关闭；有未保存修改时回到标签页会提示并丢弃、关闭。
- 从画布再次打开同一项，回到已打开的标签页。
- `npm run check`、`npm run test:shared`、`npm run build` 通过。
