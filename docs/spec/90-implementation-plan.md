# Implementation Plan

## 目标

本文件不再描述“未来将迁移到 G6”的计划，而是记录当前实现已经落地的主线，以及未来继续做跨层改动时应遵守的实现顺序。

## 当前实现基线

当前代码已经完成以下主线：

### 阶段 0：文档与共享协议定型

- `contracts.ts`
- `message-protocol.ts`
- path normalization
- resolved graph / graph VM / Inspector snapshot 等共享语义

### 阶段 1：Extension-host 会话化

- `TreeEditorProvider`
- `TreeEditorSession`
- `InspectorSidebarCoordinator`
- 主文档操作串行化
- 文件监听、setting/watchers、project index

### 阶段 2：G6 图层落地

- `G6GraphAdapter`
- LR 树布局
- 自定义 vector tree node
- selection / search / variable highlight / drag-drop

### 阶段 3：Controller Runtime 收敛

- document / workspace / selection store
- `EditorCommand`
- history / dirty / reload conflict
- subtree source cache 同步

### 阶段 4：Inspector Sidebar 代理编辑

- 独立 sidebar webview
- 当前激活文档上下文同步
- 代理 tree/node mutation
- 侧栏内 save / undo / redo

### 阶段 5：项目级能力回接

- nodeDefs / groupDefs
- varDeclLoaded / importDecls / subtreeDecls
- build/build debug
- node arg custom checks
- 新版本文件保护

## 未来继续演进时的推荐顺序

对跨层行为改动，推荐仍按以下顺序推进：

1. spec 与 acceptance
2. shared contracts / protocol / path semantics
3. extension-host session 与 watcher 逻辑
4. controller runtime 与 store ownership
5. resolve graph / graph VM / graph adapter
6. Inspector Sidebar 表单与代理消息
7. save / reload / build / validation 回归

## 实现期间强约束

1. 不把 G6 graph instance 当成文档真源。
2. 不把宿主 IO 细节泄露到图层或表单层。
3. 不让 Inspector Sidebar 演化成第二套独立 mutation runtime。
4. 不把 subtree 内部编辑偷偷回写到 subtree 源文件。
5. 不在 shared contracts 未收敛时并行扩展多层实现。

## 发生跨层改动时的最低交付顺序

### 1. 先改 spec

- work-item spec
- 必要的编号基线 spec

### 2. 再改共享边界

- DTO
- message names
- path rules
- command surface

### 3. 再改宿主与 controller

- session
- watchers
- mutation flow
- history / save / reload

### 4. 最后改图层与侧栏

- graph view model
- graph adapter
- Inspector UI / validation / proxy wiring

## 最低回归要求

只要涉及以下任一方面，就至少需要整体验证一轮：

- host protocol
- subtree resolution
- save / revert / external reload
- Inspector Sidebar 代理 mutation
- search / selection / variable focus
- build 或 node arg custom checks

## 完成标准

对未来任一非 trivial 改动，若遵守本文件顺序，最终应满足：

- spec、shared contracts、实现与回归场景同时更新
- 主编辑器、侧栏和宿主之间没有出现职责倒挂
- 文档与当前代码基线仍能保持一致
