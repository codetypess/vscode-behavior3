# Inspector Required Arg Unset Initial State

Status: Verifying
Date: 2026-05-07
Scope: node inspector required arg initial value and first-commit serialization

## 1. Context

当前新增节点后，把 `name` 从 `unknown` 切到某个已知 nodeDef 时，Inspector 会根据新 nodeDef 渲染结构化参数表单。

现状里，部分必填参数在“尚未由用户输入”的情况下，会先被映射成表单初始值：

- 必填 `string` / `expr` / `int` / `float` / `json` 会变成 `""`
- 必填 `bool` 会变成 `false`

随后 `commitName()` 在提交节点类型切换时，会把整组 `args` 一起带上。由于这次提交发生在新字段刚切入的时刻，payload 会把这些“仅用于表单占位的初始值”写回主文档。

结果是：

- 用户只是切换节点类型，还没填写参数
- 文档里却已经出现 `""`、`false` 这类并非用户显式输入的值

根因：

- Inspector 对“未设置”和“空字符串 / false”没有保持严格区分。
- 节点类型切换提交会序列化整组 args，而不是只保留已显式设置的值。

## 2. Goals

- 必填参数在初次进入 Inspector 时保持 `undefined`，直到用户显式输入。
- 切换节点类型时，不把未填写的必填参数静默写入文档。
- 保持已有参数值、显式输入的 `false`、`0` 等合法值不变。

## 3. Non-Goals

- 不重做 Node Inspector 布局。
- 不改变节点级必填校验与 graph `Error` 规则。
- 不把 required bool 从 `Switch` 改成新的控件类型。

## 4. Current Behavior

- `formatArgInitialValue()` 会给必填文本/数值/布尔参数注入占位初值。
- `parseArgSubmitValue()` 会把 `undefined` 的 required arg 解析成 `""` 或 `false`。
- `commitName()` 切节点类型时会把 `args` 整组一起进入 payload。
- 因此新节点在未填写参数前，就可能在文档中生成空值字段。

## 5. Proposed Behavior

- 必填 arg 若当前没有 committed 值，Inspector 表单初值保持 `undefined`。
- 提交时，required arg 若当前仍是 `undefined` / `null`，则继续保持 `undefined`，不进入 payload。
- 只有用户显式输入后的值，才会写入文档。

## 6. Design

- 将 Inspector arg 初始值/提交值的纯逻辑收口到独立 helper，避免被 React/antd 生命周期耦合。
- `formatArgInitialValue()` 规则：
  - required arg 且无 committed value -> `undefined`
  - optional arg 保持现有 unset sentinel 语义
- `parseArgSubmitValue()` 规则：
  - `raw === undefined || raw === null` -> `undefined`
  - 显式 `false` / `0` / 已选择 option 继续按原语义保留
- required bool 的“缺失”继续视为非法，但不再在首次切类型时被静默落成 `false`

## 7. Implementation Plan

1. 新增 work-item spec。
   Exit Criteria: 问题、根因与目标已记录。
2. 收口 Inspector arg 初始值与提交值 helper。
   Exit Criteria: 必填 arg 的 unset 状态不再被自动转成 `""` / `false`。
3. 增加 shared tests。
   Exit Criteria: helper 语义对 required/optional 与 `false`/`0` 都有覆盖。
4. 同步 baseline spec 并验证。
   Exit Criteria: `npm run test:shared` 与 `npm run check` 通过。

## 8. Testing Plan

- 增加 required arg 初始值保持 `undefined` 的测试。
- 增加 required arg 提交时保留 `undefined`，以及显式 `false` / `0` 不丢失的测试。
- 运行 `npm run test:shared`。
- 运行 `npm run check`。

## 9. Acceptance Criteria

- 新建节点并切换到有必填 arg 的 nodeDef 时，未填写的 required arg 不会自动写入主文档。
- required `string` / `expr` / `int` / `float` / `json` / `bool` 在无 committed value 时初始值保持 `undefined`。
- 用户显式设置的 `false`、`0`、非空字符串、已选 option 仍会正确写入。
- 现有 optional arg 的 unset 语义不回归。

## 10. Risks and Rollback

风险：

- required bool 虽然内部保持 `undefined`，但控件视觉上仍是关闭态，可能让“未设置”和“false”看起来接近。
- 若 helper 规则改动不完整，可能影响 override reset 或已有 arg 编辑。

缓解：

- 保持 required 校验与 graph `Error` 规则不变。
- 用测试覆盖 `false`、`0`、unset 和 optional sentinel。

回滚：

- 若出现不可接受的 Inspector 提交回归，可回滚本次 helper 语义收口与基线更新。
