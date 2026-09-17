---
changelog_id: 40
changed_at: 2026-07-31
---

# CHANGELOG_40_config-file-scope-controls: Per-tool managed file controls

## Summary

Every configuration page can now add existing files to its managed range,
remove listed files without deleting them from disk, and restore the tool's
factory range. The desktop app and CLI resolve the same persistent per-tool
overrides while retaining environment-aware factory defaults.

## Changes

### Managed file range

- Added a versioned `~/.dch/config-files.json` store containing per-tool file
  additions and factory-file removals.
- Applied overrides as deltas over the live Shell, Claude Code, Codex CLI,
  Grok Build, and Cursor definitions so environment-dependent roots and
  factory updates remain authoritative.
- Allowed manually selected regular files under the user home directory and
  ignored tampered arbitrary outside-HOME additions before loading them.
- Inferred JSON, JSONC, TOML, Markdown, PowerShell, or plain-text editor modes
  from the selected filename and retained the existing read, render, edit,
  create, and external-change protection flows.
- Made the CLI read the same effective managed range as the desktop app.

### Configuration-page controls

- Added native file selection, per-file `移出管理` actions, a custom-range
  badge, and a per-tool `恢复默认范围` action to every configuration page.
- Clarified in action text and success feedback that removing or restoring
  management entries never deletes or modifies the underlying files.
- Added an empty-range explanation and responsive wrapping for page actions,
  long paths, and file-card controls at the minimum supported window width.

### Persistence safety and coverage

- Reused atomic mtime compare-and-swap writes for the override store and
  reloads external changes before asking the user to retry a conflicting
  management action.
- Serialized management writes in the desktop app and derived every change
  from the latest mtime-bound snapshot so a long-running file picker cannot
  reapply stale additions or removals.
- Rejected malformed or unsupported override stores instead of silently
  falling back and overwriting them.
- Added pure merge/store tests plus component coverage for remove, restore,
  custom-range, and empty-range behavior.
- Updated the README to distinguish the factory default range from explicit
  user-managed additions.

### Record maintenance

- Rebucketed changelogs 37 and 38 from `recent-3-days` to `recent-week` based
  on their unchanged `changed_at` dates.

## Validation

- `bunx tsc --noEmit` (clean)
- `bun run build:fe` (667 modules bundled)
- `bun test` (537 pass, 0 fail, 1,444 assertions across 46 files)
- `bun run dev` (frontend server, Rust dev build, and desktop binary started)
- Browser-localhost probe confirmed the expected Tauri IPC boundary; component
  tests cover the configuration-page controls outside the native WebView.
- Changed-source size scan (all source files below 500 LOC; tests below 800 LOC)

## Do Not Split Protection

None. All changed source files remain below 500 lines.

## Notes

The file picker deliberately accepts existing files only. Arbitrary files
outside the user home directory remain unavailable unless they are already an
exact environment-resolved factory configuration path. Restoring defaults
clears only one tool's override entry and preserves every disk file.
