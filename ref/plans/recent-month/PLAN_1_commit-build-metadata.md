---
plan_id: commit-build-metadata
status: completed
completed_at: 2026-06-24
---

# PLAN_1: Commit Build Metadata

## Status

Completed on 2026-06-24.

## Goal

Let a packaged Dev Config Hub app expose the commit it was built from and let `dch` compare that installed commit with the current source checkout.

## Scope

- Generate `build/build-info.json` before frontend/Tauri packaging.
- Bundle that file as a Tauri resource.
- Add `dch --version` and `dch --check-installed`.
- Document and archive the behavior.

## Decisions

- Commit equality is the freshness check. Dirty flags are displayed as context.
- `--version` is informational and exits `0`; `--check-installed` exits `0`, `1`, or `2` for match, mismatch, or missing installed metadata.
- The check uses local git refs and does not fetch remotes.

## Validation

See [CHANGELOG_34_commit-build-metadata](../../changelogs/recent-month/CHANGELOG_34_commit-build-metadata.md).
