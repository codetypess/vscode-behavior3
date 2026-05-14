# Node Name Commit Granularity

Status: Verifying
Date: 2026-05-14
Scope: 收窄 Node Inspector `name` 字段提交粒度，避免把 `unknown` 节点改名时顺带写入输入槽与参数值。

## 1. Context

用户在 Node Inspector 中把一个节点的名称文本粘贴到 `unknown` 节点的 `name` 字段时，当前实现会在提交 `name` 的同时，把 `input`、`output` 和 `args` 也一起构造成 `updateNode` payload。

这使得“只是改名字”变成了“改名字并顺带生成字段值”。对用户而言，这是非预期的扩写。

另外，Node Inspector 当前在切换节点时复用同一个 Ant Design `form` 实例，并直接 `setFieldsValue(...)`。对于 `args` 这类嵌套对象，旧节点留下的表单值可能继续残留到新节点，导致 `unknown` 节点在改名前后看起来带着上一个节点的参数值。

## 2. Goals

- `name` 字段提交时只提交 `name`。
- 把 `unknown` 节点改名为已知 nodeDef 时，不自动生成 `input`、`output` 或 `args` 值。
- 切换到新节点时，Node Inspector 清空上一节点留下的 `args`、`inputSlots`、`outputSlots` 等表单状态。
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

根因有两个：

- `name` 字段的 commit 粒度过大，超出了“只改当前字段”的边界。
- 节点切换时的表单重建不彻底，导致旧节点嵌套字段残留。

## 5. Proposed Behavior

- `commitName()` 只校验 `name` 字段。
- `commitName()` 只发送 `name` 变更，其余字段保持当前 committed 数据原样不动。
- 切换节点时先清空当前 form store，再写入新节点的初始化值。
- 其他字段仍由各自的 commit handler 独立负责。

## 6. Design

- 提取一个纯 helper，用于构造“仅名称变更”的节点 payload。
- `useNodeInspectorCommitters()` 的 `commitName()` 改用该 helper。
- 移除 `commitName()` 对 `inputSlots`、`outputSlots`、`args` 的联动校验与构造。
- `NodeInspectorForm` 在 `selectedNode` 变化时先 `resetFields()`，避免 `args` 等嵌套值被 `setFieldsValue` 合并残留。
- 增加共享测试，覆盖 `unknown` 节点改名后不生成参数的回归场景。
- 增加共享测试，覆盖 `unknown` 节点的初始化 form values 为空参数/空槽位。

## 7. Implementation Plan

1. 新建本 work-item spec，并同步 baseline spec 的提交粒度规则。
2. 收窄 `commitName()` 提交内容。
3. 切换节点时清空 form store 后再写入新节点值。
4. 增加共享测试。
5. 运行 `npm run test:shared` 与 `npm run check`。

## 8. Testing Plan

自动检查：

- 运行 `npm run test:shared`。
- 运行 `npm run check`。

手动回归：

1. 选中一个 `unknown` 节点。
2. 在 `name` 字段粘贴已知节点名称。
3. 提交后确认只发生名称变化，不自动带入参数值。
4. 从带 `args.time = 1` 的 `Wait` 节点切到 `unknown` 节点，确认 Inspector 不残留 `time = 1`。

## 9. Acceptance Criteria

- `name` 字段提交只影响 `name`。
- `unknown` 节点改名后，不会因为本次提交自动生成 `input`、`output` 或 `args`。
- 切换到 `unknown` 或其他不兼容节点时，上一节点的 `args` / `input` / `output` 表单值不会残留显示。
- `npm run test:shared` 通过。
- `npm run check` 通过。

## 10. Risks and Rollback

风险：切换到不同 nodeDef 后，旧的 `input` / `output` / `args` 可能继续保留，直到用户显式修改这些字段。

这是本次有意接受的行为，因为目标就是“改哪就是哪”。

回滚方式：恢复 `commitName()` 的联动构造逻辑，但这会重新引入本次用户反馈的意外扩写问题。
