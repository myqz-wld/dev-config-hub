---
changelog_id: 39
changed_at: 2026-07-29
---

# CHANGELOG_39_grok-build-global-rules: Grok Build global instructions

## Summary

Dev Config Hub now labels the Grok tool as Grok Build and manages its
user-level `AGENTS.md` alongside the existing configuration layers. The desktop
path policy recognizes the file under custom `GROK_HOME` locations, and the
current machine has a Grok Build instruction file aligned with its Claude Code
and Codex CLI counterparts.

## Changes

### Configuration catalog

- Renamed the Grok configuration tab to Grok Build.
- Added `$GROK_HOME/AGENTS.md` as a user-level Markdown configuration file so
  it supports the existing render, source, edit, create, and external-change
  protection flows.
- Kept `config.toml`, `managed_config.toml`, and `requirements.toml` behavior
  unchanged.

### Desktop boundary and machine instructions

- Added `$GROK_HOME/AGENTS.md` to the Tauri known-config-file policy so custom
  roots outside HOME can be read and written without widening the filesystem
  boundary.
- Created `~/.grok/AGENTS.md` with the same machine runtime rules used by the
  existing Claude Code and Codex CLI global instruction files, while preserving
  a Grok Build-specific identity line.
- Documented the new managed file in the supported-scope table.

### Record maintenance

- Rebucketed `CHANGELOG_36_user-config-catalog.md` from `recent-week` to
  `recent-month` based on its unchanged `changed_at` date.

## Validation

- `grok inspect --json` (Grok Build 0.2.114 discovered `~/.grok/AGENTS.md` as
  a global `agents_md` source)
- `bun test src/config-locations.test.ts` (9 pass, 0 fail)
- `bunx tsc --noEmit` (clean)
- `bun run build:fe` (666 modules bundled)
- `bun test` (529 pass, 0 fail)
- `cargo check` (clean)
- `cargo test` (43 pass, 0 fail)
- `bun run dev` (frontend server, Rust build, and desktop binary started)

## Do Not Split Protection

None. All changed source files remain below 500 lines.

## Notes

This manages Grok Build global rules that are appended to its agent context; it
does not replace the product's built-in system prompt through
`--system-prompt-override`.
