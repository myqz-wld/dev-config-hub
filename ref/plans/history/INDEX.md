# History Plans

## Scope

This bucket contains only plans that currently belong to this mutually exclusive date range. Remove rows for files moved to another bucket during rebucketing.

| Bucket | Date Range |
|---|---|
| `recent-3-days` | `Completed At` or `completed_at` is within the last 3 days, inclusive |
| `recent-week` | `Completed At` or `completed_at` is older than 3 days and within the last 7 days, inclusive |
| `recent-month` | `Completed At` or `completed_at` is older than 7 days and within the last 30 days, inclusive |
| `history` | `Completed At` or `completed_at` is older than 30 days, or missing a parseable date |

## Index Table

| Completed At | Plan | Status | Summary | Related Final Record |
|---|---|---|---|---|
| 2026-06-24 | [PLAN_1_commit-build-metadata.md](PLAN_1_commit-build-metadata.md) | completed | Package commit metadata and expose installed freshness checks. | [CHANGELOG_34](../../changelogs/history/CHANGELOG_34_commit-build-metadata.md) |
| 2026-05-26 | [build-dir-migration-20260526.md](build-dir-migration-20260526.md) | completed | Migrated frontend artifacts to `build/fe/`. | [CHANGELOG_23](../../changelogs/history/CHANGELOG_23.md) |
| 2026-05-15 | [dch-deep-review-followup-20260515.md](dch-deep-review-followup-20260515.md) | completed | Closed REVIEW_9 follow-ups F1-F4. | [CHANGELOG_22](../../changelogs/history/CHANGELOG_22.md), [REVIEW_9](../../reviews/history/REVIEW_9.md) |
| 2026-05-15 | [dch-deep-review-20260515.md](dch-deep-review-20260515.md) | completed | Closed deep-review groups G1-G12. | [CHANGELOG_21](../../changelogs/history/CHANGELOG_21.md), [REVIEW_9](../../reviews/history/REVIEW_9.md) |
| 2026-05-14 | [dch-secrets-dedup-20260514.md](dch-secrets-dedup-20260514.md) | completed | Added secret deduplication and restore-time value filling. | [CHANGELOG_19](../../changelogs/history/CHANGELOG_19.md) |
| 2026-05-14 | [deep-review-fix-20260514.md](deep-review-fix-20260514.md) | completed | Landed REVIEW_8 round-one fixes and prepared round two. | [CHANGELOG_18](../../changelogs/history/CHANGELOG_18.md), [REVIEW_8](../../reviews/history/REVIEW_8.md) |
