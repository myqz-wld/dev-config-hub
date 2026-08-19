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
| 2026-07-31 | [CHANGELOG_41_hidden-config-file-picker.md](CHANGELOG_41_hidden-config-file-picker.md) | Showed dot-prefixed directories in the macOS config file picker. |
| 2026-07-31 | [CHANGELOG_40_config-file-scope-controls.md](CHANGELOG_40_config-file-scope-controls.md) | Added per-tool file scope controls with persistent overrides. |
| 2026-07-29 | [CHANGELOG_39_grok-build-global-rules.md](CHANGELOG_39_grok-build-global-rules.md) | Added Grok Build global instruction-file management. |
| 2026-07-27 | [CHANGELOG_38_profile-backup-workspaces.md](CHANGELOG_38_profile-backup-workspaces.md) | Separated tool profiles, cross-tool backups, and advanced settings. |
| 2026-07-27 | [CHANGELOG_37_profile-backup-policies.md](CHANGELOG_37_profile-backup-policies.md) | Added empty profiles, editable backup rules, and exact prepared exports. |
| 2026-07-20 | [CHANGELOG_36_user-config-catalog.md](CHANGELOG_36_user-config-catalog.md) | Added a five-tool user config catalog and four-tool profile support. |
