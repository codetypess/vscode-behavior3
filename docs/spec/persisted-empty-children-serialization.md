# Persisted Empty Children Serialization

Status: Done
Date: 2026-05-07
Scope: persisted tree serialization and save normalization

## 1. Context

当前编辑器内部会把节点 `children` 统一规范成数组，叶子节点通常表现为 `children: []`。

用户当前看到的问题是：

- 节点已经没有任何内联子节点
- 保存主文档或 subtree 后，JSON 里仍会写出空的 `children: []`

根因：

- 通用持久化序列化复用了 `createNode()`
- `createNode()` 目前只判断 `data.children` 是否 truthy
- 空数组 `[]` 也会命中这个分支，因此被重新写回磁盘

## 2. Goals

- 当节点没有任何内联子节点时，序列化结果省略 `children`
- 让主文档保存、subtree 保存和通用 persisted tree 序列化保持一致
- 保持已有 subtree link 不内联 `children` 的规则不变

## 3. Non-Goals

- 不改变运行时内部把 `children` 规范成数组的解析模型
- 不改变 Inspector 中 `children` 只读展示或 nodeDef children 校验
- 不重构保存协议或 build 流程

## 4. Current Behavior

- 解析后的 persisted node 在运行时通常带有数组形式的 `children`
- 主文档保存最终会走通用 persisted tree 序列化
- 普通叶子节点若内部是 `children: []`，当前会被原样写回 JSON
- build 输出路径已经只在存在实际子节点时才写入 `children`

## 5. Proposed Behavior

- persisted tree 写回磁盘时，仅当节点存在至少一个内联子节点时才输出 `children`
- 没有子节点的普通叶子节点不再写出空 `children: []`
- subtree link 仍继续省略内联 `children`
- 解析后的内存模型仍可继续把缺失 `children` 规范成空数组供运行时消费

## 6. Design

- 复用现有 `createNode()` 作为 persisted tree 的统一写回入口
- 将 `createNode()` 的 children 输出条件从“数组存在”收紧为“数组非空”
- 不新增新的 save-time 特判，避免主文档保存与 subtree 保存再次分叉
- 共享测试直接断言 JSON 输出字段是否存在，避免只验证解析后的内存形态

## 7. Implementation Plan

1. 新建 work-item spec 并记录当前根因与边界。
   Exit Criteria: 为什么会写出空 `children` 已明确。
2. 调整 persisted node 通用序列化条件。
   Exit Criteria: 叶子节点不会再因为空数组而写出 `children`。
3. 补充共享测试覆盖普通序列化与主文档保存路径。
   Exit Criteria: 两条路径都对空 `children` 有回归保护。
4. 更新基线 spec。
   Exit Criteria: 文档规范化与黑盒保存语义反映新规则。

## 8. Testing Plan

- 增加 persisted tree 序列化测试，验证普通叶子节点省略空 `children`
- 保留并扩展主文档保存序列化测试，验证 display id 回写同时不会写入空 `children`
- 运行 `npm run test:shared`

## 9. Acceptance Criteria

- 普通 persisted 叶子节点写回 JSON 时不包含空 `children: []`
- 主文档保存后的叶子节点不包含空 `children: []`
- subtree link 仍不在主文档中内联 `children`
- 解析后的运行时树结构与现有编辑流程不因该序列化变化而失效

## 10. Risks and Rollback

风险：

- 依赖精确 JSON 结构的测试或样例可能需要同步更新
- 若某些旧逻辑错误依赖“空数组一定存在”，可能暴露隐藏耦合

缓解：

- 用共享测试直接覆盖 serialize/save 路径
- 保持解析层继续把缺失 `children` 归一成可遍历数组

回滚：

- 若该归一化引入兼容性回归，可先回退 `createNode()` 条件判断，再单独设计更窄的写盘规范化策略
