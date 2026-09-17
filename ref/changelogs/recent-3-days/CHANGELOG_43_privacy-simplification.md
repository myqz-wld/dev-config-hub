---
changelog_id: 43
changed_at: 2026-09-16
---

# Remove Backup Features And Unneeded Compatibility

## Summary

Configuration management now focuses on profiles and file editing. Archive
export, import, history, pinning, backup policies, preview and secret filling
have been removed. Existing archives and user configuration directories are
left untouched.

## Changes

- Removed the backup UI, CLI commands, TypeScript engines, caches, persisted
  fields, schema entries, Rust secrets-tempfile IPC, private styles and tests.
  Ordinary profile updates and timeout handling moved to dedicated modules.
- Preserved four tool tabs, Advanced Settings, create/manage/edit/switch/remove,
  environment display and export, both hook forms, and file-list defaults.
- Accept only v2 profile stores. Unsupported versions reject explicitly;
  normal saves retain current fields and current timeout/active defaults.
- Removed command-string version probes, obsolete exports and component aliases,
  dead helpers/styles and the unused Rust path-policy variant.
- File editing requires a read timestamp baseline. Removed the old unchecked
  save endpoint while retaining atomic writes, conflict notices and explicit
  overwrite decisions.
- The macOS installer keeps the previous app only during installation. It
  removes that temporary copy after verification or restores it on failure.
  Signing, fresh-inode replacement, running-app refusal and `.app-build` reuse
  remain. Existing historical copies are neither migrated nor deleted.
- Removed four unused direct dependencies: `ajv`, `ajv-formats`, `jsonc-parser`
  and `smol-toml`. Syntax highlighting and the active store lint remain.
- Updated repository instructions and README. Verified the identical privacy
  section already added to the three user-level agent instruction files.
- Rewrote confirmed personal paths in reachable local history, preserved
  authors and commit metadata, and remapped current record references.

## Validation

TypeScript, frontend build, 230 Bun tests, Rust check and 42 Rust tests pass.
Isolated installer regressions and four-tool CLI smoke pass. The isolated
Tauri development backend rebuilt and started. Browser operations timed out;
rendered component tests cover interactions, but visual verification is pending.

## Do Not Split Protection

None. All current source files meet the 500-line guardrail; tests meet their
800-line limit.

## Related Records

- [Completion audit](../../reviews/recent-3-days/REVIEW_19_privacy-simplification.md)
- [Approved scope and publication boundary](../../plans/recent-3-days/PLAN_3_privacy-simplification.md)
