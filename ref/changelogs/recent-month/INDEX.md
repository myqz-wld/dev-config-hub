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
| 2026-07-20 | [CHANGELOG_36_user-config-catalog.md](CHANGELOG_36_user-config-catalog.md) | Added a five-tool user config catalog and four-tool profile support. |
| 2026-07-19 | [CHANGELOG_35_foundation-time-buckets.md](CHANGELOG_35_foundation-time-buckets.md) | Aligned foundation docs, removed conventions, and bucketed final records. |
