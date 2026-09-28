# Node-Attached Decorator

Status: Implemented
Date: 2026-09-24
Scope: persisted node model / main-graph adornment / decorator-branch editor

6.4 的决策已确认，第 7 节的实现步骤已经落地，编号基线 spec 已同步。

## 1. Context

当前 `PersistedNodeModel`（`webview/shared/contracts.ts`）是主文档里一个节点的可写形状。读入时 `normalizeNodeData` 只保留 `uuid`、`id`、`name`、`desc`、`args`、`input`、`output`、`children`、`debug`、`disabled`、`path`、`$status`。模型外的字段在打开文件时会被丢掉。

节点上的子结构今天只有两种：

- `children`：这个节点在主树里的子节点，画布按父子边布局
- `path`：指向另一份 subtree JSON。双击节点会打开那份文件

`type: "Decorator"` 是 `*.b3-setting` 里的节点类别，例如反转、始终成功。它是树里的一个父节点，不是挂在别的节点旁边的附属数据。节点能不能挂附属装饰器，由节点定义上的 `supportDecorator` 表示，不写进每个树节点实例。

图层不读 `PersistedNodeModel`。主树先物化、再压成 `ResolvedGraphModel`，由 `G6GraphAdapter.render` 绘制。节点双击目前只用于打开 subtree。

本次要给节点增加一种附属装饰器：装饰器本身是一棵完整枝干，编辑时贴在宿主节点旁边。双击后，在当前编辑器的临时页面里编辑这棵枝干。

## 2. Goals

- 在 `*.b3-setting` 的节点定义上表达这个节点类型能不能挂装饰器。
- 在 `PersistedNodeModel` 上用一个可选的 `decorator` 保存当前挂着的那一棵枝干。枝干的值本身是 `PersistedNodeModel`，可以继续包含 `children`、`args`、`path` 等现有节点字段。
- 主图渲染时，装饰器附在宿主节点 UI 的上方，不作为宿主节点的 `children` 参与主图父子布局。
- 双击这块附属 UI，在同一编辑器里打开临时页面，编辑该装饰器枝干。
- 子树内部节点上的 `decorator` 写入主文档 `overrides`。
- 复制、粘贴、删除宿主节点时，`decorator` 整枝跟着走。
- 旧树文件没有 `decorator` 时仍能打开。节点定义没写 `supportDecorator` 时视为不支持。
- 选中节点后，Inspector 用和节点类型相同的只读字段显示该节点定义是否支持装饰器。

## 3. Non-Goals

- 不把节点类别 `Decorator` 改成这种附属数据。现有反转、始终成功等父节点保持原样。
- 不定义装饰器枝干的运行时执行语义，也不定义 build / batch 要把它展开成什么样的输出树。
- 不支持一个节点挂多棵装饰器。字段是单个可选枝干，不是数组。
- 不把装饰器枝干拆成独立的 `*.json` 文件。它嵌在宿主节点上。
- 不另开一个可独立存活的 webview 或第二个自定义编辑器页签。
- 不在装饰器枝干内部再挂 `decorator`。
- 不在装饰器枝干内部放置自身会返回 `running` 的节点。
- 本草案未批准前，不修改编号基线 spec。

## 4. Current Behavior

- 节点定义没有 `supportDecorator`。`PersistedNodeModel` 没有 `decorator`。
- 写入主文档的结构变更都进 `reduceDocumentMutation`。子树内部节点的覆盖只包含 `desc`、`input`、`output`、`args`、`debug`、`disabled`。
- 主图节点来自 resolved graph。G6 只接收 `ResolvedGraphModel` 和选中、高亮、搜索、视口这些视觉状态。
- 双击节点会按命中节点的 `node.ref` 打开 subtree，不依赖当时选中已经落到这个节点。
- 每个自定义编辑器会话对应一份树文件的 `TreeEditorDocument.content`。webview 不直接写磁盘。

## 5. Proposed Behavior

`*.b3-setting` 的节点定义增加：

- `supportDecorator?: boolean`  
  这一类节点是否允许挂装饰器。未写或值为 `false` 都表示不允许，写出节点定义时省略 `false`。

`PersistedNodeModel` 增加：

- `decorator?: { enterPriority: number; maintainPriority: number; abortType: AbortType; root: PersistedNodeModel }`  
  挂在这个节点上的装饰器。`root` 是一棵完整枝干，而不是宿主节点的 `children` 成员。`enterPriority` 和 `maintainPriority` 都是整数。`enterPriority` 固定等于宿主节点 id 的整数值，不能改。`maintainPriority` 默认等于进入优先级，可以改成更小的整数，但不能大于进入优先级，也不能小于 0。`abortType` 是 `None`、`Self`、`Lower Priority`、`Both` 之一，缺省或无法识别时为 `None`。新挂上的装饰器也是 `None`。

用户可见行为：

- 选中节点后，右侧 Inspector 在「节点类型」下面显示「支持装饰器」。控件与节点类型相同，是只读输入框。值来自该节点名称对应的节点定义：`supportDecorator === true` 时显示 `true`，未写、`false`、找不到节点定义时显示 `false`。在表单里改节点名并切换到另一条节点定义时，这个字段和节点类型一起更新。
- 节点定义允许挂装饰器时，右键该节点，选择添加装饰器，再选定一个节点作为枝干入口。这个入口节点成为 `decorator` 的根。
- 节点定义允许挂装饰器，而且节点已经有装饰器时，右键显示「删除装饰器」。主树节点会去掉自己的 `decorator`。子树节点上仅由主文档 override 挂上的装饰器也可以删掉。子树源文件里已经有的装饰器不显示这项，也不能被清掉。
- 主图上，已挂上的装饰器画在宿主节点 UI 的上方，和节点卡片连在一起。左侧文字固定为当前语言的「decorator」（英文 `decorator`，中文 `装饰器`），右侧显示 `abortType`（`None`、`Self`、`Lower Priority`、`Both`），颜色都为白色，不显示入口节点名。没有 `decorator` 的节点不出现这块上方 UI。
- 单击上方 UI，右侧 Inspector 显示装饰器面板，而不是宿主节点面板。单击节点本体仍显示节点面板。
- 装饰器面板里，进入优先级只读，数值等于宿主节点 id 的整数。维持优先级默认与进入优先级相同，只能改成 0 到进入优先级之间的整数。节点 id 重新分配后，仍等于旧进入优先级的维持优先级跟着变成新 id；已经改小的维持优先级保持原值，并限制在 0 到新进入优先级之间。中断类型用下拉框选择 `None`、`Self`、`Lower Priority`、`Both`，默认 `None`。面板提供「打开编辑视图」按钮，进入同一套临时页面。
- 双击上方 UI 也会进入该临时页面，编辑对象是这棵 `decorator` 枝干。双击命中范围与单击相同，覆盖整条上方附属，不限于文字。双击宿主节点本体仍按今天的规则打开 subtree。
- 关闭临时页面时，若有未保存修改，弹出确认：保存、撤销、取消关闭。保存会写回父文档并离开临时页面；撤销会放弃这次未保存修改并离开；取消关闭则留在临时页面。这里的撤销指放弃临时页面中的修改，不是编辑器撤销栈。
- 装饰器编辑只发生在这个临时页面里，不存在另一个还开着的装饰器页面，因此不单独处理「父节点已经删除，装饰器页面仍打开」的情况。
- 打开文件时，若节点定义不允许装饰器，但 JSON 里仍有 `decorator`，剥掉该字段。
- 当前树用到装饰器时，`custom` 里自动有 `$decorator_type`。值只能是 `local` 或 `global`，缺省或无法识别时为 `local`。树 Inspector 的自定义数据里，这一行的键不可改、不可删，值用下拉框选择。树上没有装饰器时不自动添加；已经写过的值保留，并仍用同一个下拉框编辑。
- 装饰器枝干内部不能再出现 `decorator`，也不能放入自身会返回 `running` 的节点。判定只看节点定义 `status` 里的字面量 `running`。`|running` 表示子节点返回 `running` 时本节点也返回 `running`，允许放入。

## 6. Design

### 6.1 数据形状

编辑器自己的 `NodeDef` 定义在 `webview/shared/b3type.ts`，继承 `behavior3` 的 `NodeDef`，不修改上游类型。节点定义额外字段：

```ts
supportDecorator?: boolean;
```

树节点：

```ts
export interface PersistedDecoratorAttachment {
    enterPriority: number;
    maintainPriority: number;
    abortType: "None" | "Self" | "Lower Priority" | "Both";
    root: PersistedNodeModel;
}

export interface PersistedNodeModel {
    // ...现有字段
    decorator?: PersistedDecoratorAttachment;
}
```

`root` 仍是节点，所以枝干内部仍可有 `children` 和 `path`。按第 5 节的限制，枝干内部节点的 `decorator` 字段不得有值，也不得放入自身会返回 `running` 的节点。

这条数据要能活过现有数据源管线：

- `normalizeNodeDef` 识别 `supportDecorator`。缺省按 `false`，`false` 不写回节点定义文件。
- `normalizeNodeData` 保留 `decorator`。若当前节点定义的 `supportDecorator` 不为 `true`，读入时去掉 `decorator`。
- `tree.ts` 的读写、克隆、遍历必须走进 `decorator`，不能只走 `children`。
- `reduceDocumentMutation` 能修改宿主节点上的 `decorator`。复制、粘贴、删除宿主节点时整枝一起处理。
- 主文档 `overrides` 的字段集合加入 `decorator`。子树内部节点的装饰器改动记在主文档覆盖上，不改 subtree 源文件。
- 保存前的 display id 回写和 stale override 清理把 `decorator` 枝干算进要扫描的节点，但不把它当成宿主节点的 `children`。

### 6.2 和主图的边界

主图仍然只消费 resolved graph。装饰器上方 UI 是宿主节点的附属绘制，不是把 `decorator.children` 接进宿主节点的父子边。

resolved graph 需要能回答两件事：宿主节点是否带有装饰器枝干，以及双击上方附属时要进入哪一棵枝干。枝干内部的展开布局只出现在临时页面，不出现在主图布局里。

上方双击和节点本体双击必须分开命中，而且上方双击的范围与上方单击相同。本体双击继续打开 subtree。

### 6.3 临时页面和现有会话的关系

临时页面属于当前这个自定义编辑器，不是第二份树文件，也不是第二个 `TreeEditorDocument`。磁盘文本、dirty 和撤销历史仍在父文档的 host session 上。

- 临时页面复用现有图和 Inspector，把 `decorator` 这棵枝干当作当前要编辑的树根。
- 页面里的结构修改提交到父文档，写成对那个节点 `decorator` 的变更。
- 关闭时的「保存」保存父文档；「撤销」丢掉临时页面上还没保存的修改；「取消关闭」留在页面中。

### 6.4 决策记录

1. `supportDecorator` 放在 `*.b3-setting` 的节点定义上，不放在 `PersistedNodeModel` 上。选中节点时，Inspector 只读显示这个定义字段，展示方式和节点类型相同。
2. 节点定义未写 `supportDecorator` 时视为 `false`。值为 `false` 时不写入节点定义文件。
3. 节点定义不允许装饰器，但树 JSON 里已经有 `decorator` 时，打开文件时剥掉 `decorator`。
4. 添加方式：右键节点，选择添加，再选一个节点作为装饰器枝干的入口节点。节点已经有装饰器时，右键显示删除。主树节点直接去掉 `decorator`。子树源文件里已有的装饰器不能删。
5. 编辑界面是同一编辑器里的临时页面。关闭时若有未保存修改，弹出确认，选项为保存、撤销、取消关闭。
6. 因为只在这个临时页面里编辑，不另开独立页面，所以不为「父节点删除后装饰器页面仍开着」单做失效处理。
7. 子树内部节点的 `decorator` 进入主文档 `overrides`。
8. 装饰器枝干内部不允许再使用装饰器，也不允许使用自身会返回 `running` 的节点。只拒绝节点定义 `status` 含字面量 `running` 的节点。`|running` 是子节点状态向上传递，允许放入。
9. 复制、粘贴、删除宿主节点时，`decorator` 整枝跟着走。
10. 构建产物和运行时如何执行这棵枝干，本次不做。
11. 父树不能把子树节点上已有的装饰器清成没有。这和父树不能删除子树里的节点一样：`overrides` 只能写上或替换一棵枝干，省略 `decorator` 表示沿用子树源，不表示删除。源文件里的装饰器仍留在子树文件中。主树节点自己的 `decorator` 字段可以直接改写。

## 7. Implementation Plan

1. 确认本文，并把 `Status` 改为 `Approved`。已完成。
2. 扩展节点定义、持久化模型和 reducer。已完成。
3. 把附属关系放进 resolved graph，并画在节点上方。右键添加入口可用。已完成。
4. 双击上方附属进入同一编辑器的临时页面，编辑结果回到父文档。已完成。
5. 枝干内部拒绝嵌套 `decorator` 和自身会返回 `running` 的节点。复制、粘贴、删除带上整枝。已完成。
6. 同步 `11`、`13`、`14`、`15`、`17` 以及 `01`。已完成。

## 8. Testing Plan

- 解析节点定义：缺省、`false`、`true`。`false` 不写回文件。
- 解析树：无 `decorator` 的旧 JSON；带嵌套 `children` 的 `decorator`；节点定义不允许时剥掉已有 `decorator`。
- 枝干约束：内部再挂 `decorator` 被拒绝；`status` 含字面量 `running` 的节点不能放入；只含 `|running` 的节点可以放入。
- reducer：修改枝干内部节点后，宿主节点的 `children` 不变；复制、粘贴、删除宿主节点时整枝跟随；子树内部节点的 `decorator` 出现在主文档 `overrides`。
- 序列化往返：`readTree` / `writeTree` 后 `decorator` 仍在，且不会被 `normalizeNodeData` 丢掉。
- 交互：选中节点后 Inspector 在节点类型下显示只读的支持装饰器字段；右键添加并选择入口节点；装饰器面板的「打开编辑视图」按钮进入临时页面；上方附属双击也可进入；节点本体双击仍打开 subtree；关闭确认三条路径。

## 9. Acceptance Criteria

- 实现开始前，本文件状态为 `Approved`。
- 一份不含 `decorator` 的现有树文件仍能用 Behavior3 编辑器打开。
- 选中节点后，Inspector 在节点类型下方显示只读的「支持装饰器」。节点定义显式 `supportDecorator: true` 时显示 `true`；未写、`false` 或没有对应节点定义时显示 `false`。它不能在 Inspector 里编辑。
- 节点定义未写 `supportDecorator` 时，该节点不能添加装饰器。
- 节点定义不允许装饰器时，打开含 `decorator` 的树会去掉该字段，并且之后保存不再写出它。
- 在允许装饰器的节点上右键添加，并选定入口节点后，该节点的 `decorator` 根就是这个入口节点。保存再打开后，枝干的 `name`、`args`、`children` 仍在，且这些节点不出现在宿主节点的 `children` 里。
- 允许装饰器且已经挂上装饰器的节点，右键有「删除装饰器」。删除后该节点不再有 `decorator`，`children` 不变。子树源文件里已有的装饰器不能通过这项删除。
- 主图中，带 `decorator` 的节点在节点 UI 上方有附属显示；不带 `decorator` 的节点没有这块显示。左侧文字为当前语言的「decorator」，右侧为 `abortType`，颜色为白色。
- 装饰器的 `abortType` 是 `None`、`Self`、`Lower Priority`、`Both` 之一，缺省和新挂上时为 `None`。装饰器面板用下拉框修改它。
- 节点 id 重新分配后，仍等于旧进入优先级的维持优先级改为新 id。已经改小的值保持不变，大于新进入优先级时降到该值。
- 树上用到装饰器时，`custom` 含 `$decorator_type`，值为 `local` 或 `global`，缺省为 `local`。树上仍有装饰器时，这一项不能改键，也不能删除。
- 装饰器面板的「打开编辑视图」按钮进入当前编辑器的临时页面，其中编辑的是该 `decorator` 枝干。双击上方附属也可以进入。双击带 `path` 的节点本体仍然打开对应 subtree 文件。
- 临时页面有未保存修改时，关闭会提示保存、撤销或取消关闭。保存后父 JSON 含更新后的 `decorator`。撤销后父 JSON 保持进入临时页面前的 `decorator`。取消关闭后仍停留在临时页面。
- 子树内部节点的 `decorator` 改动写在主文档 `overrides` 中，subtree 源文件不变。
- 装饰器枝干内不能保存嵌套 `decorator`，也不能保存自身会返回 `running` 的节点。只含 `|running` 的节点可以保存。
- 复制、粘贴宿主节点后，新节点带有同样的 `decorator` 枝干。删除宿主节点后，该枝干不再留在树里。
- build / batch 的输出规则与本次改动前相同，不因 `decorator` 字段改变执行语义。

## 10. Risks and Rollback

- 若只改 `contracts.ts` 而不改 `normalizeNodeData`，装饰器会在打开文件时被静默丢掉。节点定义字段和树节点字段必须一起落地。
- 遍历若漏掉 `decorator`，复制、校验、保存时的 override 清理会漏掉整枝。
- 节点双击今天已经绑定 subtree。上方附属双击必须和节点本体双击分开命中，否则会盖住现有打开 subtree 的路径。
- 临时页面若自成一份文档历史，会和父文档的撤销、dirty 分裂。编辑仍提交到父会话，不引入第二份 `TreeEditorDocument`。
- 回滚：本需求未实现前，删除本 work-item 即可。实现之后，回滚需要同时撤回节点定义字段、树节点字段、归一化、覆盖、主图附属绘制和临时页面。
