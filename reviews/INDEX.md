# Reviews 索引

> 周期性 / 触发性的 debug、code review、性能 audit、安全审查报告。功能变更去 [`changelog/`](../changelog/INDEX.md)，本目录专注**修问题与加固**。

## 命名

`REVIEW_X.md`（X 递增整数，跟 `CHANGELOG_X.md` 对齐）。新建前 `ls reviews/` 找最大 X。

## 单文件结构

- 触发场景（用户主动 / 周期性 / 大重构前 ...）
- 方法（双对抗 Agent 配对、范围、工具）
- 三态裁决清单（✅ / ❌ / ❓）+ 证据（文件:行号 + 代码片段）
- 修复条目（按严重度）
- 关联 changelog（本轮修复落地的 CHANGELOG 编号）

## 索引表

| 文件 | 主题 | 严重度分布 | 关联 changelog |
|------|------|-----------|----------------|
| [REVIEW_1.md](REVIEW_1.md) | 跨平台兼容性 Windows 支持基础设施盘点（双异构 reviewer-claude Opus 4.7 + reviewer-codex gpt-5.5 wrapper）：12 ✅（4 HIGH / 4 MED / 4 LOW）。修复 6 phase commit：platform.ts 抽象 + cli/store path 修复 + symlink → junction + hooks 协议平台分流 + Tauri Rust cfg 守门 + readers Win 平台分流 | 4 HIGH / 4 MED / 4 LOW | CHANGELOG_6 |
