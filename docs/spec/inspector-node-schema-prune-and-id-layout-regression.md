# Inspector Node Schema Prune And Id Layout Regression

Status: Done
Date: 2026-05-30
Scope: inspector node update semantics / identity layout

## 1. Context

Node Inspector 当前在节点发生更新时，会沿用旧节点的 committed `args` / `input` / `output` 基线。即使 Inspector 已经按当前 `nodeDef` 只展示有效字段，只要一次提交没有主动清理 schema 外旧字段，它们仍会留在节点数据里。

这会带来两个用户可见问题：

- 新 `nodeDef` 未声明的旧参数或槽位不会被清理，节点卡片和原始 JSON 里会残留无效数据
- identity 区的显示 ID 仍依赖字符数定宽，窄位数和长位数切换时宽度不够稳定

## 2. Goals

- 当节点发生 `updateNode` 提交时，自动裁剪所有已不在当前目标 `nodeDef` schema 中声明的 committed `args` / `input` / `output`
- 保持 `name` 提交不会静默合成新 schema 下原本不存在的默认字段
- identity 区的 display ID 宽度按内容自适应，而不是靠内联定宽计算

## 3. Non-Goals

- 不重做 Node Inspector 的整体布局
- 不改变 persisted tree 的字段结构
- 不在 rename 提交里主动补全新 `nodeDef` 的默认参数或新增空槽位

## 4. Current Behavior

- 各类 Inspector 节点提交都会从当前 committed 节点数据出发构造 payload
- 本地表单预览虽然会清空旧 schema 的结构化字段缓存，但 committed 数据中的旧 key 仍保留
- identity 区的 display ID 输入框使用字符数推导出来的内联宽度，属于定宽策略

## 5. Proposed Behavior

- `updateNode` intent 仍以当前 committed 数据为基线，但 host reducer 和 Inspector helper 都会按目标 `nodeDef` 裁剪掉未声明的 arg key 与越界 slot 数据
- 若目标 `nodeDef` 没有 `args` / `input` / `output`，对应 committed 字段应被移除
- 若目标 `nodeDef` 仍声明对应字段，则仅保留目标 schema 可表达的数据，不创建新值
- identity 区 display ID 使用内容自适应宽度，uuid 字段继续占据剩余可用空间

## 6. Design

- 在 Inspector form helper 中新增基于目标 `nodeDef` 的 committed 数据裁剪逻辑，供 rename path 复用
- 在 host `updateNode` reducer 中增加基于目标 `nodeDef` 的权威裁剪，保证所有节点更新路径都会清理旧 schema 字段
- args 仅保留目标 `nodeDef.args` 中声明的 key
- input/output 按目标 slot schema 重新归一化，只保留目标 schema 可表示的索引范围与 variadic 尾段
- identity 区移除 display ID 的内联宽度计算，改由 CSS intrinsic sizing 控制显示宽度

## 7. Implementation Plan

1. 新增 work-item spec，并同步 Node Inspector 基线规则
2. 调整 Inspector helper 与 host reducer，按目标 `nodeDef` 裁剪 committed `args` / `input` / `output`
3. 调整 identity 区样式，移除 display ID 定宽策略
4. 增加 Inspector shared tests 覆盖 rename 裁剪回归，并运行构建验证

## 8. Testing Plan

- Inspector shared tests 覆盖 rename 到新 `nodeDef` 后旧 args/slots 被裁剪
- Document reducer shared tests 覆盖普通节点更新时旧 args 被裁剪
- 运行 `npm run test:shared`
- 运行 `npm run build`

## 9. Acceptance Criteria

- 节点更新后，当前 `nodeDef` 不再声明的旧 arg 不再保留
- 节点更新后，更短 slot schema 之外的 committed slot 数据被移除
- rename 不会因为新 schema 预览而写入新的默认 arg 或空槽位
- Node Inspector identity 区的 display ID 不再依赖字符数定宽内联样式
- `npm run test:shared` 通过
- `npm run build` 通过

## 10. Risks and Rollback

- 风险：过度裁剪可能误删目标 schema 仍可复用的 slot 数据
- 缓解：复用现有 slot 归一化 helper，并用 shared tests 覆盖普通 slot 与 variadic 行为
- 回滚：恢复 rename helper 的旧基线，并撤回 identity 区自适应宽度样式
