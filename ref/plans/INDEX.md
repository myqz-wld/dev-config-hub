# Plans 索引

> **范围**：终态 plan 文档。未终态 plan 留在当前环境配置的工作区；无更强契约时用 `<repo>/.refs/plans/`，`.refs/` 必须加入 `.gitignore`，不要放进本目录。
> **清理**：plan 到终态后，把最终文档和 plan 专属支持材料归档到 `ref/plans/`，更新本 INDEX，并清理工作区副本。

| Plan | 状态 | 完成日期 | 摘要 | 关联 changelog/review |
|---|---|---:|---|---|
| [deep-review-fix-20260514.md](deep-review-fix-20260514.md) | completed | 2026-05-14 | Deep review Round 1 修复与 Round 2 准备。 | [CHANGELOG_18](../changelogs/CHANGELOG_18.md), [REVIEW_8](../reviews/REVIEW_8.md) |
| [dch-secrets-dedup-20260514.md](dch-secrets-dedup-20260514.md) | completed | 2026-05-14 | 备份/还原 secret 去重与交互式填值。 | [CHANGELOG_19](../changelogs/CHANGELOG_19.md) |
| [dch-deep-review-20260515.md](dch-deep-review-20260515.md) | completed | 2026-05-15 | REVIEW_9 + CHANGELOG_21 deep review G1-G12 收口。 | [CHANGELOG_21](../changelogs/CHANGELOG_21.md), [REVIEW_9](../reviews/REVIEW_9.md) |
| [dch-deep-review-followup-20260515.md](dch-deep-review-followup-20260515.md) | completed | 2026-05-15 | REVIEW_9 follow-up F1-F4 收口。 | [CHANGELOG_22](../changelogs/CHANGELOG_22.md), [REVIEW_9](../reviews/REVIEW_9.md) |
| [build-dir-migration-20260526.md](build-dir-migration-20260526.md) | completed | 2026-05-26 | 前端 build 产物迁移到 `build/fe/`。 | [CHANGELOG_23](../changelogs/CHANGELOG_23.md) |
