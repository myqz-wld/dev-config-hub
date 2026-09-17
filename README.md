# Dev Config Hub

Dev Config Hub is a local desktop app and CLI for viewing user-level developer
tool configuration and switching complete **Claude Code, Codex CLI, Grok
Build, and Cursor profiles**.

Built with Tauri v2, React, TypeScript, Rust, and Bun. macOS is the primary
platform; Windows 10+ and Linux are supported as beta platforms.

## What It Provides

- **Config viewer and editor** — per-tool file scopes, syntax highlighting, Markdown rendering, and external-change protection.
- **Atomic profile switching** — symlinks on macOS/Linux and NTFS junctions on Windows.
- **Per-profile automation** — environment variables, hooks, and hook timeouts.
- **Desktop and CLI workflows** — the same profile operations in both interfaces.

## Default Managed Scope

| Tool | User-level files |
|---|---|
| Shell | Zsh, Bash, Fish, and discovered PowerShell profiles |
| Claude Code | `~/.claude/settings.json`, `~/.claude/CLAUDE.md` |
| Codex CLI | `$CODEX_HOME/config.toml`, `AGENTS.override.md` or `AGENTS.md` |
| Grok Build | `$GROK_HOME/config.toml`, `$GROK_HOME/AGENTS.md`, and existing optional TOML files |
| Cursor | `~/.cursor/cli-config.json` |

These rows are factory defaults. In the desktop app, every tool page can add
an existing regular file under the user home directory, remove any listed file
from management without deleting it from disk, and restore that tool's default
range. Per-tool additions and removals are stored in
`~/.dch/config-files.json`; the desktop app and CLI read the same effective
range. Project/workspace-local files remain outside the defaults but can be
included explicitly when they are under the user home directory. The desktop
file picker starts at the home directory and, on macOS, shows dot-prefixed
configuration directories such as `~/.config` by default.

## Quick Start

Requirements: [Bun](https://bun.sh/) 1.1+ and [Rust](https://rustup.rs/) 1.77+.

```bash
bun install
bun link
bun run dev

dch                    # configuration overview
dch claude             # view one tool
dch edit <file>        # edit with $EDITOR
dch gui                # open the desktop app
dch --check-installed  # verify installed build freshness
```

## Profiles

```bash
dch profile init claude
dch profile add claude claude-work --dir ~/.claude-work
dch profile add claude existing --dir ~/configs/claude --existing
dch profile use claude-work
dch profile current claude
```

Profiles live in `~/.dch/profiles.json`. New profiles create only an empty
management directory; `--existing` registers a directory without copying or
modifying it. In the desktop app, each tool has its own profile tab; profile
creation stays in that tool context, and raw JSON editing has its own Advanced
Settings tab. Switching replaces the tool root atomically. Removing a profile
leaves its directory intact.

The profile store accepts only `version: 2`; unsupported or missing versions
are rejected without automatic conversion. Missing profile timeouts default to
30 seconds. Both shell-string and platform-specific object hooks are supported.
Ordinary saves retain the current profile fields and remove obsolete settings.
Existing archive files and configuration directories are left on disk.

## Development

```bash
bunx tsc --noEmit
bun run build:fe
bun test
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
bun run test:install:macos
bunx tauri build --bundles app
bun run install:macos
```

The macOS installer refuses to replace a running app, stages the bundle on the
destination volume, adds an ad-hoc signature when a local Tauri build only has
its linker signature, verifies the complete bundle with `codesign`, and
installs it with a fresh executable inode. The previous app remains in a
temporary rollback directory until verification succeeds, then that temporary
copy is removed. If installation fails before verification, the installer
restores the previous app. Existing historical copies are left untouched.
The generated build bundle is retained beside the build output with an
`.app-build` suffix, and the installed
`/Applications` bundle is refreshed as the canonical Launch Services
registration. The installer can reuse that non-application build archive until
the next build. Do not overwrite the installed bundle in place with `cp -R`:
macOS can terminate the next launch with `CODESIGNING / Invalid Page` even when
a later on-disk signature check succeeds.

The installer regression uses disposable source and destination directories;
it never replaces the installed app. Run profile switching tests only with a
disposable home and isolated `CODEX_HOME` / `GROK_HOME` values.

## Documentation

- [CLAUDE.md](CLAUDE.md) — repository workflow and invariants
- [AGENTS.md](AGENTS.md) — Codex entry-point instructions
- [ref/changelogs/INDEX.md](ref/changelogs/INDEX.md) — change history
- [ref/reviews/INDEX.md](ref/reviews/INDEX.md) — review records
