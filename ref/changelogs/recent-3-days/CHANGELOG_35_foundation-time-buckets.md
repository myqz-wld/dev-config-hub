---
changelog_id: 35
changed_at: 2026-07-19
---

# CHANGELOG_35_foundation-time-buckets: Current foundation structure

## Summary

The repository foundation now uses mutually exclusive time buckets for final changelogs, reviews, and plans. Its entry documents and indexes follow the foundation templates' section order and house style. The obsolete conventions tally/promotion mechanism was removed, while Dev Config Hub's concrete engineering invariants remain in the shared workflow.

## Changes

### Repository workflow and documentation

- Reordered `CLAUDE.md` to the foundation template sequence, compacted the required-after-change workflow, and retained the project-specific Bun, Tauri, profile, backup, and config invariants.
- Aligned `AGENTS.md` and `UI_COPY_LANGUAGE.md` with their template headings and writing style without changing entry ownership or the active `zh-CN` product-copy policy.
- Routed typed final records through root and bucket indexes, classified all `.ref/` workspace material, and required parseable review baselines for expiry checks.
- Updated the README structure tree and historical record link for the bucketed layout.
- Removed `ref/conventions/`, its candidate tally, and the repeated-feedback promotion workflow at the user's request.

### Final record archive

- Created `recent-3-days`, `recent-week`, `recent-month`, and `history` buckets plus indexes for changelogs, reviews, and plans.
- Preserved historical filenames, backfilled parseable dates, moved each record to its current bucket, and repaired internal Markdown links.
- Converted the three root indexes into routing-policy indexes; per-record rows now live only in bucket indexes.
- Normalized root and bucket index boilerplate to the foundation templates while preserving actual record rows and relative Markdown links.

### Foundation helpers

- Updated `scripts/file-level-review-expiry.sh` to scan nested review buckets and require a usable frontmatter `baseline_commit` before a record can exempt files.
- Replaced the plan-only reminder with `scripts/ref-archive-reminder-pre-commit.sh`, which classifies all unarchived `.ref/` files and remains advisory.

## Validation

- `bash -n scripts/file-level-review-expiry.sh scripts/ref-archive-reminder-pre-commit.sh` (clean)
- `bash scripts/file-level-review-expiry.sh` (nested review scan completed)
- `bash scripts/ref-archive-reminder-pre-commit.sh --install` (single managed hook block)
- Foundation templates: `AGENTS.md` and all three root indexes match exactly; 12 bucket index boilerplates match after substituting the bucket label
- Bucket/index/frontmatter consistency: 35 changelogs, 11 reviews, and 6 plans passed
- Local Markdown links: 71 files passed
- `bun test` (428 pass, 0 fail)
- `bunx tsc --noEmit` (clean)
- `bun run build:fe` (652 modules bundled)
- `git diff --check` (clean)

## Do Not Split Protection

None.

## Notes

Historical changelog dates were backfilled from original Git addition dates or adjacent feature records when no distinct add event remained; explicit review and plan completion dates were retained when available. Historical record bodies were intentionally left unchanged during template-style alignment.
