# Inspector Array Arg Validation

Status: Implementing
Date: 2026-05-07
Scope: inspector structured-arg validation for array-typed args

## 1. Context

当前 Inspector 支持 `int[]?`、`float[]?`、`expr[]?` 这类数组参数，文本输入会先经过 `parseArgSubmitValue()` 解析成数组。

但字段校验阶段仍然会按 `getNodeArgRawType()` 的基础类型继续执行单值整数/浮点校验，于是：

- `int[]?` 的 `[1,2]` 会被拿去做 `Number("[1,2]")`
- 然后错误地报“必须是整数”

这会让配置本身合法的数组参数在 Inspector 中无法提交。

## 2. Goals

- 让数组参数在 Inspector 中按“解析后数组逐项校验”的语义工作。
- 修复 `int[]?`、`float[]?`、`expr[]?` 等数组类型被误判成单值类型的问题。
- 保持现有 `oneof`、required、custom checker 提示节奏不变。

## 3. Non-Goals

- 不改动 node definition schema。
- 不修改 host reducer、保存或 build 校验协议。
- 不改变数组参数的 UI 形态。

## 4. Current Behavior

- `parseArgSubmitValue()` 已能把数组文本解析成 JS array。
- `NodeArgField.validateField()` 在数组解析后，仍使用原始 `value` 执行单值 `int` / `float` 校验。
- 因此合法数组会在 Inspector 里被误报。

根因：

- 校验逻辑没有把“数组类型”和“基础单值类型”分离，导致数组命中了单值数值分支。

## 5. Proposed Behavior

- Inspector 参数校验先解析提交值。
- 若参数是数组：
  - 验证解析结果必须是数组
  - 按基础类型逐项校验元素
  - `expr[]` 继续按表达式数组校验
- 若参数不是数组，沿用当前单值校验语义。

## 6. Design

- 在 `inspector-arg-values.ts` 中新增共享的 Inspector 参数校验 helper。
- `node-inspector-form.tsx` 复用该 helper，而不是直接对原始 `value` 做单值判断。
- 为 helper 增加共享测试，覆盖数组数值类型与 oneof 相关合法输入。

## 7. Implementation Plan

1. 建立 work-item spec 并记录根因。
   Exit Criteria: 为什么 `int[]?` 被误判已写清楚。
2. 新增 Inspector 参数校验 helper。
   Exit Criteria: 可独立校验单值/数组参数。
3. 接入 Node Inspector 字段校验。
   Exit Criteria: `int[]?` 等数组类型不再命中单值整数错误。
4. 增加回归测试并验证。
   Exit Criteria: 共享测试与类型检查通过。

## 8. Testing Plan

- 为 Inspector 参数 helper 增加这些测试：
  - `int[]?` 的 `[1,2]` 合法
  - `float[]?` 的 `[1,2.5]` 合法
  - `int[]?` 的 `[1,2.5]` 非法
- 运行 `npm run test:shared`
- 运行 `npm run check`

## 9. Acceptance Criteria

- `sample/node-config.b3-setting` 里的 `TestOneof.option: int[]?` 在 Inspector 中输入 `[1,2]` 不再报“必须是整数”。
- 数组参数非法元素仍会得到正确错误提示。
- `oneof`、required、custom checker 的现有行为不回归。

## 10. Risks and Rollback

风险：

- 若数组/单值空值判断不一致，可能影响 required 提示时机。
- 若 helper 与 build/shared 校验语义偏离，Inspector 可能与构建结果不一致。

缓解：

- 只修 Inspector 的类型分支，不改 shared build 校验规则。
- 用共享测试覆盖合法与非法数组数值场景。

回滚：

- 如新 helper 引入更广泛回归，可回滚到原实现，并保留本 spec 作为后续重做依据。
