# CHANGELOG_24: 项目组织入口与文件护栏整理

## 概要

本轮按项目组织要求补齐仓库级 agent 入口，修正 `ref/` 索引说明，并处理 Rust 源文件 500 行护栏。改动只整理项目组织和测试承载位置，不改变运行时行为。

## 变更内容

### 根入口文档

- 新增 `AGENTS.md`，作为配套 agent 入口，只记录入口特定工具机制差异。
- 更新 `CLAUDE.md`，明确 `CLAUDE.md` 是共享项目规则，`AGENTS.md` 只承载入口差异。
- 将约定候选入口统一到 `ref/conventions/tally.md`，升级后写入 `ref/conventions/<X>-<topic>.md`。
- `.gitignore` 忽略 `.prompt-asset-improver/local/` 与 `.deep-review-cache/`，避免本地扫描、备份和 review cache 进入项目历史。

### `ref/` 组织索引

- 修正 `ref/reviews/INDEX.md` 中指向 `ref/changelogs/` 的链接。
- 清理 `ref/conventions/INDEX.md` 的过时说明，改成当前项目入口与 conventions 目录的关系。
- 将旧 `.claude/conventions-tally.md` 的 AP-1..AP-20 候选迁入 `ref/conventions/tally.md`，删除 `.claude/` 下的 tracked 文件。

### 文件大小护栏

- 将 `src-tauri/src/commands/fs.rs` 的测试块拆到 `src-tauri/src/commands/fs_tests.rs`。
- `fs.rs` 从 531 行降到 345 行，非测试源文件重新回到 500 行护栏内。

### README

- 更新项目结构段，补充 `AGENTS.md`、`CLAUDE.md`、`build/fe/`、`ref/` 子目录和 Tauri `commands/` 模块。
