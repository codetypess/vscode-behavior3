# Product Scope

## 目标

本仓库当前交付的是一套面向 Behavior3 JSON 树文件的 VS Code 编辑体验，核心由以下部分组成：

- 自定义编辑器：以 G6 画布展示行为树结构
- Inspector Sidebar：在独立侧栏中编辑树级与节点级字段
- Extension-host 会话层：负责文档保存、回滚、文件监听、构建、设置热更新与 subtree 文件读写
- 共享构建与校验能力：支持 build、build debug 与节点参数检查

用户可见的核心结果不是“通用 JSON 编辑器”，而是“围绕行为树语义工作的编辑器”。

## 固定技术路线

当前实现已经固定为以下路线：

1. VS Code `CustomEditorProvider` 承载主编辑器。
2. VS Code `WebviewViewProvider` 承载独立 Inspector Sidebar。
3. Extension-host 侧以 `TreeEditorProvider`、`TreeEditorSession`、`InspectorSidebarCoordinator` 串起会话、监听器和磁盘写入。
4. Webview 侧以 React + Zustand + `EditorCommand` controller 组织运行时。
5. 图层统一由 `G6GraphAdapter` 渲染，画布不直接持有文档真源。
6. 主文档与 subtree 路径统一使用 workdir-relative `.json` 路径语义。

## 产品边界

当前实现覆盖的稳定边界包括：

- 打开行为树 JSON 文件，并在画布中展示主树与可达 subtree 的解析结果
- 在侧栏中编辑树元数据、变量、import 引用、节点字段、输入输出槽与结构化参数
- 在主编辑器与 Inspector Sidebar 之间同步选中节点、当前文档内容和变量视图
- 通过保存、回滚、外部文件监听和 subtree 监听维持主文档与磁盘一致
- 通过 build 与节点参数校验提供项目级反馈
- 在设置、主题、语言和 nodeDefs 变化时热更新编辑体验

## 非目标

以下内容不属于当前产品目标：

- 成为任意 JSON 文件的通用图形编辑器
- 在 webview 内直接提供文本源码编辑模式
- 把图层状态当成可保存真源
- 支持工作目录之外的任意路径读写
- 在 subtreeEditable 关闭时编辑外部 subtree 内部结构
- 提供协同编辑、多人冲突合并或运行时调试器

## 设计原则

### 1. 语义优先于通用 JSON

界面与命令都围绕 Behavior3 的树、节点、变量、subtree、build 和检查脚本语义设计。

### 2. 结构修改必须经过 controller

所有主文档结构写入都通过 `EditorCommand` 与 controller runtime 管理，不允许图层或表单直接改树。

### 3. 主编辑器与侧栏共享同一业务语义

Inspector Sidebar 不是另一套业务实现，而是复用同一套协议、字段和命令语义，只是在宿主侧通过代理消息落到当前激活编辑器。

### 4. 宿主负责磁盘和项目上下文

Extension-host 持有文件监听、项目索引、设置解析、构建执行、节点检查脚本运行等能力；webview 不直接访问磁盘。

## 当前交付面

### 1. 主编辑器

- 画布展示树结构
- 节点选中、拖放、复制粘贴、替换、插入、删除
- 搜索、跳转、变量高亮
- 保存、回滚、构建、打开 subtree、另存为 subtree

### 2. Inspector Sidebar

- 根据当前激活的 Behavior3 编辑器同步上下文
- Tree Inspector 与 Node Inspector 共用当前文档状态
- 支持代理树/节点变更、保存、撤销、重做
- 在无激活编辑器时显示空状态

### 3. 项目能力

- 基于项目根目录收集可见 `.json` 文件
- 基于 import 与 subtree 递归计算变量可见性
- 响应 `.b3-setting`、`.b3-workspace` 与 VS Code `behavior3.*` 配置变化
- 运行 build 与节点参数自定义检查脚本

## 完成标准

当前产品基线应满足：

1. 打开树文件后，主编辑器和 Inspector Sidebar 都能得到一致的文档与选中上下文。
2. 任何树或节点修改都能通过保存落盘，并在需要时驱动变量视图、subtree 跟踪和图重建。
3. 外部文件改动、subtree 文件改动、设置变化和主题变化都能被当前会话正确吸收。
4. 主树节点、subtree link、subtree 内部节点的编辑限制和行为差异是明确且稳定的。
5. build、节点检查、版本保护和回滚路径都能为用户提供明确反馈。
