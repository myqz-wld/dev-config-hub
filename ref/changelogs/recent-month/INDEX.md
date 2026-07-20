# Recent Month Changelogs

## Scope

This bucket contains only changelogs that currently belong to this mutually exclusive date range. Remove rows for files moved to another bucket during rebucketing.

| Bucket | Date Range |
|---|---|
| `recent-3-days` | `changed_at` is within the last 3 days, inclusive |
| `recent-week` | Older than 3 days and within the last 7 days, inclusive |
| `recent-month` | Older than 7 days and within the last 30 days, inclusive |
| `history` | Older than 30 days, or missing a parseable date |

## Index Table

| changed_at | File | Summary (<= 80 chars) |
|---|---|---|
| 2026-06-24 | [CHANGELOG_34_commit-build-metadata.md](CHANGELOG_34_commit-build-metadata.md) | Packaged builds expose commit metadata and installed freshness checks. |
| 2026-06-19 | [CHANGELOG_33.md](CHANGELOG_33.md) | Unified the font stack and fixed the dark first-paint flash. |
| 2026-06-19 | [CHANGELOG_32.md](CHANGELOG_32.md) | Reworked the application shell into a handwritten paper style. |
