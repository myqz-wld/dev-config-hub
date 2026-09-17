# Recent 3 Days Plans

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
| 2026-09-16 | [PLAN_3_privacy-simplification.md](PLAN_3_privacy-simplification.md) | local complete; publication pending | Removed backups, simplified compatibility, and cleaned reachable local history. | [CHANGELOG_43](../../changelogs/recent-3-days/CHANGELOG_43_privacy-simplification.md), [REVIEW_19](../../reviews/recent-3-days/REVIEW_19_privacy-simplification.md) |
