# Changelog 索引

> **范围**：功能变更（新功能 / 行为修改 / API / 依赖升级）。Debug / 性能 / 安全 review 见 [`reviews/`](../reviews/)（暂未建立）。

| 文件 | 概要（≤80 字） |
|------|------|
| [CHANGELOG_1.md](CHANGELOG_1.md) | 新增 Profile 系统：CLI + UI 双入口，env / symlink 双切换模式，pre/post Hook |
| [CHANGELOG_2.md](CHANGELOG_2.md) | 修复 env 模式 user-level settings.json env 泄漏：env 模式补做 symlink swap |
| [CHANGELOG_3.md](CHANGELOG_3.md) | 移除 env 切换模式（含 spawnTerminal / TerminalApp / --mode / --terminal），统一只走 symlink |
