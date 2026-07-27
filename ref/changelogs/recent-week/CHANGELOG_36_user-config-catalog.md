---
changelog_id: 36
changed_at: 2026-07-20
---

# CHANGELOG_36_user-config-catalog: Five-tool user configuration support

## Summary

Dev Config Hub now uses one user-level configuration catalog across the CLI and Tauri UI. Shell, Claude Code, and Codex coverage was completed, Grok Build and Cursor were added, and profile switching, backup, restore, and active-state handling now support Claude, Codex, Grok, and Cursor. Project and workspace configuration files remain intentionally excluded.

## Changes

### User-level configuration catalog

- Added a shared catalog and loader for Shell, Claude Code, Codex CLI, Grok Build, and Cursor so the CLI and desktop UI resolve the same files, labels, optional entries, and precedence rules.
- Added environment-aware roots for `ZDOTDIR`, `XDG_CONFIG_HOME`, `CODEX_HOME`, `GROK_HOME`, and platform-specific Cursor settings directories.
- Expanded Shell coverage to the selected Zsh, Bash, Fish, and dynamically discovered PowerShell CurrentUser files.
- Limited Claude Code to `~/.claude/settings.json` and `~/.claude/CLAUDE.md`; all tools exclude project and workspace files.
- Added effective Codex global-instruction selection, the documented Grok user/managed/requirements layers, and Cursor settings, keybindings, MCP, CLI permissions, and optional user hooks.
- Added JSONC and PowerShell editor modes, valid starter content for missing files, and compact hiding of absent optional files.

### Tauri and CLI integration

- Added a Tauri environment-discovery command that reuses the login-shell `PATH`, caches resolved roots, discovers Fish and PowerShell, and keeps file access limited to HOME or exact known configuration paths.
- Expanded version detection and navigation to all five tools, including the actual user shell and Cursor CLI/application fallbacks.
- Replaced the three separate CLI readers with the shared catalog adapter and added Grok/Cursor commands plus Shell aliases.
- Reloaded configuration panels immediately after a profile initialization or switch so the selected directory is reflected without changing focus.

### Profile, backup, and restore support

- Expanded profile types, schema defaults, CLI help, UI tabs, root status, and active-state handling from Claude/Codex to Claude/Codex/Grok/Cursor.
- Honored `CODEX_HOME` and `GROK_HOME` as switch roots while keeping Cursor editor settings/keybindings outside `~/.cursor` profile switching.
- Rejected cross-tool profile cloning and unknown manifest tools.
- Added Grok/Cursor runtime exclusions, Grok MCP whole-file credential handling, and structured JSONC redaction for safe-share backups.

### Documentation and platform target

- Corrected the architecture description to Tauri v2 with a Rust backend, React/TypeScript WebView frontend, and Bun frontend/CLI tooling.
- Recorded macOS as the GA target, with Windows and Linux remaining beta, and documented the exact user-level file catalog and official references.
- Synchronized the repository's profile-system invariants with the four supported profile tools while preserving the entry-specific `AGENTS.md` boundary.

## Validation

- `bunx tsc --noEmit` (clean)
- `bun run build:fe` (656 modules bundled)
- `bun test` (446 pass, 0 fail)
- `cargo check` (clean)
- `cargo test` (43 pass, 0 fail)
- `bun run dev` (frontend server, Rust build, and desktop binary started)
- `bun run cli --help` and `bun run cli profile current --json` (five tools and four profile roots present)
- Prompt-asset inventory, SHA-256 backup manifest, and post-edit hash refresh (clean)
- `git diff --check` (clean)

## Do Not Split Protection

None. All changed source files remain below 500 lines.

## Notes

Cursor's platform-specific editor `settings.json` and `keybindings.json` are displayed and editable but are not part of `~/.cursor` profile switching. Missing optional files are hidden until they exist. Windows real-machine end-to-end validation remains pending under the existing beta-platform policy.
