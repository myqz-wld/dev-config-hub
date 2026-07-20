---
changelog_id: 28
changed_at: 2026-06-11
---

# CHANGELOG_28: 入口资产去重 + README 移除 OpenCode 过期支持

## 概要

prompt-asset 维护轮：`CLAUDE.md` 去重压缩、`AGENTS.md` 收敛到入口差异、`README.md` 移除已删功能的过期文档并修正备份路径与结构树。独立 review 裁决 0 MUST-FIX。

## 变更内容

### `README.md`（事实性修正）

- 移除全部 OpenCode 支持描述（支持工具表行 / `dch opencode` / Windows 矩阵子句）：`src/readers/opencode.ts` 已删除，`src/cli.ts` 工具列表仅剩 `shell | claude | codex`，src/ 内 0 处 opencode 引用。该功能删除此前无 changelog 记录，本条补记。
- 修正备份默认输出：`dch profile backup` 默认覆盖 `~/.dch/backups/latest.dchpack`（`src/profiles/backup-manage.ts` `DEFAULT_FILENAME`），`--keep` 才产出 `dch-backup-<TS>.dchpack`；gpg 加密迁移示例补 `--keep`。
- 项目结构树按 `ls` 实测重建：删 dead 的 `readers/opencode.ts`，补缺失真实文件（profiles/defaults、bridge-core、atomic.rs 等），测试文件改为一行说明。

### `CLAUDE.md`

- §基础目录架构补 `scripts/` 条目，和 foundation v0.0.5 目录规则对齐；README 项目结构已包含 `scripts/`，无需重复改。
- 删「已踩的坑（别再回退）」整节：4 条全部与 §项目特定约定 同证据重复（CHANGELOG_3/4/5）；唯一独有的「wrapper 直接 eval」根因并入 §profile.env 的注入校验规则。
- §改动后必做 压缩：「同步 INDEX.md」4 处合并为 1 条加粗规则；生命周期 5 bullet → 2。
- §配置文件展示 删 dead 路径 `~/.config/opencode/opencode.json`，删除历史压缩为一行 pitfall（CHANGELOG_14）。
- §500 行 删过期状态行（实测 bridge.ts 373 / ProfilePanel 303 / cli-profile 389，均远低于上限）。
- CLAUDE/AGENTS 对偶审计规则三写 → 一写。

### `AGENTS.md`

- Read Order 2-3 条与 Entry Mechanics Bun 行删除：均为 CLAUDE.md 共享规则复述；保留入口特有机制（rg/apply_patch、worktree、异步不轮询）。

### `AGENTS.md` 2026-06-13 追加

- 将入口文件从英文改为中文，和 `CLAUDE.md` 的仓库语言保持一致。
- 删除剩余通用工具机制和异步协作流程，只保留读取 `CLAUDE.md` 与当前无额外入口差异的说明。

## 备注

- 验证：src/ 与 9 文件 0 处 opencode 残留；结构树 18 个抽查条目全部存在于磁盘；死链 0；`git diff --check` 通过；独立 reviewer 确认 4 条 evidence-backed pitfall 全部在 §项目特定约定 保留。
- 2026-06-13 追加验证：`rg -n "Read Order|Entry Mechanics|Entry Differences|apply_patch|\\brg\\b|sleep|handoff|prompt assets" AGENTS.md` 无匹配；`git diff --check -- AGENTS.md ref/changelogs/INDEX.md ref/changelogs/CHANGELOG_28.md` 通过。
