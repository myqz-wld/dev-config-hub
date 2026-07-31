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
- **Editable backup policies** — ordered file and secret rules at tool and profile scope.
- **Safe `.dchpack` migration** — exact preview and placeholder redaction by default.
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
creation stays in that tool context, while cross-tool backup and raw advanced
editing live in separate tabs. Switching replaces the tool root atomically.

## Backup And Restore

```bash
dch profile backup
dch profile backup --keep
dch profile backup --no-scripts
dch profile restore ~/.dch/backups/latest.dchpack
```

Profiles can inherit tool backup rules or keep an independent snapshot.
Switch-script rules cover only `~/.dch/scripts/`. Secrets are placeholder
redacted by default, `~/.agents/**` is never packaged, and restore follows the
package manifest without reapplying current rules. The desktop backup center
groups export choices by tool and caches both backup history and resolved
backup rules for fast reopening.

## Development

```bash
bunx tsc --noEmit
bun run build:fe
bun test
bunx tauri build --bundles app
cp -R "src-tauri/target/release/bundle/macos/Dev Config Hub.app" /Applications/
```

## Documentation

- [CLAUDE.md](CLAUDE.md) — repository workflow and invariants
- [AGENTS.md](AGENTS.md) — Codex entry-point instructions
- [ref/changelogs/INDEX.md](ref/changelogs/INDEX.md) — change history
- [ref/reviews/INDEX.md](ref/reviews/INDEX.md) — review records
