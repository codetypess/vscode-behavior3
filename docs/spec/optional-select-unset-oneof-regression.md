# Optional Select Unset Oneof Regression

Status: Done
Date: 2026-05-27
Scope: inspector structured args

## 1. Context

Node Inspector 当前会把部分可选枚举参数的“未设置”状态编码成内部哨兵值 `__unset__`。

这会带来两个用户可见问题：

- 可选 `Select` 参数未填写时，Inspector 直接显示内部字符串，而不是空选中态
- `oneof` 校验读取了原始表单值，误把 `__unset__` 当成真实输入，从而对“实际未填写”的参数报冲突

## 2. Goals

- 可选且带 `options` 的参数在没有 committed 值时显示为空状态
- `oneof` 校验与提交序列化使用同一套“解析后值”语义
- 保持现有 required/unset/default-arg 语义不变

## 3. Non-Goals

- 不重做 Inspector 控件体系
- 不改变 `oneof` 规则本身
- 不修改主文档持久化格式

## 4. Current Behavior

- required arg 已经能保持 unset，而不会被静默写成空字符串或 `false`
- optional `Select` arg 会在 form 初始值里带入 `__unset__`
- Inspector 局部 `oneof` 校验没有统一走解析后的 arg 值

## 5. Proposed Behavior

- optional `Select` arg 若当前没有 committed/effective 值，Inspector 应显示为空选中态
- Inspector 中的 `oneof` 校验应基于 `parseArgSubmitValue()` 的结果执行
- 即使旧状态里仍出现 `__unset__`，解析后也应按未设置处理

## 6. Design

- 去掉 optional scalar options arg 初始值对 `__unset__` 的依赖
- 让 Inspector field validator 对 arg 统一先做 `parseArgSubmitValue()`
- 保留 `parseArgSubmitValue()` 对 `__unset__` 的兼容解析，避免旧状态或边缘路径触发错误

## 7. Implementation Plan

1. 更新 work-item 与相关基线 spec
2. 修改 Inspector arg 初始值与 field validation 逻辑
3. 增加共享回归测试覆盖 optional options unset 与 oneof 场景

## 8. Testing Plan

- 共享测试覆盖 optional options arg 的初始值
- 共享测试覆盖 `__unset__` 经解析后不触发 `oneof` 冲突
- 运行 `npm run check`
- 运行 `npm run test:shared`

## 9. Acceptance Criteria

- optional `Select` arg 未填写时，Inspector 不显示 `__unset__`
- 当相关 input 已填写、optional `Select` arg 未填写时，Inspector 不产生伪 `oneof` 冲突
- `npm run check` 通过
- `npm run test:shared` 通过

## 10. Risks and Rollback

- 风险：统一使用解析后值可能影响少数局部校验分支
- 缓解：保留现有 shared parser，并用共享测试覆盖 required/optional/options/oneof 路径
- 回滚：恢复 optional options arg 的旧初始值逻辑，并撤回本次 Inspector validator 变更
