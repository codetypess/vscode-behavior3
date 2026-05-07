# Inspector Independent Field Commit

Status: Verifying
Date: 2026-05-07
Scope: inspector sidebar field-level commit behavior

## 1. Context

`Tree Inspector` 和 `Node Inspector` 当前都建立在 antd `Form` 上，并通过 `form.submit()` 驱动写回。

现状里每次字段编辑虽然是按 `onBlur` / `onChange` 触发，但真正进入 `onFinish` 前，antd 会先校验整张表。只要表单中任意其他字段处于错误态，本次正在提交的字段也会一起被阻断。

这让 Inspector 呈现出“整张表必须同时合法才能写入”的行为，不符合侧栏逐项编辑的使用预期。

## 2. Goals

- 让 Tree Inspector 与 Node Inspector 的可编辑项按字段或局部列表独立提交。
- 保留现有字段校验与错误展示，不把非法值静默写入主文档。
- 让某个字段的错误不会阻断无关字段的提交。
- 不改动 host mutation 协议与 reducer 语义。

## 3. Non-Goals

- 不重做 Inspector 的视觉布局。
- 不把所有文本输入改成立即逐字写入；保留现有 `onBlur` / 即时提交节奏。
- 不改动 reducer 的 noop / override / subtree 脱链语义。
- 不在这次变更里重构成完全脱离 antd `Form` 的新状态模型。

## 4. Current Behavior

- Tree / Node Inspector 的大多数控件都会触发 `form.submit()`。
- `form.submit()` 会先校验整张表，再统一调用 `onFinish`。
- 因此如果任意其他字段校验失败，当前字段即使本身合法，也不会写入。
- 这个问题对本地变量列表、import 列表、节点参数和槽位编辑都成立。

根因：

- 提交粒度是“整表 submit”，不是“当前编辑字段或局部块 submit”。

## 5. Proposed Behavior

- 文本输入仍然在 `onBlur` 提交，`Switch` / `Select` / 列表增删仍然即时排队提交。
- 但每次只校验并提交当前编辑字段，或该字段所属的最小局部提交单元。
- 某个字段若非法，只阻断它自己对应的提交，并保留错误提示。
- 其他无关字段仍可继续提交并写入主文档。

局部提交单元约定：

- Tree meta 基础字段各自独立提交。
- tree local vars 以整段 `vars` 列表为提交单元。
- tree import refs 以整段 `importRefs` 列表为提交单元。
- node 基础字段按字段提交。
- input/output slot 按单个 slot 提交；variadic slot 以该 slot 列表为提交单元。
- structured arg 按单个 arg 提交。
- 对 `oneof` 这类显式耦合校验，允许当前字段在依赖项不满足时继续报错并拒绝提交。

## 6. Design

- 保留现有 antd `Form` 作为渲染、校验和错误展示容器。
- 移除依赖整表 `onFinish` 的写回路径，改为显式的字段级提交 helper。
- helper 负责：
  - 只校验指定 `namePath`
  - 从当前 committed snapshot 构建 payload
  - 仅把当前字段对应的值覆盖到 payload
  - 调用现有 `runtime.controller.updateTreeMeta()` / `updateNode()`
- host reducer 继续接收完整 `updateTreeMeta` / `updateNode` payload，不感知前端提交粒度变化。

## 7. Implementation Plan

1. 新增 Inspector 字段级提交 helper。
   Exit Criteria: Tree / Node Inspector 可以脱离整表 `onFinish` 触发写回。
2. 将 Tree Inspector 的字段、列表增删切到局部提交。
   Exit Criteria: 某个 local var 或 import 路径报错时，`desc` / `export` 等无关字段仍可提交。
3. 将 Node Inspector 的 meta、slot、arg 提交切到局部提交。
   Exit Criteria: 某个 arg 或 slot 报错时，`desc` / `debug` / `disabled` 等无关字段仍可提交。
4. 更新基线 spec 并做类型检查 / 回归验证。

## 8. Testing Plan

- 运行 `npm run check`。
- 人工回归 Tree Inspector：
  - 制造一个非法 local var 或 import path
  - 修改 `desc` / `export`
  - 确认无关字段仍然落盘
- 人工回归 Node Inspector：
  - 制造一个非法 arg / slot
  - 修改 `desc` / `debug` / `disabled`
  - 确认无关字段仍然落盘
- 回归 subtree override reset、subtree 脱链、unknown node 只读视图。

## 9. Acceptance Criteria

- Tree Inspector 中存在非法 local var 或 import 输入时，修改 `desc`、`prefix`、`export`、`group` 仍可提交。
- Node Inspector 中存在非法 arg、slot 或 path 输入时，修改其他无关可编辑字段仍可提交。
- 非法字段不会被静默写入；UI 仍显示错误提示。
- `updateTreeMeta` / `updateNode` 现有 host reducer 语义不变。
- `npm run check` 通过。

## 10. Risks and Rollback

风险：

- 字段级提交若 payload 构造不完整，可能意外清掉未编辑字段。
- 某些跨字段约束如果提交单元切得过细，可能出现与旧行为不一致的提示时机。

缓解：

- 统一从 committed snapshot 构建 payload，只覆写当前提交字段。
- 对 `oneof` 和 variadic list 保留局部成组校验。

回滚：

- 若出现不可接受的字段同步问题，可回滚到整表 `onFinish` 提交路径，同时保留本次 spec 作为后续重做依据。
