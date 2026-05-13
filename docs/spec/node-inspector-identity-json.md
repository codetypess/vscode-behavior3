# Node Inspector Identity And JSON

Status: Implementing
Date: 2026-05-13
Scope: Node Inspector readonly identity metadata and raw JSON view toggle

## 1. Context

当前 Node Inspector 的“节点标识”只读字段只展示 `displayId`，无法同时看到节点的稳定 `uuid`。当用户需要核对运行时显示编号、定位持久化节点身份，或排查 subtree / override 相关问题时，还需要再去 JSON 文本或源码里找 `uuid`。

另外，Inspector 当前只在未知 nodeDef 时才展示只读原始节点 JSON。已知节点虽然有完整结构化表单，但当用户想快速核对真实持久化字段时，没有统一入口切换到原始 JSON 视图。

## 2. Goals

- 在 Node Inspector 的“节点标识”位置同时展示 `displayId` 和 `uuid`。
- 给 `sidebar` 模式下的节点 Inspector 提供统一的 `JSON` 视图切换入口。
- 未知节点仍保留现有的 raw JSON fallback 行为，但已知节点也能主动切换到相同的只读 JSON 视图。
- raw JSON 视图可直接选中与复制。

## 3. Non-Goals

- 不提供在 raw JSON 视图中直接编辑节点 JSON 的能力。
- 不改变节点更新、override、保存、selection 或 subtree 打开语义。
- 不修改 graph 上显示的节点编号来源；显示编号仍以 `displayId` 为准。
- 不为 Tree Inspector 增加同类 JSON 切换能力。

## 4. Current Behavior

- Node Inspector 的 `id` 字段只读，值来自 `selectedNode.ref.displayId`。
- `selectedNode.data.uuid` 虽然存在于 snapshot 中，但 UI 不展示。
- `rawNodeJson` 已经由 `createNodeInspectorFormValues()` 生成，但只有 `nodeDef === null` 时才显示。
- raw JSON 当前用 disabled `TextArea` 展示，不适合复制内容。

## 5. Proposed Behavior

- `sidebar` 模式下的 Inspector view title 增加一个 `JSON` 工具按钮。
- 默认情况下，已知节点显示结构化表单；点击 `JSON` 后切换为只读 raw node JSON 视图。
- 未知节点默认进入 raw JSON 视图，但仍复用同一个切换按钮，允许回到普通元信息视图。
- “节点标识”改成一个只读 identity 块：
  - 主展示 `displayId`
  - 次展示 `uuid`
  - `displayId` 使用更醒目的主值样式
  - `uuid` 使用较紧凑、可换行的等宽样式
- raw JSON 视图展示 `selectedNode.data` 的序列化结果，并允许选中复制。

## 6. Design

- 保持 Node Inspector 的 mutation/commit 流程不变；JSON 视图只是现有 form values 的另一种只读投影。
- `displayId` 仍从 `selectedNode.ref.displayId` 读取；`uuid` 从 `selectedNode.data.uuid` 读取。
- JSON 视图切换状态由 Node Inspector feature-local UI state 持有，只通过 sidebar host message 做一次性切换，不进入文档真源。
- 当选中节点没有 nodeDef 时，Inspector 自动启用 JSON 视图，保证未知节点仍有完整 fallback。
- JSON 视图使用 `readOnly` 而不是 `disabled` 控件，避免用户无法复制内容。

## 7. Implementation Plan

1. 新增本 work-item spec，并同步 Inspector 基线 spec 与验收场景。
2. 调整 Node Inspector 元信息区域，把 `id` 改成 `displayId + uuid` 的只读展示。
3. 在 sidebar Inspector title toolbar 增加 `JSON` 切换按钮，并在表单区切换结构化区域 / raw JSON 视图。
4. 补共享测试，覆盖 form value 中 raw JSON 生成与 identity 相关规则。
5. 运行共享测试和 TypeScript 检查。

## 8. Testing Plan

自动检查：

- 运行 `npm run test:shared`
- 运行 `npm run check`

手动回归：

1. 选中一个普通节点，确认“节点标识”同时显示 `ID` 与 `UUID`。
2. 点击 sidebar 顶部 `JSON` 按钮，确认结构化参数区切到只读 JSON 视图。
3. 再次点击 sidebar 顶部 `JSON` 按钮，确认返回结构化视图。
4. 选中未知 nodeDef 节点，确认默认显示 raw JSON。
5. 在 embedded 与 sidebar Inspector 中分别检查按钮与布局都可用。

## 9. Acceptance Criteria

- Node Inspector 的 identity 区同时显示 `displayId` 与 `uuid`。
- 已知节点可通过 sidebar 顶部 `JSON` 按钮切到 raw node JSON 只读视图。
- 未知节点默认显示 raw node JSON 视图。
- raw node JSON 内容可选中复制。
- `npm run test:shared` 与 `npm run check` 通过。

## 10. Risks And Rollback

主要风险是 Node Inspector 在较窄宽度下显示长 `uuid` 时可能出现布局拥挤，因此需要使用可换行的只读块样式而不是单行输入框。

若需要回滚，可以移除 JSON 切换按钮与 identity block，恢复单一 `id` 输入框和仅未知节点可见的 raw JSON fallback；不涉及协议或持久化回滚。
