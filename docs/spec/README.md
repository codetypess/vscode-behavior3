# Spec Index

## 目的

`docs/spec` 是当前仓库的 Specification-Driven Development 入口目录，承载两类文档：

- 编号文件：长期有效的基线 spec
- 非编号 kebab-case 文件：面向具体任务的 work-item spec

最重要的判断规则：

- 编号文件回答“系统长期应该是什么样”
- 非编号文件回答“这次具体准备改什么、怎么改、怎么验收”

一句话工作流：

- 先更新 spec
- 再收敛 `contracts` / `adapter` / `controller` 边界
- 最后进入实现、验证与回归

更完整的流程见 [../spec-driven-development.md](../spec-driven-development.md)。

## 当前目录快照

当前 `docs/spec` 包含：

- 11 份编号基线 spec
- 3 份 work-item spec
- 0 份登记中的 active work-item spec
- 3 份登记中的 done work-item spec
- 1 份长期保留的实施顺序文档：[`90-implementation-plan.md`](90-implementation-plan.md)

目录判断规则：

- `01` / `02`：产品范围与验收基线
- `10` 到 `17`：架构、模型、协议、图层与编辑语义
- `90`：实施阶段、顺序和强约束
- 其他非编号文件：具体任务的 SDD work item

## Source of Truth

若发生冲突，默认按以下顺序判断：

1. 对应 work-item spec
2. 相关基线 spec
3. [`contracts.ts`](../../webview/shared/contracts.ts)
4. 当前运行时代码

如果 `contracts.ts` 或运行时代码与 spec 不一致，不要默默以代码为准；应在本目录中补齐或修正 spec。

## 按问题找文档

| 你想确认什么 | 优先阅读 |
| --- | --- |
| 这个编辑器当前要解决什么问题，哪些不做 | [`01-product-scope.md`](01-product-scope.md) |
| 当前必须守住哪些回归场景 | [`02-acceptance-scenarios.md`](02-acceptance-scenarios.md) |
| 模块分层、职责边界、关键事件流 | [`10-architecture.md`](10-architecture.md) |
| persisted tree、resolved graph、override、history/save 语义 | [`11-document-model.md`](11-document-model.md), [`17-editor-semantics.md`](17-editor-semantics.md) |
| store 归属、command catalog、内部稳定接口 | [`12-runtime-and-commands.md`](12-runtime-and-commands.md) |
| host message、DTO、路径与跨层对象语义 | [`13-host-protocol.md`](13-host-protocol.md) |
| subtree 解析、identity、display id、selection restore | [`14-resolved-graph.md`](14-resolved-graph.md) |
| 图层输入输出、layout、selection/search/highlight/drop 契约 | [`15-graph-contract.md`](15-graph-contract.md) |
| Inspector 布局、提交节奏、override 与变量高亮 | [`16-inspector-contract.md`](16-inspector-contract.md) |
| command 行为、图刷新、宿主往返、保存/构建语义 | [`17-editor-semantics.md`](17-editor-semantics.md) |
| 当前实现应按什么阶段落地 | [`90-implementation-plan.md`](90-implementation-plan.md) |

## 基线 spec 地图

### 1. 范围与回归

| 文件 | 主要回答的问题 |
| --- | --- |
| [`01-product-scope.md`](01-product-scope.md) | 产品目标、固定技术路线、非目标、完成标准是什么 |
| [`02-acceptance-scenarios.md`](02-acceptance-scenarios.md) | 当前版本至少需要通过哪些黑盒行为场景 |

### 2. 边界、模型与协议

| 文件 | 主要回答的问题 |
| --- | --- |
| [`10-architecture.md`](10-architecture.md) | 组件、controller、stores、adapter 的职责怎么切分 |
| [`11-document-model.md`](11-document-model.md) | 哪些数据是可写真源，哪些只是派生结果 |
| [`12-runtime-and-commands.md`](12-runtime-and-commands.md) | 每种状态归谁管，所有动作应该走哪些 command |
| [`13-host-protocol.md`](13-host-protocol.md) | webview 和 host 如何通信，进入内部前怎么归一化 |

### 3. 图层、Inspector 与编辑语义

| 文件 | 主要回答的问题 |
| --- | --- |
| [`14-resolved-graph.md`](14-resolved-graph.md) | persisted tree 如何解析成 resolved graph，实例 id 怎么生成 |
| [`15-graph-contract.md`](15-graph-contract.md) | 图层应该接收什么、输出什么、哪些交互归图层负责 |
| [`16-inspector-contract.md`](16-inspector-contract.md) | Inspector 应该长什么样、按什么节奏提交、override 怎样表达 |
| [`17-editor-semantics.md`](17-editor-semantics.md) | 每个编辑命令、图刷新和宿主同步的行为语义是什么 |

### 4. 实施顺序

| 文件 | 主要回答的问题 |
| --- | --- |
| [`90-implementation-plan.md`](90-implementation-plan.md) | 这套基线从 spec 落到实现时，应该按什么顺序推进 |

## 推荐阅读路径

### 初次进入这套 spec

推荐顺序：

1. [`01-product-scope.md`](01-product-scope.md)
2. [`02-acceptance-scenarios.md`](02-acceptance-scenarios.md)
3. [`10-architecture.md`](10-architecture.md)
4. 按关注点继续深入：
   - 数据与保存语义：[`11-document-model.md`](11-document-model.md), [`12-runtime-and-commands.md`](12-runtime-and-commands.md)
   - 宿主与协议：[`13-host-protocol.md`](13-host-protocol.md)
   - 图层与 Inspector：[`14-resolved-graph.md`](14-resolved-graph.md), [`15-graph-contract.md`](15-graph-contract.md), [`16-inspector-contract.md`](16-inspector-contract.md), [`17-editor-semantics.md`](17-editor-semantics.md)
5. 需要了解实施阶段时再读 [`90-implementation-plan.md`](90-implementation-plan.md)

### 修 bug

推荐顺序：

1. 先确认根因，至少写清楚当前确认到的根因假设
2. 对照 [`02-acceptance-scenarios.md`](02-acceptance-scenarios.md) 找到受影响的回归场景
3. 再读对应边界文档，例如：
   - 保存 / dirty / undo / reload：[`11-document-model.md`](11-document-model.md), [`17-editor-semantics.md`](17-editor-semantics.md)
   - host message / 路径 / subtree 文件：[`13-host-protocol.md`](13-host-protocol.md)
   - graph selection / highlight / drop：[`15-graph-contract.md`](15-graph-contract.md), [`17-editor-semantics.md`](17-editor-semantics.md)
4. 创建或更新 work-item spec

### 做非 trivial 改动

默认顺序：

1. 阅读 [../spec-driven-development.md](../spec-driven-development.md)
2. 在本目录中找出会受影响的基线 spec
3. 新建或更新 `docs/spec/<slug>.md`
4. 先固定行为、边界、契约与测试计划
5. 实现完成后，如果结果成为新的长期规则，同步更新对应编号文件

## Work-Item Spec 约定

### 路径与命名

- work-item spec 直接放在 `docs/spec/<slug>.md`
- `slug` 使用小写 kebab-case
- 编号前缀保留给基线 spec，不要给 work-item 加编号

例如：

- `docs/spec/sidebar-host-single-source.md`
- `docs/spec/save-lifecycle-regression.md`

### 最小头部

每个 work-item spec 至少包含状态行，例如：

```md
# <Work Item Name>

Status: Draft
Date: YYYY-MM-DD
Scope: <short boundary>
```

完整模板和章节要求见 [../spec-driven-development.md](../spec-driven-development.md)。

对于非 trivial 任务，默认应覆盖这些章节：

- Context
- Goals
- Non-Goals
- Current Behavior
- Proposed Behavior
- Design
- Implementation Plan
- Testing Plan
- Acceptance Criteria
- Risks and Rollback

### Status 流转

- `Draft`：问题、范围和方案仍在收敛
- `Approved`：方案已明确，可以进入实现
- `Implementing`：实现进行中
- `Verifying`：实现完成，正在做验证与回归
- `Done`：验收完成
- `Superseded`：已被新的 work item 替代

## 什么时候必须建 Work-Item

以下改动通常必须先更新 work-item spec，再开始大规模编码：

- 新功能
- 用户可观察行为变化
- 架构边界变化
- `store` / `command` / `adapter` 职责变化
- host message、DTO、路径规则变化
- persisted tree、resolved graph、override、history/save 语义变化
- 影响回归预期的测试变化

以下改动可以先不单独建 work-item，但如果范围扩大，需要立即补上：

- 纯视觉微调
- 文案修正
- 不改变语义的重命名
- 局部机械性整理

## 什么时候同步更新基线 Spec

当 work item 不只是“临时说明”，而是已经形成新的长期规则时，同步更新对应编号文件。常见信号：

- 验收场景本身变了
- command、store、adapter 的边界变了
- DTO、路径、解析规则或 identity 语义变了
- 图层 / Inspector / 保存语义成为新的默认行为

## Active Work Items

当前没有登记中的 active work-item spec。

新增 work-item 时，请继续按以下格式补充：

- `your-work-item-slug.md` - `Draft` - 一句话范围说明

## Done Work Items

- `baseline-spec-sync-current-code.md` - `Done` - 按当前实现回写编号基线 spec
- `host-selection-authority.md` - `Done` - 将 tree/node selection authority 收口到 extension-host selection intent 与 host snapshot fanout
- `sidebar-host-single-source.md` - `Done` - 将主文档 authority 收口到 extension-host document/session 与统一 snapshot fanout
