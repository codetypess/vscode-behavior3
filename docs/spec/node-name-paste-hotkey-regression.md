# Node Name Paste Hotkey Regression

Status: Verifying
Date: 2026-05-14
Scope: 修复 Inspector 节点名称等组合输入控件聚焦时 `Ctrl/Cmd+V` 被图层结构快捷键抢占的问题。

## 1. Context

当前 Node Inspector 的 `name` 字段使用 Ant Design `AutoComplete`。在 `embedded` 模式下，Inspector 与 graph pane 运行在同一个 editor webview 内，而 graph pane 同时注册了 copy/paste/replace/insert/delete/undo/redo 结构编辑热键。

用户反馈在节点名称字段中使用 `Ctrl+V` / `Cmd+V` 粘贴时，输入没有提交且最终无效。该问题会直接影响节点类型切换、路径补全等依赖组合输入控件的编辑流。

## 2. Goals

- Inspector 中可编辑文本/组合输入控件聚焦时，`Ctrl/Cmd+V` 应优先执行文本粘贴。
- graph pane 的结构编辑热键在可编辑控件聚焦时不得抢占文本编辑组合键。
- 保留 graph pane 在非编辑态下的 copy/paste/replace/insert/delete/undo/redo 快捷键行为。
- 修复应覆盖 Node Inspector 的 `name` / `path` 以及同类组合输入控件，而不是只针对单个字段打补丁。

## 3. Non-Goals

- 不改动 host 侧 `pasteNode`、`replaceNode` 或文档 reducer 语义。
- 不改变 Inspector 文本字段仍以 `onBlur` 为主的提交节奏。
- 不重构 graph pane 热键注册方式。
- 不把所有快捷键都迁移到 VS Code contributed keybindings。

## 4. Current Behavior

- graph pane 通过共享热键处理监听 `Ctrl/Cmd+C`、`Ctrl/Cmd+V` 等结构编辑命令。
- 当前“是否处于可编辑目标”判断覆盖了原生 `input`、`textarea`、`contenteditable` 和部分 dropdown popup，但没有把 Ant Design 组合输入容器本身稳定视为可编辑上下文。
- 当焦点位于 `AutoComplete` 这类组合输入时，`Ctrl/Cmd+V` 可能被误判为画布粘贴节点快捷键，导致文本未进入输入框，也不会触发表单后续提交。

根因：graph pane 的热键豁免条件对组合输入控件识别不完整，导致 editor-local 结构热键与 Inspector 文本编辑发生 owner 冲突。

## 5. Proposed Behavior

- 当事件目标位于 Inspector 的原生输入控件、组合输入控件、搜索输入或其容器内时，graph pane 热键直接放行，不执行结构编辑命令。
- `Ctrl/Cmd+V` 在节点名称 `AutoComplete` 聚焦时应执行普通文本粘贴；用户随后 blur 或选择候选时按既有节奏提交。
- 同一套“可编辑目标”判断在 editor webview 与 inspector sidebar 的键盘拦截逻辑中复用，避免后续出现不同入口行为漂移。

## 6. Design

- 抽出共享的 `isEditableEventTarget(...)` helper，统一识别：
  - 原生 `input` / `textarea`
  - `contenteditable`
  - Ant Design `Select` / `AutoComplete` / `InputNumber` / `Picker` 等组合输入容器
  - 相关 dropdown / popup 容器
  - 语义化 `textbox` / `combobox` / `searchbox` / `spinbutton` role
- graph pane 结构编辑热键和 inspector sidebar 的 save/undo/redo 拦截都改用该 helper。
- 为 helper 增加共享测试，覆盖组合输入 target 被视为可编辑的回归场景。

## 7. Implementation Plan

1. 新建本 work-item spec，并同步基线 spec 中关于 Inspector 编辑与热键所有权的规则。
2. 提取共享 helper，替换 graph pane 和 inspector sidebar 中重复的可编辑目标判断。
3. 为组合输入容器增加共享回归测试。
4. 运行 `npm run test:shared` 与 `npm run check` 验证。

## 8. Testing Plan

自动检查：

- 运行 `npm run test:shared`。
- 运行 `npm run check`。

手动回归：

1. 在 `embedded` 模式打开 Behavior3 custom editor。
2. 选中节点，在 Node Inspector 的 `name` 字段粘贴合法节点名。
3. 确认文本正常进入输入框，不触发节点结构粘贴。
4. blur 或选择候选后，确认节点类型成功提交。
5. 在非输入态下再次按 `Ctrl/Cmd+V`，确认节点粘贴快捷键仍可用。

## 9. Acceptance Criteria

- `embedded` 模式下，Node Inspector `name` 字段聚焦时按 `Ctrl/Cmd+V` 不会触发 `pasteNode()`。
- 粘贴后的名称值可按既有 `onBlur` / `onSelect` 提交节奏成功进入 `updateNode`。
- graph pane 在非编辑态下的结构编辑快捷键保持可用。
- `npm run test:shared` 通过。
- `npm run check` 通过。

## 10. Risks and Rollback

风险：若“可编辑目标”识别过宽，可能让本该由 graph pane 处理的快捷键在某些 overlay 场景失效。

缓解：

- 只把明确属于输入控件或其容器的 target 视为可编辑。
- 用共享测试覆盖原生输入、组合输入与普通 div 的区分。

回滚方式：恢复原先的局部判断，并针对具体控件单独补充豁免；但这会重新引入多入口判断漂移的维护成本。
