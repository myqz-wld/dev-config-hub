# Changelog 索引

> **范围**：功能变更（新功能 / 行为修改 / API / 依赖升级）。Debug / 性能 / 安全 review 见 [`reviews/`](../reviews/INDEX.md)（CHANGELOG_6 起划分）。

| 文件 | 概要（≤80 字） |
|------|------|
| [CHANGELOG_1.md](CHANGELOG_1.md) | 新增 Profile 系统：CLI + UI 双入口，env / symlink 双切换模式，pre/post Hook |
| [CHANGELOG_2.md](CHANGELOG_2.md) | 修复 env 模式 user-level settings.json env 泄漏：env 模式补做 symlink swap |
| [CHANGELOG_3.md](CHANGELOG_3.md) | 移除 env 切换模式（含 spawnTerminal / TerminalApp / --mode / --terminal），统一只走 symlink |
| [CHANGELOG_4.md](CHANGELOG_4.md) | 新增 `dch profile env` + ~/.zshrc 子 shell wrapper，让 profile.env 落到 claude / codex 进程（OAuth / API 走代理） |
| [CHANGELOG_5.md](CHANGELOG_5.md) | 修 UI 删除 profile 卡死（Tauri 2 不弹 window.confirm）改内联确认；新建表单加 preHook/postHook + 模型配置（settings.json/config.toml）一次填齐 |
| [CHANGELOG_6.md](CHANGELOG_6.md) | 跨平台兼容性 Windows 支持（REVIEW_1 落地）：新增 platform.ts 抽象 + cli/store path 修复 + symlink → junction 平台分流 + hooks 协议加 PowerShell/cmd（向后兼容 string）+ Tauri Rust 全套 cfg(target_os) 守门 + readers Win 平台分流；38 bun test 全过 mac 端零回退；Win 端真机 E2E 留 CI |
