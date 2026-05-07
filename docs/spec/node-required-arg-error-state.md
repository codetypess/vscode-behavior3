# Node Required Arg Error State

Status: Verifying
Date: 2026-05-07
Scope: graph validation and node inspector required-arg parity

## 1. Context

当前 Node Inspector 会对结构化参数做必填校验，空值会在侧栏表单中显示红色错误。

但图节点是否进入 `Error` 风格，依赖的是 `buildResolvedGraphModel()` 里基于 `collectResolvedNodeDiagnostics()` 的共享诊断结果。现有共享诊断只覆盖：

- 缺失 nodeDef
- group 未启用
- 输入/输出变量非法
- 表达式引用或语法非法
- 必填 input/output 缺失

因此当节点参数本身是必填项但值为空时，Inspector 会报错，图节点却仍保持普通 `Action` / `Condition` 等类型颜色，导致同一节点在侧栏与画布上的有效性表达不一致。

根因：

- “参数必填是否合法”只存在于 Inspector 表单规则里，没有进入 graph/shared validation 诊断链路。

## 2. Goals

- 当节点结构化参数缺失必填值时，图节点进入 `Error` 风格。
- 让 graph 的错误态和 Inspector 的必填参数规则保持一致。
- 保持现有输入/输出、表达式、自定义 checker 的错误态逻辑不变。

## 3. Non-Goals

- 不重构整套节点参数校验模型。
- 不在这次变更里统一所有类型校验文案。
- 不改动 host mutation、保存或 build protocol。

## 4. Current Behavior

- Inspector 中必填参数为空时，字段会显示错误提示。
- `collectResolvedNodeDiagnostics()` 不会为“必填 arg 为空”产出诊断。
- `buildResolvedGraphModel()` 仅依据共享诊断和自定义 checker 诊断决定节点是否进入 `Error` 风格。
- 结果是：参数必填未填时，节点仍可能显示为普通类型颜色。

## 5. Proposed Behavior

- 共享节点诊断补充“必填 arg 缺失”诊断。
- 图节点在收到该诊断时进入 `Error` 风格。
- Inspector 继续沿用现有字段错误提示；不把非法值静默视为合法。

## 6. Design

- 在 `tree-validation.ts` 中新增参数级必填诊断类型，并在 `collectResolvedNodeDiagnostics()` 中遍历 nodeDef args 做检查。
- “空值”判断与 Inspector 现有规则保持一致：
  - `undefined` / `null` / `""` / `"__unset__"` 视为空
  - 空数组视为空
  - 必填 `bool` 不因为 `false` 被视为空
- `graph-selectors.ts` 无需改判定结构，只要共享诊断数量大于 0 即继续映射为 `Error`。

## 7. Implementation Plan

1. 建立 work-item spec 并确认根因。
   Exit Criteria: 这次修复为什么发生、要改到哪一层、如何验收都已写清楚。
2. 扩展共享节点诊断，覆盖必填参数缺失。
   Exit Criteria: `collectResolvedNodeDiagnostics()` 对必填 arg 空值返回诊断。
3. 增加共享测试覆盖 graph 错误态映射。
   Exit Criteria: 共享测试能证明 graph model 节点会进入 `Error`。
4. 同步基线 spec 与验证。
   Exit Criteria: work-item 与长期规则一致，相关检查通过。

## 8. Testing Plan

- 为 `collectResolvedNodeDiagnostics()` 增加“必填 arg 缺失”测试。
- 为 `buildResolvedGraphModel()` 增加“必填 arg 缺失节点进入 Error”测试。
- 运行 `npm test`。
- 运行 `npm run check`。

## 9. Acceptance Criteria

- 节点存在必填结构化参数且当前值为空时，`collectResolvedNodeDiagnostics()` 会返回参数缺失诊断。
- `buildResolvedGraphModel()` 会把该节点映射为 `nodeStyleKind = "Error"`。
- 必填 `bool` 参数取值 `false` 时，不会被误判为缺失。
- 现有输入/输出必填、自定义 checker、表达式校验测试不回归。

## 10. Risks and Rollback

风险：

- 若“空值”判断与 Inspector 不一致，可能出现 graph 红态与表单错误态再次漂移。
- 若把 `false`、`0` 这类合法值误判为空，会引入新的假阳性。

缓解：

- 复用与 Inspector 相同的空值语义。
- 用测试覆盖 `false` 与普通字符串缺失场景。

回滚：

- 如出现不可接受的误报，可回滚本次共享参数诊断扩展，恢复到仅由现有输入/输出与 checker 驱动图错误态。
