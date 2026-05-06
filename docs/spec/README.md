# Spec README

## 目的

`docs/spec` 是当前仓库的 SDD 入口目录，同时承载两类内容：

- 长期有效的基线 spec
- 面向具体任务的 work-item spec

最重要的判断规则：

- 编号文件 = 基线 spec
- 非编号 kebab-case 文件 = work-item spec

如果你只是想知道“这次改动的 spec 应该放哪”：

- 改长期规则，更新对应编号文件
- 做具体任务，新建或更新 `docs/spec/<slug>.md`

一句话规则：

- 先改 spec
- 再改 contracts / adapter / controller
- 最后做实现与回归

更完整的流程请看 [../spec-driven-development.md](../spec-driven-development.md)。

## Source of Truth

若发生冲突，优先级如下：

1. 对应 work-item spec
2. 相关基线 spec
3. [`contracts.ts`](/Users/codetypess/Desktop/Github/vscode-behavior3/webview/shared/contracts.ts)
4. 当前运行时代码

## 目录约定

### 1. 基线 spec

编号文件是长期基线，用于记录当前系统的稳定边界、模型和语义：

- `01-product-scope.md`
- `02-acceptance-scenarios.md`
- `10-architecture.md`
- `11-document-model.md`
- `12-runtime-and-commands.md`
- `13-host-protocol.md`
- `14-resolved-graph.md`
- `15-graph-contract.md`
- `16-inspector-contract.md`
- `17-editor-semantics.md`
- `90-implementation-plan.md`

### 2. Work-item spec

非编号、kebab-case 文件用于承载具体任务的 SDD，例如：

- `sidebar-host-single-source.md`
- `save-lifecycle-regression.md`

每个 work-item spec 应包含状态行，例如：

```md
Status: Draft
Date: 2026-05-06
Scope: <short boundary>
```

一句话理解：

- 基线 spec 回答“系统长期应该是什么样”
- work-item spec 回答“这次具体准备改什么、怎么改、怎么验收”

## 基线 spec 阅读顺序

### 1. 范围与验收

- `01-product-scope.md`
  - 目标、技术路线、非目标、完成标准
- `02-acceptance-scenarios.md`
  - 当前版本必须满足的行为基线与回归场景

### 2. 设计与契约

- `10-architecture.md`
  - 分层、职责边界、关键事件流、推荐目录结构
- `11-document-model.md`
  - persisted tree、resolved graph、override、history/save 模型
- `12-runtime-and-commands.md`
  - store 归属、command catalog、稳定内部接口、宿主消息映射
- `13-host-protocol.md`
  - host wire protocol、normalized DTO、路径与跨层对象语义
- `14-resolved-graph.md`
  - 从文档树到 resolved graph 的解析规则与 identity 生成规则
- `15-graph-contract.md`
  - 图层输入输出、geometry、selection/search/highlight/drop 契约
- `16-inspector-contract.md`
  - Inspector 结构、提交节奏、override 交互、变量高亮契约
- `17-editor-semantics.md`
  - command 语义、图刷新、selection/search/highlight、宿主往返流程

### 3. 实施与回归

- `90-implementation-plan.md`
  - 从文档落到实现的阶段顺序、约束和最低交付路径

## SDD 工作流

开始一项非 trivial 改动时，默认按以下顺序推进：

1. 先读 [../spec-driven-development.md](../spec-driven-development.md)。
2. 如果这是修 bug，先确认根因，再开始修，不接受“先乱试几个补丁看看”的默认路径。
3. 在本目录中确定会影响哪些基线 spec。
4. 创建或更新对应的 work-item spec。
5. 先固定行为、边界、契约与测试计划，再进入实现。
6. 如果最终行为成为新的长期规则，同步更新对应的基线 spec。

如果实现过程中无法指出“这次改动对应哪份 work-item spec”，通常意味着这次改动还没有进入 SDD 模式。

## 新任务怎么落

推荐最小步骤：

1. 先看 [../spec-driven-development.md](../spec-driven-development.md)
2. 如果是 bug，先写清楚根因或当前确认到的根因假设
3. 在本目录新建 `docs/spec/<slug>.md`
4. 在 `Active Work Items` 下面补一条索引
5. 如果改动影响长期边界，再同步更新对应编号文件

## 变更路由

以下改动通常必须先更新 work-item spec，再开始编码：

- 新功能
- 用户可观察行为变化
- 架构边界变化
- store / command / adapter 职责变化
- host message、DTO、路径规则变化
- persisted tree、override、history/save 语义变化
- 影响回归预期的测试变化

以下改动可以不单独建 work-item spec，但如果范围扩大，需要立即补上：

- 纯视觉微调
- 文案修正
- 不改变语义的重命名
- 局部机械性整理

## Active Work Items

当前暂无登记中的 active work-item spec。

新增 work-item 时，请在这里补一条，格式建议：

- `your-work-item-slug.md` - `Draft` - 一句话范围说明

## Done Work Items

当前暂无登记中的 done work-item spec。
