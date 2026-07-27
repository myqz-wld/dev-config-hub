# History Changelogs

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
| 2026-06-18 | [CHANGELOG_31.md](CHANGELOG_31.md) | Aligned root instructions with the foundation templates. |
| 2026-06-16 | [CHANGELOG_30.md](CHANGELOG_30.md) | Reworded UI copy around user goals instead of internal fields. |
| 2026-06-16 | [CHANGELOG_29.md](CHANGELOG_29.md) | Changed backup selection to directory semantics with exclusions. |
| 2026-06-11 | [CHANGELOG_28.md](CHANGELOG_28.md) | Deduplicated entry docs and removed stale README content. |
| 2026-06-11 | [CHANGELOG_27.md](CHANGELOG_27.md) | Added review-expiry rules and the first expiry helper. |
| 2026-06-11 | [CHANGELOG_26.md](CHANGELOG_26.md) | Aligned foundation entries and reference indexes. |
| 2026-06-09 | [CHANGELOG_25.md](CHANGELOG_25.md) | Split oversized tests and checked local-state residue. |
| 2026-06-09 | [CHANGELOG_24.md](CHANGELOG_24.md) | Added the AGENTS entry and enforced source-file guardrails. |
| 2026-05-26 | [CHANGELOG_23.md](CHANGELOG_23.md) | Migrated frontend output from dist to build/fe. |
| 2026-05-15 | [CHANGELOG_22.md](CHANGELOG_22.md) | Closed REVIEW_9 follow-up items F1 through F4. |
| 2026-05-15 | [CHANGELOG_21.md](CHANGELOG_21.md) | Landed two deep-review rounds and G1-G12 fixes. |
| 2026-05-15 | [CHANGELOG_20.md](CHANGELOG_20.md) | Exposed backup secret-dedup details in the UI. |
| 2026-05-14 | [CHANGELOG_19.md](CHANGELOG_19.md) | Added global secret deduplication and restore-time value filling. |
| 2026-05-14 | [CHANGELOG_18.md](CHANGELOG_18.md) | Closed two deep-review rounds and their fix passes. |
| 2026-05-13 | [CHANGELOG_17.md](CHANGELOG_17.md) | Added default, pinned, and historical backup tiers. |
| 2026-05-13 | [CHANGELOG_16.md](CHANGELOG_16.md) | Added safe-share backup and restore through .dchpack files. |
| 2026-05-13 | [CHANGELOG_15.md](CHANGELOG_15.md) | Removed process spawns from return-to-window refreshes. |
| 2026-05-12 | [CHANGELOG_14.md](CHANGELOG_14.md) | Removed schema-driven config editing and simplified forms. |
| 2026-05-12 | [CHANGELOG_13.md](CHANGELOG_13.md) | Deduplicated Profile-tab IPC and made ProfilePanel controlled. |
| 2026-05-12 | [CHANGELOG_12.md](CHANGELOG_12.md) | Fixed profile-switch freezes across Bun and Rust boundaries. |
| 2026-05-11 | [CHANGELOG_11.md](CHANGELOG_11.md) | Kept panels mounted and paused polling for hidden panels. |
| 2026-05-11 | [CHANGELOG_10.md](CHANGELOG_10.md) | Added focus and mtime-based config/profile refresh. |
| 2026-05-07 | [CHANGELOG_9.md](CHANGELOG_9.md) | Added local schema overrides and field hiding. |
| 2026-05-06 | [CHANGELOG_8.md](CHANGELOG_8.md) | Added schema editing, CodeMirror, and Markdown rendering. |
| 2026-05-04 | [CHANGELOG_7.md](CHANGELOG_7.md) | Landed the first comprehensive-review fixes and tests. |
| 2026-05-04 | [CHANGELOG_6.md](CHANGELOG_6.md) | Added Windows paths, junctions, hooks, and readers. |
| 2026-04-27 | [CHANGELOG_5.md](CHANGELOG_5.md) | Replaced native confirm and unified profile creation fields. |
| 2026-04-26 | [CHANGELOG_4.md](CHANGELOG_4.md) | Added shell-wrapper injection for active profile.env values. |
| 2026-04-26 | [CHANGELOG_3.md](CHANGELOG_3.md) | Removed env-only switching and standardized on symlinks. |
| 2026-04-26 | [CHANGELOG_2.md](CHANGELOG_2.md) | Fixed env-mode leakage by also swapping the symlink. |
| 2026-04-25 | [CHANGELOG_1.md](CHANGELOG_1.md) | Added profile switching, CLI/UI entry points, and hooks. |
