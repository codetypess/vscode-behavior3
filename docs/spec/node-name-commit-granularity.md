# Node Name Commit Granularity

Status: Verifying
Date: 2026-05-14
Scope: 收窄 Node Inspector `name` 字段提交粒度，避免把 `unknown` 节点改名时顺带写入输入槽与参数值。

## 1. Context

用户在 Node Inspector 中把一个节点的名称文本粘贴到 `unknown` 节点的 `name` 字段时，当前实现会在提交 `name` 的同时，把 `input`、`output` 和 `args` 也一起构造成 `updateNode` payload。

这使得“只是改名字”变成了“改名字并顺带生成字段值”。对用户而言，这是非预期的扩写。

另外，Node Inspector 当前在切换节点时复用同一个 Ant Design `form` 实例，并直接 `setFieldsValue(...)`。对于 `args` 这类嵌套对象，旧节点留下的表单值可能继续残留到新节点，导致 `unknown` 节点在改名前后看起来带着上一个节点的参数值。

更具体地说，当 `name` 文本刚改成某个已知 nodeDef 时，Inspector 会立即按这个 nodeDef 预览参数区；如果此时不先清空依赖字段，Ant Design 对嵌套字段的 merge 会让上一个节点的 `args.time = 1` 这类值继续停留在 form store 中，随后可能被参数字段自己的 blur 提交器写回当前节点。

另外，若预览值把 required arg 表达成 `{ time: undefined }` 这类对象，再交给 `setFieldsValue(...)`，Ant Design 不会把旧的嵌套值真正删除，只会保留之前的 `time = 1`。这会让 UI 看起来先是缺值，失焦后又“复活”为旧值。

## 2. Goals

- `name` 字段提交时只提交 `name`。
- 把 `unknown` 节点改名为已知 nodeDef 时，不自动生成 `input`、`output` 或 `args` 值。
- 切换到新节点时，Node Inspector 清空上一节点留下的 `args`、`inputSlots`、`outputSlots` 等表单状态。
- 同一逻辑节点在宿主回推最新 snapshot 时，Node Inspector 不做整表 reset，避免保存后整块输入区域闪烁。
- 对存在 nodeDef 默认参数的已知节点，Inspector 仍显示当前 effective arg 值，不因为提交粒度收窄而把默认值展示成“空值”。
- 对存在 nodeDef 默认参数的已知节点，默认值在未显式编辑前不写回主文档 JSON。
- 对存在 nodeDef 默认参数的 arg，Inspector 在右侧提供重置按钮；点击后先二次确认，再清除当前显式值并回退到默认值语义。
- 保持其他字段各自独立提交，不扩大这次改动范围。

## 3. Non-Goals

- 不改 Node Inspector 其他字段的提交方式。
- 不改 host reducer 的 `updateNode` 语义。
- 不额外设计“切换节点类型时自动迁移参数”的新规则。

## 4. Current Behavior

- `commitName()` 当前会校验 `name`、`inputSlots`、`outputSlots`、`args`。
- 它会基于目标 nodeDef 重新构造 `input`、`output` 和 `args`，并和 `name` 一起发给 `updateNode()`。
- 因此单独改 `name` 时，也可能让参数区出现值或发生写入。
- Node Inspector 切换节点时直接 `setFieldsValue(...)`，不会显式清空旧表单中已经存在的嵌套字段，因此上一个节点的参数值可能残留到当前节点表单里。
- `name` 变化导致的 nodeDef 预览切换同样会命中这条 merge 路径；旧的 `args` 值即使新预览值是 `undefined`，也可能继续残留在 form store 中。
- `createNodeInspectorFormValues()` 当前会把 required arg 的无值状态保留成 `args` 对象里的 `undefined` 键，这进一步放大了 merge 残留问题。
- 当主树普通节点的 Inspector snapshot 改为只携带 committed `args` 后，结构化参数区失去了“resolved default args”这层展示值来源，导致图节点已显示默认参数，但 Inspector 字段看起来像未填写。

根因有两个：

- `name` 字段的 commit 粒度过大，超出了“只改当前字段”的边界。
- 节点切换时的表单重建不彻底，导致旧节点嵌套字段残留。
- Inspector 当前把“用于提交的 committed 数据”和“用于显示的 effective 默认值”混在同一份 `selectedNode.data.args` 里；修掉前两项后，这个语义缺口暴露出来了。

## 5. Proposed Behavior

- `commitName()` 只校验 `name` 字段。
- `commitName()` 只发送 `name` 变更，其余字段保持当前 committed 数据原样不动。
- 切换节点时先清空当前 form store，再写入新节点的初始化值。
- `name` 预览切到新 nodeDef 时，先清空 `args`、`inputSlots`、`outputSlots` 等依赖字段，再写入当前节点在该 nodeDef 下的预览值。
- 预览/初始化 `args` 时，只保留真正有值的 key；无值 arg 通过缺少该 key 表达，而不是 `{ key: undefined }`。
- Inspector snapshot 对主树普通节点继续保留 committed `args` 作为提交基线；同时单独暴露 resolved/effective `args` 供参数区展示与校验使用。
- arg 字段提交时，若当前值仅仅等于展示出来的默认值且该字段未被用户实际改动，则保持 committed `args` 不变。
- 其他字段仍由各自的 commit handler 独立负责。

## 6. Design

- 提取一个纯 helper，用于构造“仅名称变更”的节点 payload。
- `useNodeInspectorCommitters()` 的 `commitName()` 改用该 helper。
- 移除 `commitName()` 对 `inputSlots`、`outputSlots`、`args` 的联动校验与构造。
- `NodeInspectorForm` 在 `selectedNode` 变化时先 `resetFields()`，避免 `args` 等嵌套值被 `setFieldsValue` 合并残留。
- “selectedNode 对象变了”不等于“切换到了新节点”；真正的切换依据是 `NodeInstanceRef` 的逻辑身份（`structuralStableId`、`sourceStableId`、`sourceTreePath`、`subtreeStack`）。
- 对同一逻辑节点的 host snapshot 回推，仅做字段 patch；只有真正切换节点时才整表 reset。若同一逻辑节点的 committed `name` 发生变化，则只清空依赖字段后再 patch。
- 当 `effectiveName !== selectedNode.data.name` 时，把这次视为“名称预览切换”；此时单独 reset 依赖字段，再写入新的预览型 `args` / `inputSlots` / `outputSlots` / 只读元信息。
- 在清空依赖字段时，使用根字段级别的 `setFieldValue("args", {})` / `setFieldValue("inputSlots", [])` / `setFieldValue("outputSlots", [])`，避免只 reset 已注册子字段时遗漏隐藏残留值。
- `createNodeInspectorFormValues()` 在构造 `args` 时过滤掉值为 `undefined` 的条目。
- `EditNode` snapshot 为 Inspector 补充一份只读的 effective arg 视图；主树普通节点的 committed `data.args` 保持与 JSON 一致，不再承载默认值展示语义。
- 对带默认值的 arg，在控件右侧补一个独立 reset action；该 action 先二次确认，确认后不走“清空必填字段”的常规 blur 校验，而是直接移除 committed arg key，让 effective 默认值重新生效。
- 增加共享测试，覆盖 `unknown` 节点改名后不生成参数的回归场景。
- 增加共享测试，覆盖 `unknown` 节点的初始化 form values 为空参数/空槽位。
- 增加共享测试，覆盖 required arg 在无 committed 值时不会以 `undefined` key 形式残留在预览对象中。
- 增加共享测试，覆盖“主树节点有默认参数但 JSON 未显式存储时，Inspector 仍显示 effective 默认值”。
- 增加共享测试，覆盖“默认值未改动时不写回 committed args；显式改动后才会写回”。

## 7. Implementation Plan

1. 新建本 work-item spec，并同步 baseline spec 的提交粒度规则。
2. 收窄 `commitName()` 提交内容。
3. 切换节点时清空 form store 后再写入新节点值。
4. 在名称预览切换时清空依赖字段并重建预览值。
5. 增加共享测试。
6. 运行 `npm run test:shared` 与 `npm run check`。

## 8. Testing Plan

自动检查：

- 运行 `npm run test:shared`。
- 运行 `npm run check`。

手动回归：

1. 选中一个 `unknown` 节点。
2. 在 `name` 字段粘贴已知节点名称。
3. 提交后确认只发生名称变化，不自动带入参数值。
4. 从带 `args.time = 1` 的 `Wait` 节点切到 `unknown` 节点，确认 Inspector 不残留 `time = 1`。
5. 在 `unknown` 节点的 `name` 字段粘贴 `Wait`，尚未提交前也不应在参数预览区看到残留的 `time = 1`。
6. 选中一个 JSON 中未显式保存参数、但 nodeDef 定义了默认参数的主树节点，确认图节点与 Inspector 都显示默认值；只读 JSON 仍保持未写入该 `args`。
7. 仅聚焦并失焦一个显示默认值的 arg 输入框，不修改内容，确认文件内容不变。

## 9. Acceptance Criteria

- `name` 字段提交只影响 `name`。
- `unknown` 节点改名后，不会因为本次提交自动生成 `input`、`output` 或 `args`。
- 切换到 `unknown` 或其他不兼容节点时，上一节点的 `args` / `input` / `output` 表单值不会残留显示。
- 名称预览切到另一个 nodeDef 时，依赖字段不会从上一个节点的 form store 残留值里“借尸还魂”。
- 名称预览切换后失焦，也不会因为 `{ key: undefined }` merge 语义把旧参数值重新带回当前节点。
- 对仅依赖 nodeDef 默认值的主树节点，Inspector 参数区显示 effective 默认值，但不会因此把主文档 JSON 中缺失的 `args` 误判成已提交值。
- 用户若未实际编辑该 arg 字段，单纯聚焦/失焦不会把默认值写回文件；一旦显式改动该字段，则当前值可被提交到文件。
- 用户点击默认值 arg 右侧的重置按钮并确认后，当前显式值会被移除，节点重新回到“使用默认值”的状态。
- 同一逻辑节点保存成功后，Inspector 不会因为宿主 snapshot 回推而整块 reset 造成明显闪烁。
- `npm run test:shared` 通过。
- `npm run check` 通过。

## 10. Risks and Rollback

风险：切换到不同 nodeDef 后，旧的 `input` / `output` / `args` 可能继续保留，直到用户显式修改这些字段。

这是本次有意接受的行为，因为目标就是“改哪就是哪”。

回滚方式：恢复 `commitName()` 的联动构造逻辑，但这会重新引入本次用户反馈的意外扩写问题。
