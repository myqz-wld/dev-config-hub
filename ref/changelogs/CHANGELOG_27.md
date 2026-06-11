# CHANGELOG_27: Foundation 模板二轮对齐（review 过期规则 + 维护脚本）

## 概要

按 project-engineering-foundation 模板补齐 CHANGELOG_26 一轮对齐后仍缺的 review 过期规则节，并落地配套维护脚本；不改变运行时行为。

## 变更内容

### `CLAUDE.md`

- 新增「Review 过期与最小复审范围」节：unreviewed ∪ expired ∪ scope_unknown 最小复审范围 + 4 条过期判定（净改动 ≥ min(200, 30% LOC) / commit 数 ≥ 3 / ≥ 90 天且有改动 / frontmatter `expired: true`）。
- 头部 SSOT 描述同步覆盖 review 过期规则和文件大小护栏（500 行护栏本仓库已有自定义版本，保持不动）。

### `scripts/`

- 新增 `scripts/file-level-review-expiry.sh`（来自 foundation skill），review 过期检查脱离 skill 独立可跑。

### `README.md`

- 「项目结构」树补 `scripts/` 条目。

## 备注

- 本轮验证：`bun test` 通过；`git diff --check` 无问题。
