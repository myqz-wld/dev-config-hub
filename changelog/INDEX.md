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
| [CHANGELOG_7.md](CHANGELOG_7.md) | REVIEW_2 落地（综合 deep review fix，按 PR 追加）：PR-1 测试地基 — store loadStore/saveStore 加可选 path + 9 case loadStore 边界 + parseFlags export + 14 case 回归保护 + 6 case pathState 四态；38 → 68 pass + 1 skip（H3 待 PR-5） |
| [CHANGELOG_8.md](CHANGELOG_8.md) | Schema-driven 精细化配置 + CM6 + Markdown 渲染（**10 PR 全合 + 4 follow-up + REVIEW_3 + REVIEW_4 收口**）：PR-A 类型骨架 / PR-B JSON 写回保留 / PR-F CM6 替换 raw + dotfile/markdown view / REVIEW_3 双异构对抗 23 fix（5H/9M/9L+3 AP）/ PR-C 14 个 fields 控件 / PR-D 接入 Claude settings.json schema 行内编辑（**用户首波感知** + CLAUDE.md Schema 三铁律 + README）/ PR-E 扩展到 Codex/OpenCode/.mcp.json + toml-patcher 11 case / PR-G CM6 edit + JSON Schema lint+hover+completion + TOCTOU 完整 banner / PR-H Markdown 渲染（react-markdown + shiki lazy + GFM + sanitize）/ PR-I ProfilePanel 拆 7 文件（789→261）+ dch-store schema + ProfileStoreEditor / PR-J sync.ts 自动化（list/--check-self/--fetch/--list-scopes）+ ajv runtime 校验 + bundle splitting (4.76→3.65 MB entry + 11 chunks) + 文档收口 / **Follow-up**: #3 字段 errors Context 按 path 分发 / #4 GitHub Action schema-sync cron / #1 PathField Tauri dialog / #2 happy-dom CMEditor + MarkdownView 单测 / **REVIEW_4 双异构对抗 2 轮 30 fix（5H/16M/9L+3 AP）**：H1 onConflictReload TOML 硬编 JSON.parse / H1' defaultMode enum 漏 4 项 / H2 dch-store profile.id pattern / R-H1 process.env.HOME bun bundler inline / R-H2 严校验比上游严回归回退 / R-M3 saving 期间 reload 覆盖 in-flight；**76 → 209 pass / 0 回归** |
