# Docs Index

`docs/` 是当前仓库的文档入口，主要服务两类场景：

- 想快速了解产品能力、命令入口和脚本用法
- 想按 Specification-Driven Development 流程继续推进实现

## 快速入口

- [../README.md](../README.md): 面向仓库使用者的总览、快速开始与脚本说明
- [../README.zh-CN.md](../README.zh-CN.md): 面向中文使用者的安装、使用与脚本说明
- [spec-driven-development.md](spec-driven-development.md): 本仓库的 SDD 工作流说明
- [spec/README.md](spec/README.md): 基线 spec 地图、阅读顺序与 work-item 索引

## 文档分层

- `docs/spec/01*`、`10*`、`90*`: 长期有效的基线 spec，定义产品范围、架构、协议、编辑语义和实施顺序
- `docs/spec/<slug>.md`: 仅在当前存在非 trivial 进行中任务时出现，用来记录本次改动的目标、设计、测试与验收

历史上已完成或已废弃的 work-item 不默认长期保留在目录里；需要追溯时，优先看对应基线 spec 或 git history。

当前目录已收敛到以基线 spec 为主；需要新的 work-item 时再按 SDD 流程补充。

## 推荐阅读方式

- 第一次进入仓库：先读 [../README.md](../README.md)，再读 [spec/README.md](spec/README.md)
- 准备做非 trivial 改动：先读 [spec-driven-development.md](spec-driven-development.md)，再创建或更新对应的 work-item spec
- 只做文案修正或局部机械整理：通常不需要新增 work-item，但如果范围扩大，应该补回 spec
