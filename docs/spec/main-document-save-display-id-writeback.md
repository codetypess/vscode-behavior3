# Main Document Save Display ID Writeback

Status: Implementing
Date: 2026-05-07
Scope: main-document save persistence and host save lifecycle

## 1. Context

当前编辑器会在 resolved graph 中为主树节点按 pre-order 生成运行时 `displayId`，新插入节点的 persisted 初始值仍可能是 `id: ""`。

用户当前看到的问题是：

- 画布上节点已经显示出正确编号
- 但保存主文档后，JSON 里该节点仍然保留空 `id`

根因：

- 主树 `displayId` 只存在于 resolved graph 的 `mainTreeDisplayIdsByStableId`
- 主文档保存流程直接写当前 `TreeEditorDocument.content`
- 保存前没有把这份运行时映射回写到 persisted 主树内容

## 2. Goals

- 保存主文档时，把当前主树节点的 `displayId` 写回 persisted `id`
- 同时覆盖 webview 发起保存与 VS Code custom editor 生命周期保存
- 保持 subtree 内部节点不写回主文档结构

## 3. Non-Goals

- 不改变未保存状态下的宿主正文同步策略
- 不把 subtree 内部实例的运行时编号反写到主文档
- 不重构 host/webview 保存协议

## 4. Current Behavior

- 主树新增节点在 reducer 中以 `id: ""` 建立 persisted 结构
- resolved graph 会重新分配显示编号并用于画布渲染
- `saveCustomDocument` 只规范化当前文本，不补主树 display id
- 因此磁盘结果可能保留空 `id`

## 5. Proposed Behavior

- 主文档进入写盘前，先重新解析 persisted tree
- 递归读取当前主树可达 subtree，重建 resolved graph
- 用 `mainTreeDisplayIdsByStableId` 回写主树节点 `id`
- 再做现有 JSON/tree 规范化并落盘
- 保存完成后，宿主内存正文与 session history 当前游标也同步为写盘后的规范化结果

## 6. Design

- 新增共享保存辅助函数，专门产出“主文档保存用序列化内容”
- 该函数只对主树结构节点应用 `applyMainTreeDisplayIds`
- provider 级 `persistMainDocumentToDisk` 与 `saveCustomDocumentAs` 统一复用这份内容
- `DocumentSessionState.markSaved()` 同步替换当前 history 游标上的快照，避免保存后 undo/redo 指回旧文本

## 7. Implementation Plan

1. 新建 work-item spec 并记录根因与边界。
   Exit Criteria: 保存时为什么没写回 `id` 已明确。
2. 增加主文档保存序列化 helper。
   Exit Criteria: 能从 persisted tree + subtree cache 产出写回主树 id 的保存文本。
3. 接入 provider 保存生命周期。
   Exit Criteria: 普通保存和另存为都走同一套写回逻辑。
4. 补测试与基线 spec。
   Exit Criteria: 保存语义、history 语义和验收场景都有回归保护。

## 8. Testing Plan

- 为共享保存 helper 增加“空 `id` 节点保存后获得主树 display id”测试
- 为 `DocumentSessionState.markSaved()` 增加“保存会替换当前 history 快照”测试
- 运行 `npm run test:shared`
- 运行 `npm run check`

## 9. Acceptance Criteria

- 新插入主树节点若 persisted `id` 为空，保存后磁盘内容写入当前 display id
- 带 subtree link 的主文档保存时，只回写主树锚点节点 `id`
- subtree 内部节点不会被反写进主文档结构
- 保存后 undo/redo 不会回到保存前的旧空 `id` 快照

## 10. Risks and Rollback

风险：

- 保存时重新解析 subtree 可能放大对缺失/非法 subtree 的依赖
- 若 history 当前游标未同步替换，保存后可能出现脏状态或 undo 文本漂移

缓解：

- subtree 读取失败时沿用现有降级解析，不阻断主文档保存
- 用测试覆盖保存后 history 当前快照更新

回滚：

- 如该保存归一化引入不可接受回归，可先回退到仅做普通文本规范化，再重新设计更窄的 save-time writeback 路径
