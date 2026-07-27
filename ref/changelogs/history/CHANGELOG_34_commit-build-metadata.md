---
changelog_id: 34
changed_at: 2026-06-24
---

# CHANGELOG_34: Commit build metadata

## Summary

Production Dev Config Hub builds now include source commit metadata, and the CLI can compare the installed app with the current source checkout by commit.

## Changes

- Added `scripts/write-build-info.ts`, generating `build/build-info.json` from Tauri app metadata and git state.
- Wired the generated build-info file into `build:fe` and Tauri bundle resources.
- Added `dch --version` and `dch --check-installed` for commit-based installed-package freshness checks.
- Documented the CLI commands and app-path override environment variables.
- Added the `CLAUDE.md` packaging invariant so future installable builds keep shipping metadata and freshness checks.

## Validation

- `bun scripts/write-build-info.ts`
- `bun run cli --version`
- `bun run cli --check-installed` against the current old `/Applications` install returned exit `2` for missing build metadata.
- Temporary `.app` simulation with generated `build-info.json`: `DCH_APP_PATH=<tmp app> bun run cli --check-installed` returned exit `0`.
- `bun test` (428 pass)
- `bunx tsc --noEmit`
- `bun run build:fe`
- `bunx tauri build --bundles app`
- Verified `src-tauri/target/release/bundle/macos/Dev Config Hub.app/Contents/Resources/build-info.json`.
- `DCH_APP_PATH="src-tauri/target/release/bundle/macos/Dev Config Hub.app" bun run cli --check-installed` returned exit `0`.
- `git diff --check`
