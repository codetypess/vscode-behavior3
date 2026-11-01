# Multiple Node Conditions

Status: Verifying
Date: 2026-11-01
Scope: graph / selection / document mutations / condition inspector / condition files

## 1. Context

behavior3 2.0 运行时的 `conditions` 是数组，项与项之间是 AND，多项语义已经确定（behavior3-ts `docs/design.md` 3.2 节）。`design.md` 第 10 节把"编辑器什么时候放开多项、怎么展示、怎么调整顺序"列为待定问题。

`node-conditions.md` 的数据层已经完整支持多项，但界面只处理第一项：

- 画布只画第一项（`attachedConditionName` / `attachedConditionAbort`）。
- 已经有条件时不能再添加（`condition-already-attached`）。
- 删除条件只删第一项；条件面板、条件文件都只对应第一项。
- 选中状态 `{ kind: "condition" }` 不带是哪一项。

## 2. Goals

- 一个节点可以挂多项条件：添加时追加到末尾。
- 画布像 Scratch 积木一样把所有条件卡片按顺序叠在节点上方，每张卡片的卡扣落进下面一张（最后一张落进节点色条）。
- 单击某张卡片选中这一项，Inspector 显示这一项；双击打开这一项的条件文件。
- 可以删除某一项，可以上移、下移调整顺序。
- 条件面板、条件文件、修改命令都按项序号工作。

## 3. Non-Goals

- 拖拽卡片调整顺序：先用右键菜单和快捷键上移/下移。
- 把一个节点的条件拖到另一个节点。
- 折叠条件卡片。
- behavior3-ts `design.md` 里"`conditions` 暂时只允许 1 项"的校验不再需要，这里不实现这条校验；`design.md` 第 10 节的待定问题由本文回答（要不要同步改 `design.md` 另行决定）。

## 4. Proposed Behavior

### 4.1 画布

```
┌─────────────────────────────────┐
│ ⚡ Selector               lower │
└─▽───────────────────────────────┤   ← 卡扣落进下一张卡片
│ ⚡ HasTarget               self │
└─▽───────────────────────────────┤   ← 最后一张落进节点色条
│▓▓│ Sequence                   ○ │
│▓▓│ 备注：攻击                 ○ │
└─────────────────────────────────┘
```

- 每项一张卡片，高 30px（`G6_GRAPH_CONDITION_TAB_HEIGHT`），从上到下按数组顺序排列，最上面是第 1 项。节点主体从所有卡片下方开始，节点高度加上 `卡片数 × 30`。
- 左侧是条件图标（`Flush.svg`，白色）和根节点名，不显示「条件」二字和序号：卡片的上下位置已经表明顺序。右侧仍是该项的 `abort`。
- 卡片之间不留缝，共用一条边框。每张卡片的梯形卡扣画在下一张卡片（或节点色条）上面，所以要从下往上画。卡片颜色相同时，卡扣靠描边显出来。
- 选中某一项时，这张卡片用更亮的颜色（主题色 45% 叠色，其他卡片 22%），表示 Inspector 当前显示的是它。选中项通过节点状态 `conditionselected<i>` 传给节点绘制。

### 4.2 选择

- `HostSelectionState` 的条件选择变成 `{ kind: "condition"; ref; index: number }`。选择 store 增加 `selectedConditionIndex`；`selectNode` 消息的 `surface: "condition"` 带上 `conditionIndex`。
- 单击第 i 张卡片：选中宿主节点、`surface = "condition"`、`index = i`。单击节点主体：照旧选中节点。
- 删除选中项后选中同位置的下一项，没有就选上一项；没有条件了就回到选中节点。撤销等外部修改让条件变少时，条件面板显示最后一项。

### 4.3 修改命令

- `attachCondition`：追加到末尾，去掉 `condition-already-attached`。新项的 `custom` 照旧按 `customFields.condition` 生成，脚本字段在修改后补上。添加后选中新的这一项。
- `removeCondition`：payload 带 `index`，删除这一项。subtree 节点上的条件通过 override 写整个数组：删完还剩条件时写剩下的数组；源文件里有条件而删完为空时仍然拒绝（`condition-clear-denied`），和现在一样。
- 新增 `moveCondition`：payload `{ target, index, direction: "up" | "down" }`，和相邻项交换；到头时是 noop。subtree 节点同样写 override。选中跟着这一项移动。
- `updateNode` 已经提交整个 `conditions` 数组，条件面板改 `abort` / `custom` 时改对应序号即可。
- `setConditionRoot`（条件文件写回）：payload 带 `index`。

### 4.4 条件面板（Inspector）

- 显示选中的那一项。面板里不放序号和上移、下移、删除按钮：画布上的卡片已经表明是哪一项，这些操作走右键菜单和快捷键（4.5）。
- "打开编辑视图"打开这一项的条件文件。

### 4.5 右键菜单

- "添加条件"：任何可编辑节点都可用，追加一项。
- 选中某张卡片时，额外显示"删除条件"、"上移条件"、"下移条件"，作用于这一项。选中节点主体时不显示删除和移动（避免不清楚删的是哪一项）。
- 右键点在某张卡片上时，先把选择切到这一项再弹菜单。
- 快捷键：选中某张卡片时，⌘+↑ / ⌘+↓（Windows、Linux 上是 Ctrl+↑ / Ctrl+↓）上移、下移这一项，到头时不变；菜单项上显示这两个快捷键。没有选中卡片时不处理这两个键。

### 4.6 条件文件

- 地址按序号区分：第 1 项仍是 `…/<uuid>/condition.json`（已有标签页地址不变），第 n 项（n ≥ 2）是 `…/<uuid>/condition-<n>.json`。面包屑显示 `hero.json › <uuid> › condition-2.json`。
- 读、写回、刷新都按序号定位。
- 已知限制：条件文件打开期间在宿主里删除或移动条件，标签页按序号重新读取，会变成显示另一项；对应序号不存在时读不出来（和现在删掉条件后的行为一样）。

## 5. Design

- `webview/shared/contracts.ts`：
  - `ResolvedNodeModel` / `GraphNodeVM`：`attachedConditionName` / `attachedConditionAbort` 换成 `attachedConditions: { name: string; abort: AbortMode }[]`（空数组表示没有）。
  - `HostSelectionState` 条件项加 `index`；`SelectionState` 加 `selectedConditionIndex`。
  - `RemoveConditionInput` 加 `index`；新增 `MoveConditionInput` 和 `moveCondition` 修改；`setConditionRoot` payload 加 `index`。
- `webview/shared/document.ts`：`reduceAttachCondition` 追加；`reduceRemoveCondition` 按序号；新增 `reduceMoveCondition`；`reduceSetConditionRoot` 按序号；`nextSelection` 返回条件序号。
- `webview/shared/condition-file.ts`：`buildConditionFilePath` / `buildConditionFileLocation` / `parseConditionFileLocation` / `buildConditionFileTree` 加序号。
- `webview/domain/resolve-graph.ts`、`graph-selectors.ts`：生成 `attachedConditions`。
- `webview/adapters/graph/g6-graph-node.ts`：按项循环画卡片，形状名带序号（`condition-adornment-<i>` 等），记住上次画了几张以清除多余的形状；从下往上画；选中项高亮。
- `g6-graph-node-measure.ts`、`g6-graph-adapter.ts`：高度、拖放判断按 `卡片数 × 30`；点击/双击/右键从形状上读出序号。
- `webview/commands`：`attachCondition`、`removeCondition(index)`、`moveCondition(index, direction)`、`openConditionFile(target, index)`；选择投影带序号。
- `src/`：`selectNode` / 选择同步、条件文件 provider、侧栏协调器带序号。
- `webview/features/inspector/condition-inspector-form.tsx`、`webview/features/graph/graph-pane.tsx`：面板按钮和右键菜单。
- 语言文件：新增菜单文字和提示。
- `webview/shared/keys.ts`：`Hotkey.MoveConditionUp` / `MoveConditionDown`。

## 6. Implementation Plan

1. 数据和修改命令：contracts、reducer（添加、删除、移动、写回按序号）、条件文件地址。
2. 选择带序号：webview 选择 store、host 选择同步、侧栏。
3. 画布：多张卡片、序号命中、选中高亮、高度。
4. Inspector 和右键菜单。
5. 测试、基线 spec（02、11、14、15、16、17）、`node-conditions.md` 里"只编辑第一项"的说明。

## 7. Testing Plan

shared tests：

- `attachCondition` 在已有条件的节点上追加；subtree 节点写 override。
- `removeCondition` 删除中间一项、最后一项；subtree 源文件有条件时删空被拒绝、删一项写 override。
- `moveCondition` 上移、下移、到头 noop；subtree 节点写 override。
- `setConditionRoot` 写回第 2 项，其他项不变。
- 条件文件地址：`condition.json` ↔ 序号 0，`condition-3.json` ↔ 序号 2，非法名字解析失败。
- resolve graph 生成的 `attachedConditions` 顺序和内容正确。
- 卡片命中：从指针事件读出卡片序号。
- 自定义字段脚本、`$nodeId` 默认值对第 2 项同样生效（已有逻辑覆盖所有项，补一个用例）。

## 8. Acceptance Criteria

- 给节点加第 2 个条件，画布上出现两张叠在一起的卡片，第 1 张的卡扣落在第 2 张上，第 2 张的落进节点色条。
- 点第 2 张卡片，Inspector 显示第 2 项，可以改 `abort`、自定义数据，上移后它变成第 1 张，选中跟着走。
- 双击第 2 张卡片打开 `condition-2.json`，保存后宿主文件第 2 项更新，第 1 项不变。
- 删除选中的一项后另一项保留。
- `npm run check`、`npm run test:shared`、`npm run build` 通过。

## 9. Risks and Rollback

- 选择状态加序号会碰到 webview、宿主、侧栏三处同步，是改动面最大的部分；序号缺失时一律按 0 处理，保证旧消息兼容。
- 画布形状名变成动态的，状态样式表按形状名配置，条件卡片目前没有状态样式，影响小。
- 条件很多时节点会很高，先不限制。
- 回滚：恢复"已有条件时不能添加"即可回到单项界面，数据层不受影响。
