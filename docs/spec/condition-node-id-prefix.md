# Condition Node Id Prefix

Status: Verifying
Date: 2026-11-02
Scope: display ids / save id write-back / build ids / condition files

## 1. Context

现在条件树里的节点和主树节点共用一个编号序列，顺序是节点、它的条件树、它的子节点（`11-document-model.md`、`b3build.ts` 的 `assignSequentialNodeIds`）。给节点 2 加一个三节点的条件，后面所有主树节点的编号都往后挪 3 个，主树编号因此不连续，加删条件会让大片节点改号。

## 2. Goals

- 主树编号只数主树节点，条件树不占号。
- 条件树里的节点用前缀编号：`<宿主节点 id>.<第几项>-<条件树内序号>`，例如 `2.1-1` 是节点 2 第 1 项条件的根节点。项从 1 开始数，条件树内序号从 1 开始，按节点、子节点的顺序。
- 画布、保存的文件、构建产物、条件文件里的编号一致。

## 3. Non-Goals

- 运行时不改：behavior3-ts 的节点 `id` 本来就是字符串，状态数组用的是构建时另外分配的 `index`，和 id 无关。
- 不升级 `DOCUMENT_VERSION`：id 本来就是保存时重算的，旧文件下次保存时改成新编号。

## 4. Proposed Behavior

例子（树前缀为空）：

```
1 Selector
├─ 2 Sequence            条件 1: 2.1-1 Selector ─ 2.1-2 Check, 2.1-3 Check
│                        条件 2: 2.2-1 HasTarget
│  ├─ 3 Wait
│  └─ 4 Attack
└─ 5 Idle
```

- **树前缀**：tree `prefix` 照旧加在最前面，前缀为 `H` 时是 `H2`、`H2.1-1`。保存的文件里不带树前缀（`2.1-1`），画布和构建产物带（`H2.1-1`），和主树节点现在的规则一样。
- **subtree**：宿主是展开后的 subtree 节点时，用它在主树里的编号；条件树里引用的 subtree 展开后接着条件树内的序号往下数。
- **条件树里再挂条件**：设计上不允许，编辑器会报错；万一出现，按同一规则递归（`2.1-3.1-1`），不另作处理。
- **运行时日志**：节点日志是 `<树名>-><节点名>#<id>`，会显示成 `hero->Check#2.1-2`。

### 条件文件

- 条件文件的树前缀 = 宿主树前缀 + `<宿主节点 id>.<第几项>-`，例如 `H2.1-`，里面的节点从 1 开始编号。画布上显示 `H2.1-1`，和宿主里一致。
- 不再需要"从宿主里根节点的编号开始数"（`getDisplayIdStart`），删掉。宿主的编号仍按"现在保存会得到的编号"算（`withLiveDisplayIds`），所以宿主没保存时也是对的。
- 条件文件的树面板里前缀改成只读：它由宿主决定，保存时本来也不写回。
- 打开期间在宿主里移动条件或者改了宿主节点编号，标签页里的前缀不会马上更新，下次打开时更新，和现在的编号一样。

## 5. Design

- `webview/domain/resolve-graph.ts`：主树按节点、子节点编号；条件树单独编号，id 为 `<宿主 displayId>.<n>-<k>`，仍写入 `mainTreeDisplayIdsByStableId`，保存时照旧写回。删掉 `displayIdStart` 和 `getDisplayIdStart`。
- `webview/shared/b3build.ts`：`assignSequentialNodeIds` 改成同样的规则，然后照旧给所有节点加树前缀。
- `webview/shared/condition-file.ts`：`buildConditionFileTree` 用宿主节点的 id 和这一项的位置算出前缀。
- `webview/commands/controller-runtime.ts`：不再传 `displayIdStart`。
- 树面板：条件文件里前缀只读。
- 基线 spec：`11-document-model.md`（遍历和编号规则）、`17-editor-semantics.md`（条件文件编号）、`node-conditions.md`。
- behavior3-ts `docs/design.md` 3.2 节"条件树里节点的 id 和普通节点共用一个编号序列"要改成新规则，示例 JSON 的 id 也要改（另一个仓库，单独提交）。

## 6. Testing Plan

shared tests：

- 主树编号跳过条件树：节点 2 挂条件后，它的子节点仍是 3。
- 条件树编号 `2.1-1`、`2.1-2`、`2.2-1`；保存后写进文件。
- subtree 展开节点上的条件用展开后的编号。
- 构建产物带树前缀：`H2.1-1`；自定义字段脚本拿到的是新编号。
- 条件文件：树前缀是 `H2.2-`，根节点 id 是 1；改写原来的 `getDisplayIdStart` 测试。

## 7. Acceptance Criteria

- 给节点 2 加条件，主树其他节点编号不变，条件树节点显示 `2.1-…`。
- 双击打开条件文件，节点编号和宿主一致（带前缀）。
- 保存、构建后的 JSON 里是新编号。
- `npm run check`、`npm run test:shared`、`npm run build` 通过。

## 8. Risks and Rollback

- 已有树文件第一次保存时条件树和后面主树节点的编号会变，这是预期的一次性改动。
- 外部工具如果按数字解析节点 id，遇到 `2.1-1` 会出问题；behavior3-ts 本身不受影响。
- `$nodeId` 默认值用的是宿主节点的编号，仍是整数，不受影响。
- 回滚：恢复共用序列的编号即可，数据格式不变。
