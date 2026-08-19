# Recent 3 Days Changelogs

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
| 2026-08-19 | [CHANGELOG_42_macos-install-canonicalization.md](CHANGELOG_42_macos-install-canonicalization.md) | Kept one discoverable app while preserving rollback artifacts. |
