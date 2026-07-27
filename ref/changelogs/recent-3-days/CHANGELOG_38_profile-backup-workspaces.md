---
changelog_id: 38
changed_at: 2026-07-27
---

# CHANGELOG_38_profile-backup-workspaces: Profile and backup workspace clarity

## Summary

The profile page now separates tool-specific management from cross-tool backup
and advanced operations. Backup policies reopen from a safe short-lived cache,
the profile form follows a clearer directory-first layout, and the desktop
directory picker has the Tauri capability it needs.

## Changes

### Profile and backup workspaces

- Kept profile creation, active status, tool backup rules, and profile cards
  inside the Claude, Codex, Grok, or Cursor tab that owns them.
- Moved export, backup history, import, and global switching-script backup
  rules into a dedicated Backup Center tab.
- Moved raw `~/.dch/profiles.json` editing into a separately labeled Advanced
  Settings tab.
- Grouped export choices by tool and explicitly described `.dchpack` export as
  a cross-tool operation.

### Profile form

- Fixed new profiles to the tool tab from which creation was opened instead of
  offering a contradictory tool selector inside the modal.
- Reordered creation around directory intent, essential profile information,
  and one collapsed optional automation section.
- Showed the native directory picker only for managing an existing directory
  or changing an existing profile's directory.
- Added inline ID, path-purpose, and directory-safety guidance while preserving
  the existing single-submit workflow and manager-layer validation.

### Backup policy cache

- Added a target-keyed module cache for tool, profile, and switching-script
  policies with the same 30-second freshness window as backup history.
- Cloned cached policies so unsaved table edits cannot mutate shared cache
  state.
- Kept stale-cache refreshes silent, prevented refresh responses from
  overwriting edits already started in the modal, and invalidated dependent
  entries after policy mutations.

### Desktop directory dialog

- Added a least-privilege main-window Tauri capability containing
  `dialog:allow-open`, resolving the ACL rejection from the existing-directory
  picker without enabling the plugin's unrelated dialog commands.

### Documentation and regression coverage

- Updated the README to describe tool-owned profile tabs and the cross-tool
  backup workspace.
- Added component, cache, tab-boundary, export-grouping, and capability
  regression tests.

## Validation

- `bunx tsc --noEmit` (clean)
- `bun run build:fe` (666 modules bundled)
- `bun test` (529 pass, 0 fail, 1,411 assertions across 45 files)
- `cargo check --manifest-path src-tauri/Cargo.toml` (clean)
- Tauri debug backend rebuild and launch through `cargo run` (clean)
- `bash scripts/file-level-review-expiry.sh` (completed)
- `git diff --check` (clean)
- Source/test size scan (no source above 500 LOC; no test above 800 LOC)

## Do Not Split Protection

None. The largest changed source files remain below 500 LOC.

## Notes

The in-app browser bootstrap still fails with the previously tracked
`Cannot redefine property: process` runtime issue. UI behavior was validated
with rendered component interactions, structural CSS assertions, a production
frontend bundle, and a rebuilt Tauri application.

Related review:
[REVIEW_16_profile-backup-workspace](../../reviews/recent-3-days/REVIEW_16_profile-backup-workspace.md).
