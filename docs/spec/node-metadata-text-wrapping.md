# Node Metadata Text Wrapping

Status: Done
Date: 2026-05-15
Scope: 优化画布节点中备注、参数、输入、输出等元信息文本的换行与高亮背景尺寸。

## 1. Context

画布节点卡片会把节点参数、输入、输出等元信息直接渲染在固定宽度的 G6 自定义节点内。当前用户反馈参数文本在较长 JSON5 内容下换行不理想，截图中 `status` 被拆成 `stat` / `s`，并且第二行靠近或越过节点右侧可视边界。

该问题只影响图层展示，不涉及 persisted tree、host protocol、Inspector 提交或保存语义。

## 2. Goals

- 节点元信息文本应在卡片内容区域内换行，不越过节点右边界。
- 紧凑 JSON5 参数应优先在逗号、空格、括号等自然边界换行，避免优先拆分 key 名称。
- 参数、输入、输出被变量高亮时，高亮背景高度应覆盖多行文本。
- 备注、参数、输入、输出在单行与多行场景下都应保持一致的纵向排版节奏。
- 图节点测量高度与实际绘制使用同一套换行宽度、行高与段落步进。

## 3. Non-Goals

- 不改变节点数据、参数序列化或 JSON5 字符串内容。
- 不改变图层布局方向、节点宽度、连线布局或交互事件。
- 不重做节点卡片视觉设计。
- 不改变 Inspector 表单展示。

## 4. Current Behavior

- `drawArgsText` 与 `measureGraphNode` 使用硬编码 `200` 像素宽度拆行，和节点实际内容区域没有共享约束。
- 文本拆行按可容纳字符数硬切，遇到紧凑参数时可能把 `status` 这类 key 拆到两行。
- 参数、输入、输出的变量高亮背景高度固定为 18 像素，多行文本时只覆盖第一行。
- 当前 metadata 纵向布局把“行内步进”和“段间步进”拆成了两套值；当参数换成两行时，备注 -> 参数首行、参数内部续行、续行 -> 输入之间的 top-to-top 节奏会变成 `16 / 18 / 16`，视觉上不一致。

根因：图节点元信息的测量、绘制和高亮背景没有共享一个明确的内容宽度契约，且换行算法缺少自然断点偏好。
另一个根因：metadata block 没有统一的纵向 rhythm 契约，wrapped continuation 和 section transition 走了不同的步进公式。

## 5. Proposed Behavior

- 图节点元信息使用共享的内容文本宽度常量，测量和绘制保持一致。
- 文本测量字体应对齐 `@antv/g` `Text` 的默认绘制字体，而不是读取宿主 DOM 字体，避免测量偏宽导致过早换行。
- 换行算法先计算当前行最大可容纳字符，再在该范围内优先选择靠近行尾的自然断点；没有合适断点时才按字符硬断。
- 多行参数、输入、输出高亮背景高度跟随行数增长。
- metadata block 使用统一的垂直步进：备注 -> 参数、参数续行、参数 -> 输入、输入 -> 输出都沿同一 `row height` 累进，不再额外插入更小的 section gap。

## 6. Design

- 在 `g6-graph-node-constants.ts` 中集中声明节点内容 x 坐标、右侧安全留白、元信息换行宽度和行高。
- 在 `g6-graph-node-measure.ts` 中提供 `getArgsText`，让测量和绘制复用同一份参数换行结果。
- 测量逻辑使用 `@antv/g` `Text` 默认的 `sans-serif` 字体族，并保留真实 canvas `measureText`，不使用 VS Code shell computed font。
- `calcTextLines` 保留宽度缓存和二分查找，但增加自然断点选择：优先在 `,`、空白、中文标点和括号后换行，且断点不能离行首过近。
- 节点绘制层只消费测量结果，并按行数计算高亮背景高度。
- metadata block 只保留一套纵向 rhythm：section start 与 wrapped continuation 都按同一 `G6_GRAPH_NODE_ROW_HEIGHT` 递进；节点总高度测量也必须复用同一公式。

## 7. Implementation Plan

1. 新建本 work-item spec，并同步图层基线中的节点元信息换行规则。
2. 提取共享布局常量，替换绘制和测量中的硬编码宽度。
3. 优化 `toBreakWord` 底层换行算法，偏好自然断点。
4. 修正参数、输入、输出高亮背景的多行高度。
5. 收敛 metadata block 的纵向排版公式，移除与行高不同步的 section gap。
6. 增加共享测试覆盖自然断点换行、无断点硬断，以及 wrapped metadata 只按单一 row height 增高。
7. 运行 `npm run test:shared` 与 `npm run check`。

## 8. Testing Plan

自动检查：

- 运行 `npm run test:shared`。
- 运行 `npm run check`。

手动回归：

1. 打开 `sample/vars/test-vars.json` 的 Behavior3 editor。
2. 查看包含 `status:'RUNNING'` 的 `TestB3` 节点。
3. 确认参数文本在节点内换行，不把 `status` 拆开且不越出右边界。
4. 触发变量参数高亮时，背景覆盖多行文本。
5. 对比一个单行参数节点和一个双行参数节点，确认备注、参数续行、输入、输出都落在统一的垂直节奏上。

## 9. Acceptance Criteria

- `TestB3` 参数文本不会越过节点内容右边界。
- 参数文本优先在逗号等自然边界换行，截图场景不再拆分 `status` key。
- 参数、输入、输出多行高亮背景覆盖全部文本行。
- 单行 metadata section 与多行 metadata continuation 之间使用同一纵向步进，不出现更小的分段间距。
- `npm run test:shared` 通过。
- `npm run check` 通过。

## 10. Risks and Rollback

风险：更保守的元信息宽度会让部分节点高度增加，树布局间距可能随之变化。

缓解：保持节点宽度和 G6 布局参数不变，只调整文本断行与测量一致性。

回滚方式：恢复原先硬编码宽度和字符级拆行逻辑；这会重新引入长参数文本越界和 key 名称被拆分的问题。
