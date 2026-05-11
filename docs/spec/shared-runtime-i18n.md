# Shared Runtime I18n

Status: Done
Date: 2026-05-11
Scope: host-safe runtime localization for shared and extension-host flows

## 1. Context

当前仓库存在两类本地化来源：

- `package.nls*.json`，用于 VS Code manifest 贡献点文案
- `webview/shared/i18n.ts` + `media/locales/*.json`，用于 webview React runtime

但 extension-host 与 `webview/shared/**` 里的部分运行时文案仍直接写成 `language === "zh" ? ... : ...`。典型位置包括：

- `formatDocumentMutationReducerError()`
- newer file version 警告/阻止编辑文案
- host-side subtree save mutation 错误

这些文案需要同时满足两个约束：

1. 必须尊重 `behavior3.language = auto | zh | en`
2. 不能把 React/i18next/browser 依赖引入 host 或 shared pure layer

`vscode.l10n` 只跟随 VS Code 显示语言，不适合作为这里的主方案，因为它无法直接表达扩展内的强制语言配置。

## 2. Goals

- 为 host 与 `webview/shared/**` 提供一套纯、可复用的运行时翻译 helper。
- 继续复用 `media/locales/en.json` 与 `media/locales/zh.json` 作为运行时文案来源。
- 消除当前 host/shared 里显式的 `language === "zh"` 文案分支。
- 保持当前用户可见文案语义稳定，不顺带改协议或 reducer 语义。

## 3. Non-Goals

- 不替换 `package.nls*.json` 对 manifest 文案的职责。
- 不把 webview React runtime 改为不使用 `i18next`。
- 不在本次工作中把所有历史运行时文案一次性迁移完；先覆盖当前明确使用 `EditorLanguage` 分支和同链路错误文案。
- 不引入 codegen、远程语言包或新的构建步骤。

## 4. Current Behavior

- `webview/shared/i18n.ts` 依赖 `i18next`、`react-i18next`、`document`、`navigator`，只适合 webview runtime。
- `webview/shared/document.ts` 中的 reducer error formatter 直接内嵌中英文模板。
- `src/editor-session/session-file-version.ts` 与 `tree-editor-webview-session.ts` 中的 host 运行时消息也直接内嵌中英文分支。
- 这导致：
  - 运行时文案散落在多个 host/shared helper 中
  - 相同语言选择逻辑被重复实现
  - shared 纯层无法直接复用现有 locale 资源

## 5. Proposed Behavior

- 新增一个纯 helper，负责：
  - 语言归一化
  - 从 `media/locales/*.json` 读取运行时文案
  - `{{name}}` 风格插值
- helper 放在 host-safe/shared-safe 的模块中，不依赖 React、`i18next` 或浏览器全局。
- webview React runtime 继续使用 `i18next`，但语言归一化逻辑与资源来源可和纯 helper 对齐。
- `formatDocumentMutationReducerError()`、newer version message helper、host-side subtree save / unsupported mutation 等运行时消息改为通过纯 helper 出文案。

## 6. Design

### 6.1 Pure Runtime Translator

新增 `webview/shared/runtime-i18n.ts`，导出：

- `supportedLanguages`
- `SupportedLanguage`
- `normalizeI18nLanguage(language)`
- `tRuntime(language, key, params?)`

它直接读取 `media/locales/en.json` 与 `media/locales/zh.json`，并在 key 缺失时回退到英文。

### 6.2 Language Source of Truth

host / shared runtime 仍以显式传入的 `EditorLanguage` 或 settings language 为准，不直接查询 `vscode.env.language`、`document.documentElement.lang` 或 `navigator.language`。

`auto` 到具体 `zh | en` 的决策继续留在 session settings 层。

### 6.3 Webview Runtime Separation

`webview/shared/i18n.ts` 继续负责 React/i18next 初始化与切换，不反向成为 host 的依赖。

### 6.4 Migration Scope

本次至少迁移：

- document mutation reducer error formatter
- newer file version warn/edit messages
- host-side save-selected-as-subtree user-facing errors
- 同一条 host mutation 流里的 unsupported mutation / invalid saved path 文案

## 7. Implementation Plan

### Phase 1. Spec and Helper Contract

- 新增 work-item spec
- 明确纯 helper 的边界与 key 来源

Exit:

- 可以指出单一的 runtime translator 模块与其资源来源

### Phase 2. Runtime Message Migration

- 实现 `runtime-i18n` helper
- 更新 shared/host formatter，移除显式 zh/en 分支
- 在 locale JSON 中补齐缺失 key

Exit:

- 目标链路上的运行时文案都通过 helper 输出

### Phase 3. Verification and Baseline Sync

- 补充 shared tests
- 运行 `npm run check`、`npm run test:shared`、`npm run build`
- 更新相关基线 spec

## 8. Testing Plan

- shared tests 覆盖：
  - runtime translator 插值
  - reducer error formatter 语言输出
  - newer file version 文案
- `npm run check`
- `npm run test:shared`
- `npm run build`

## 9. Acceptance Criteria

- host/shared 目标链路不再直接用 `language === "zh"` 拼运行时文案。
- `formatDocumentMutationReducerError()` 继续可在 host 路径中调用，但文案来自纯 translator。
- newer version warn/edit 文案继续尊重 `behavior3.language`。
- `media/locales/en.json` 与 `media/locales/zh.json` 成为这批运行时文案的单一资源来源。
- `npm run check` 成功。
- `npm run test:shared` 成功。
- `npm run build` 成功。

## 10. Risks and Rollback

- 风险：shared helper 直接依赖 locale JSON 后，extension tsconfig 若不支持 JSON import 会导致类型检查失败。
- 风险：locale key 写错会在运行时退回英文或原始 key。
- 风险：把 webview i18n 与 pure helper 混在一起会重新引入 React/browser 依赖。

缓解：

- 保持 pure helper 与 `webview/shared/i18n.ts` 分离。
- 给 translator 与 formatter 增加 shared tests。
- 仅迁移当前明确范围内的消息，避免一次性扩散。

Rollback:

- 删除 pure helper 并恢复原有 inline language 分支
- 保留新增 locale key 但不再引用
