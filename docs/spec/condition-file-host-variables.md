# Condition Variables and Host Groups

Status: Verifying
Date: 2026-11-02
Scope: condition item data / condition files / Tree Inspector / build

## 1. Context

条件文件打开时复制宿主树的 `group` 和 `variables`，但保存时只写回根节点、`desc`、`custom` 和 `overrides`（`17-editor-semantics.md`）。所以在条件文件里：

- 分组可以改，但改了不生效，保存后丢失。条件树和宿主是同一棵树，分组只能由宿主决定。
- 宿主的变量显示成可以编辑、删除，但改了保存后丢失。
- 条件树没有地方放自己的变量。

## 2. Goals

- 条件文件的分组用宿主树的，Tree Inspector 里只读。
- 宿主树的变量（本地变量和导入变量）在条件文件里继承下来：可以用，不能编辑、删除。
- 条件项有自己的变量（本地变量和导入变量），在条件文件里自由添加、删除、导入，保存在条件项上。

## 3. Non-Goals

- 运行时不改：条件项的 `variables` 和 `desc`、`custom` 一样只给编辑器用，运行时忽略。
- 宿主树的画布和条件 Inspector 不显示条件自己的变量。
- 宿主树的节点不能用条件自己的变量。

## 4. Proposed Behavior

条件项新增可选字段 `variables`，形状和树的 `variables` 一样：

```json
{ "abort": "none", "variables": { "imports": ["vars/common.json"], "locals": [{ "name": "range", "desc": "范围" }] }, "root": { ... } }
```

没有变量时省略。构建产物原样带上（和 `desc`、`custom` 一样）。

条件文件：

- 树的 `variables` 是这项条件自己的变量，`inheritedVariables` 是宿主树的变量（只在条件文件里出现，不写盘）。
- Tree Inspector 的「本地变量」先列出继承的变量（只读，没有删除按钮），再列出自己的变量（可编辑）；自己的变量和继承的同名时报错「主树已有同名变量」。「导入变量」同样先列出继承的导入（只读），再列出自己的导入。
- 「启用节点分组」只读，显示宿主的分组。
- 条件树里能用的变量 = 宿主的变量 + 自己的变量（各自的导入和子树变量都算）。
- 保存时自己的变量随根节点、`desc`、`custom`、`overrides` 一起通过 `setConditionRoot` 写回条件项；宿主的 `variables` 不变。
- 宿主的变量在条件文件打开期间变了，条件文件按宿主内容变化处理：没有未保存修改时刷新，有时提示冲突。

构建：检查条件树时，可用变量是宿主树的加上这项条件自己的（导入的变量也读进来）。

## 5. Design

- `webview/shared/b3type.ts`：`ConditionData.variables?: TreeVariables`；`copyConditionVariables` 复制变量，没有变量时返回 `undefined`；`TreeData.inheritedVariables?`。
- `webview/shared/contracts.ts`：`PersistedTreeModel.inheritedVariables?`；`SetConditionRootInput.variables?` 是条件自己的变量。
- `webview/shared/schema.ts`：解析条件项的 `variables` 和条件文件的 `inheritedVariables`；`tree.ts` 写出 `inheritedVariables`（只有条件文件有）。
- 复制条件项的地方带上 `variables`：`tree-model.ts`、`tree-materializer.ts`、`b3build.ts` 的两处导出。
- `webview/shared/condition-file.ts`：`buildConditionFileTree` 的 `variables` 取条件项的，`inheritedVariables` 取宿主的；`readConditionFileWriteBack` 写回条件自己的变量；`conditionItemSignature` 加入条件的变量和宿主的变量。
- `webview/shared/document.ts`：`reduceSetConditionRoot` 写入条件项的 `variables`，不改宿主的。
- `src/editor-session/project/project-index.ts`：`buildUsingVars` 合并 `inheritedVariables` 的本地变量和导入。
- `webview/features/inspector/tree-inspector-form.tsx`：继承的变量和导入只读列在前面；同名校验；分组只读。
- `webview/shared/b3build-context.ts`：`resolveConditionVars` 读出条件自己的变量（含导入），检查条件树时合并进 `usingVars`。
- 基线 spec：`11-document-model.md`、`16-inspector-contract.md`、`17-editor-semantics.md`。

## 6. Testing Plan

shared tests：

- 条件文件：`inheritedVariables` 是宿主的变量，`variables` 是条件自己的；序列化往返后保留；写回条件项、宿主变量不变；宿主重新读取后条件文件显示同样的变量；宿主变量变化时签名变化；相同内容再写回是 noop。
- 构建：条件树可以用宿主的变量、条件自己的本地变量和导入的变量，用未声明的变量报错；构建产物带上条件的 `variables`。

## 7. Acceptance Criteria

- 条件文件里分组框、继承的变量和导入都不能编辑、删除。
- 在条件文件里添加变量、导入后保存，宿主文件的这项条件带上 `variables`，宿主树自己的变量不变；重新打开条件文件能看到。
- 条件树里引用自己的变量不报错，构建通过。
- `npm run check`、`npm run test:shared`、`npm run build` 通过。

## 8. Risks and Rollback

- 条件自己的变量和宿主的同名时，Inspector 报错，但已经写在文件里的同名变量不会被拒绝，按宿主的显示。
- 回滚：去掉条件项的 `variables`（运行时忽略它，删掉不影响运行），恢复条件文件的变量为宿主的复制。
