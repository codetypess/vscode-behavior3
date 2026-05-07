# Acceptance Scenarios

## 使用方式

本文件记录当前实现必须守住的黑盒回归场景。

这些场景不要求测试一定按相同实现路径触发，但最终对用户呈现的行为应保持一致。

## Case List

### BB-01 打开编辑器与初始化

- 打开一个 Behavior3 JSON 文件后，主编辑器发送 `ready`，宿主返回 `init` 与后续 `varDeclLoaded`
- 画布加载主树，主题、语言、nodeDefs、allFiles 与 settings 一并生效
- Inspector Sidebar 若已挂载，应同步获得同一份 init/vars/selection 上下文

### BB-02 主编辑器与侧栏上下文同步

- 激活某个 Behavior3 编辑器时，Inspector Sidebar 自动切到该文档上下文
- 点击画布空白处时，侧栏显示 Tree Inspector
- 点击节点或右键节点时，侧栏切换到对应 Node Inspector
- 没有激活 Behavior3 编辑器时，侧栏显示空状态而不是陈旧数据

### BB-03 节点选中、搜索与变量聚焦

- 点击节点可更新选中态，并同步到侧栏
- `Ctrl/Cmd+F` 打开内容搜索，`Ctrl/Cmd+G` 打开按 id 跳转
- 搜索结果可在图中跳转并高亮，`focusOnly` 打开时其余节点置灰
- 点击输入/输出热点或侧栏中的变量行时，相关变量命中节点高亮，其余节点按规则置灰

### BB-04 Tree Inspector 编辑

- Tree Inspector 可编辑 `desc`、`prefix`、`export`、`group`
- 本地变量列表支持新增、删除与字段校验
- import 引用支持从工作目录 `.json` 列表中选择
- 某个 local var 或 import 输入非法时，无关 tree 字段仍可独立提交
- 树级内容变更后，会重新驱动变量声明视图与相关图刷新

### BB-05 Node Inspector 编辑

- Node Inspector 展示节点 id、类型、children、name、desc、debug、disabled、path
- 已知 nodeDef 走结构化字段编辑；未知节点显示只读原始 JSON 视图
- 输入/输出槽、表达式参数、oneof 约束、必填项和自定义检查结果会进入表单校验
- 切换到新 nodeDef 时，未填写的 required arg 保持 unset，不会被静默写成空字符串或 false
- 某个 arg、slot 或 path 输入非法时，无关节点字段仍可独立提交
- subtree 内部节点若允许编辑，显示 override 重置条；若不允许编辑，相关字段为只读

### BB-06 结构编辑与快捷键

- 复制、粘贴、替换、插入、删除支持快捷键与右键菜单
- 删除根节点被拒绝
- 对 subtree 内部结构执行粘贴、替换、插入、删除会被拒绝
- 新插入或粘贴的节点会获得新的稳定 id

### BB-07 拖放与重排

- 画布拖放可表达 `before`、`after`、`child` 三种意图
- 不能拖动 subtree 内部节点
- 不能把节点拖到自己的后代下
- 不能围绕根节点 before/after 放置，也不能向 subtree link 直接追加 child
- 合法拖放提交后，图和侧栏选中保持一致

### BB-08 Undo / Redo / Dirty

- 树级和节点级真实变更会推进 history
- selection、搜索、变量高亮、视口变化不会推进 history
- undo / redo 恢复后，图、选中和侧栏上下文重新对齐
- 保存成功后 dirty 清零

### BB-09 保存、回滚与外部文件变化

- 保存时主文档内容先规范化，再交由 VS Code custom editor 生命周期写盘
- 保存时主树节点会把当前 display id 回写到 persisted `id`
- 保存写回的叶子节点若没有内联子节点，结果省略空 `children` 字段
- 磁盘外部改动到来且当前无未保存更改时，编辑器静默重载
- 磁盘外部改动到来且当前有未保存更改时，进入 reload conflict 状态
- 侧栏中的 reload 操作会触发回滚到磁盘版本，而不是在 webview 内直接做文本合并

### BB-10 Subtree 打开、另存与追踪刷新

- 节点 `path` 指向的 subtree 可被打开到对应 Behavior3 编辑器
- `Save as subtree` 会把当前选中子树序列化为新文件，并把原节点替换为 subtree link
- 会话只跟踪“当前主树可达”的 subtree 集合
- 被跟踪 subtree 保存或修改后，父编辑器收到 `subtreeFileChanged` 并重建解析结果

### BB-11 Settings、Theme 与 NodeDefs 热更新

- 宿主推送 `settingLoaded` 后，语言、`checkExpr`、`subtreeEditable`、`nodeColors` 与 nodeDefs 生效
- VS Code 主题变化时，画布和侧栏主题同步切换
- nodeDefs 变化后，图节点样式、Inspector 表单结构和 groupDefs 一并刷新

### BB-12 Build 与节点参数检查

- 触发 build / build debug 后，宿主执行构建流程并返回 `buildResult`
- 图重建时会按当前节点定义与工作区脚本执行节点参数检查，包含必填参数缺失
- 校验失败的节点以错误风格显示，且相关字段在 Inspector 中反馈错误

### BB-13 新版本文件保护

- 当前主文档若由更新版本的 Behavior3 生成，编辑、保存、subtree 保存都会被阻止
- 目标 subtree 文件若由更新版本生成，覆盖保存也会被阻止
- 这些拒绝路径会给出明确错误信息，而不是静默失败

### BB-14 Inspector 调整时的画布稳定性

- 当主画布已经缩放或平移时，拖动 inspector sidebar 宽度不应让节点整体跳向右下或其他方向
- resize 之后，画布仍应保持当前可见内容的相对位置稳定

## 最低回归样例

每次涉及架构、协议、保存、subtree 或 Inspector 语义的改动，至少应人工回归：

1. 打开主树，点击节点与空白区，确认主编辑器和侧栏同步
2. 修改 Tree Inspector 与 Node Inspector，保存后重开文件确认结果持久化
3. 执行 copy / paste / replace / insert / delete / drag-drop，确认 history 与 dirty 正常
4. 触发 subtree 打开、另存和外部 subtree 改动，确认父树刷新
5. 触发 `settingLoaded`、主题切换与 build，确认图和侧栏行为不漂移
