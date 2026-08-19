---
changelog_id: 41
changed_at: 2026-07-31
---

# CHANGELOG_41_hidden-config-file-picker: Visible dot directories in file selection

## Summary

The configuration-page file picker now starts at the user home directory and
shows dot-prefixed configuration directories by default on macOS, making files
under locations such as `~/.config` directly selectable.

## Changes

### Native picker

- Added a dedicated Tauri command for configuration-file selection.
- Used `NSOpenPanel` on the macOS main thread with `showsHiddenFiles` enabled,
  while preserving the Tauri dialog-plugin path on other desktop platforms.
- Declared the already-transitive macOS AppKit bindings as target-specific
  dependencies without changing non-macOS dependency resolution.

### Frontend and coverage

- Routed the configuration-page `添加文件` action through the dedicated bridge.
- Added component coverage proving a selected file below a dot-prefixed
  directory reaches the existing managed-file workflow.
- Corrected the component test's bridge mock path so the IPC boundary is
  actually isolated during tests.
- Documented the macOS picker behavior in the README.

## Validation

- `bunx tsc --noEmit` (clean)
- `bun run build:fe` (667 modules bundled)
- `bun test` (538 pass, 0 fail, 1,446 assertions across 46 files)
- `cargo check --manifest-path src-tauri/Cargo.toml` (clean)
- `cargo test --quiet --manifest-path src-tauri/Cargo.toml` (43 pass, 0 fail)
- `bun run dev` (frontend server, Rust rebuild, and desktop binary started)
- `git diff --check` (clean)
- Source/test size scan (all source files below 500 LOC; tests below 800 LOC)

## Do Not Split Protection

None. All changed source files remain below 500 lines and the changed test
remains below 800 lines.

## Notes

Visibility does not widen the managed-file security boundary: additions still
must resolve to existing regular files under the user home directory and the
existing symlink boundary checks remain in force.
