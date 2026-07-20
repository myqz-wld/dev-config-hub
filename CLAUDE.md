# CLAUDE.md

> Shared repository workflow for paired AI-coding entries.
> Put runtime or tool differences in `AGENTS.md` to avoid drift.

## Repository Baseline

- OS / package manager: primary development and test environment is macOS; use Bun consistently and do not mix npm, pnpm, or yarn. The product supports macOS, Windows 10+, and Linux.
- Runtime versions: Bun for TypeScript and frontend tooling; Rust >= 1.77 for the Tauri v2 backend.
- Special environment constraints: profile switching uses POSIX symlinks on macOS/Linux and NTFS junctions on Windows.
- Before changing either `CLAUDE.md` or `AGENTS.md`, audit the other entry at the same time so their rule semantics stay aligned.

## Base Directory Structure

Create or maintain files in this structure. Do not create parallel directories for the same file type unless the project already has a stronger project rule.

- `CLAUDE.md`: shared workflow for repository baseline, directory structure, after-change requirements, plan/review lifecycle, review expiry, file-size guardrail, project-specific triggers, archived reference materials, and validation.
- `AGENTS.md`: entry and tool differences; it references and follows the shared rules in `CLAUDE.md`.
- `UI_COPY_LANGUAGE.md`: SSOT for user-facing UI/CLI copy language and locale mode.
- `README.md`: user and maintainer instructions for setup, usage, validation, and structure.
- `src/`: Bun/React frontend, CLI, profile business logic, and tool config readers.
- `src-tauri/`: Tauri v2 Rust backend. `src-tauri/target/` is standard Cargo/Tauri output and stays git ignored.
- `scripts/`: project scripts and automation helpers, including copied foundation helpers.
- `build/`: selected frontend build output root; generated frontend artifacts live under `build/fe/`, and the root stays git ignored.
- `ref/changelogs/INDEX.md`: final changelog routing index; new final changelogs use `ref/changelogs/<bucket>/CHANGELOG_X_<topic>.md`.
- `ref/reviews/INDEX.md`: final review routing index; new final reviews use `ref/reviews/<bucket>/REVIEW_X_<topic>.md`.
- `ref/plans/INDEX.md`: final plan routing index; new final plans use `ref/plans/<bucket>/PLAN_X_<topic>.md`.
- `ref/*/{recent-3-days,recent-week,recent-month,history}/INDEX.md`: mutually exclusive time-bucket indexes for final records.
- Existing historical record filenames remain unchanged; new records follow the numbered naming rules in their root indexes.
- `.ref/`: keep in `.gitignore`; store non-final plans, reviews, raw outputs, spike drafts, scratch notes, and other unarchived LLM-facing material here, never final records.

## Required After Changes

Before starting, run `find ref/changelogs ref/plans ref/reviews -maxdepth 2 -type f -name '*.md' 2>/dev/null || true` to see existing records. Missing directories are setup work, not an error. Before creating or moving any final typed `ref/` record, read the relevant root `ref/<type>/INDEX.md` and every affected bucket `INDEX.md`; those copied project files are the naming, bucket, and rebucketing source of truth. Scan every same-type bucket directory, choose `X` as the maximum existing same-type number plus 1, and do not guess. Use a short stable kebab-case `<topic>` that is not vague like `update`, `fix`, or `misc`.

1. When user-visible behavior, file structure, startup steps, ports, dependencies, or validation steps change, update the matching `README.md` section. Pure bug fixes and internal refactors do not require README changes.
2. For each meaningful feature, behavior, API, dependency, setup, or foundation change, write `ref/changelogs/<bucket>/CHANGELOG_X_<topic>.md`, rebucket all changelogs by `changed_at`, and update `ref/changelogs/INDEX.md` plus every affected bucket `INDEX.md`. For debug, performance, security, or review-driven fixes, write `ref/reviews/<bucket>/REVIEW_X_<topic>.md`, rebucket all reviews by `reviewed_at`, and update `ref/reviews/INDEX.md` plus every affected bucket `INDEX.md`. Keep index summaries to 80 characters or one short sentence.
3. Keep non-final plans in the current environment's plan workspace; if no stronger contract exists, use `<repo>/.ref/plans/<plan-id>.md`. Keep non-final review drafts and raw reviewer output in the current review workspace; if no stronger contract exists, use `<repo>/.ref/reviews/<review-id>.md` or session output. At final handoff, archive terminal plans to `ref/plans/<bucket>/PLAN_X_<topic>.md`, rebucket all plans by completed date, update `ref/plans/INDEX.md` plus every affected bucket `INDEX.md`, and clean up workspace copies.
4. Store archived LLM-facing extra materials, including spike documents, investigation notes, architecture notes, and reusable evidence, somewhere under `ref/` and link them from the relevant final record when applicable. Keep temporary scratch, raw logs, and non-final drafts in `.ref/` or the current environment workspace.
5. Keep the advisory `.ref` archive pre-commit hook installed by running `bash scripts/ref-archive-reminder-pre-commit.sh --install` after setup or whenever `.git/hooks/pre-commit` is reset. The installer creates or replaces only its managed block and preserves unrelated hook logic. The hook classifies unarchived `.ref/` files and exits 0; act on its checklist or explicitly justify material left in `.ref/`.

Small changes limited to one topic and one or two files may append to the latest applicable record and refresh its date; large or cross-module changes require the next numbered record. Changelogs contain concise outcome-oriented summaries, not pitfall details or reasoning traces. Reviews preserve the configured reviewer method, evidence, and three-state adjudication.

Project-specific triggers:

- Before modifying a feature area, inspect all three typed record trees and read the relevant changelogs, reviews, and plans so prior decisions are not silently reversed.
- Before adding or changing user-facing UI/CLI copy, read `UI_COPY_LANGUAGE.md`.
- After changing `src-tauri/**`, rerun `bun run dev` so the Rust backend rebuilds.

## UI/CLI Copy Language

Write active project documentation and maintainer/agent-facing instructions in English by default, including changelogs, plans, reviews, and archived reference materials. Exceptions are `UI_COPY_LANGUAGE.md`, user-facing UI/CLI copy governed by that file, locale examples, quoted/source text, and explicit non-English trigger anchors or examples.

Before adding or changing user-facing UI or CLI copy, read `UI_COPY_LANGUAGE.md` and follow its active mode. If the requested copy language or supported locales differ from that file, update `UI_COPY_LANGUAGE.md` first, then make the UI/CLI copy changes.

## Project-Specific Invariants

### Bun First; Do Not Introduce Node-Synonym Tools

`tsconfig.json` already anchors types and runtime to Bun. All equivalent tools must use Bun's built-ins:

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`.
- Use `bun test` instead of Jest or Vitest.
- Use `bun build <file.html|file.ts|file.css>` instead of webpack or esbuild.
- Use `bun install`, `bun run <script>`, and `bunx <pkg>`; do not mix npm, pnpm, or yarn.
- Bun loads `.env` automatically; do not introduce dotenv.
- Use `Bun.serve()` for HTTP, `bun:sqlite` for SQLite, `Bun.file` for file IO, and `Bun.$` for subprocesses instead of synonym dependencies.

The frontend uses Bun HTML imports and the built-in bundler with automatic React, CSS, and Tailwind support; do not introduce Vite.

### Profile System: Symlink/Junction Is The Only Switching Channel

- The profile roots are `~/.claude`, `$CODEX_HOME` or `~/.codex`, `$GROK_HOME` or `~/.grok`, and `~/.cursor`. Each points to a `<configDir>` through filesystem indirection: POSIX symlink on macOS/Linux and NTFS junction on Windows. `dch profile use <id>` performs atomic replacement with temporary-name creation and rename. Windows junction targets must be absolute directory paths on the same volume.
- Before the first switch, `dch profile init <tool>` moves the existing real directory to `~/.<tool>-default`, links back to it, and registers it as the default profile.
- Env-only switching is forbidden. Do not add a path that skips symlink/junction switching and changes only environment variables or one config file; it leaks across working directories and is not equivalent across tools.
- Cursor profile switching covers `~/.cursor` only. Its platform-specific editor `settings.json` and `keybindings.json` remain display/edit-only and must not be folded into the profile root.
- Switching runs `preSwitch` with `profile.env`, aborts without changing active state on failure, atomically swaps the link, writes `active.<tool>` to `~/.dch/profiles.json`, then runs `postSwitch` as warning-only.

### Backup And Restore (`.dchpack`)

- Backups are safe-share by default: sensitive values become `<<DCH_PLACEHOLDER:KEY_NAME>>`. Raw-token backup requires explicit `--no-placeholder` handling and external encryption.
- `manifest.secrets_index` is the restore fan-out source of truth. It must not contain `valueHash` or real secret values; hashes may exist only as transient in-memory grouping data during backup.
- Restore fills each logical secret once and fans it out by `fieldPath`. Whole-file credentials such as `auth.json` and `credentials.json` remain per-location placeholders, and `profile.env` sections may require manual `~/.dch/profiles.json` edits after restore.
- Do not follow symlinks inside profile config directories. Keep path-boundary checks and case-insensitive excludes for runtime, cache, history, database, log, lock, backup, private-key, and maintenance files.
- UI secret fill crosses the Tauri Rust tempfile route only once with restrictive permissions and guaranteed cleanup; webview TypeScript must not receive the tempfile path.
- Backup include/exclude and sensitive-field rules live in `src/profiles/backup-rules.ts`; update that source and matching tests when package semantics change.

### Dual Injection Path For `profile.env`

By default, `profile.env` is visible only inside `preSwitch` and `postSwitch` scripts. To also inject it into the selected Claude, Codex, Grok, or Cursor process:

- Recommended: `dch profile env <tool>` emits shell-eval format for a POSIX or PowerShell wrapper around the selected tool executable.
- Claude Code only: write env into the `env` block in `<configDir>/settings.json` as an alternative to a shell wrapper.

`dch profile env` validates keys against `^[A-Za-z_][A-Za-z0-9_]*$`, single-quotes and escapes values, and must prevent shell injection because the wrapper directly evaluates this output. Empty active state or env produces no output so the wrapper falls through naturally.

### Hook-Injected Environment Variables

The `preSwitch` and `postSwitch` contract injects:

```text
DCH_PROFILE_ID         profile id being switched to
DCH_PROFILE_TOOL       claude | codex | grok | cursor
DCH_PROFILE_CONFIG_DIR absolute path of that profile
DCH_SWITCH_TO          target profile id (same as DCH_PROFILE_ID)
DCH_SWITCH_FROM        previous active profile id (may be empty after first init)
```

Do not rename these variables or hardcode absolute paths in scripts. A nonzero `preSwitch` exit aborts the switch, leaves active state unchanged, and skips `postSwitch`.

### Tauri / Frontend Boundary

- The frontend lives in `src/client/` and calls Tauri commands through `bridge.ts`. Backend entry `src-tauri/src/lib.rs` performs only Tauri Builder setup and command registration; concrete IPC implementations live in `src-tauri/src/commands/`.
- The CLI is the single operation entry: every UI profile operation uses `run_dch_command` to call CLI subcommands. Do not duplicate profile logic in Rust.
- Do not use `window.confirm`; Tauri 2 webviews do not show native confirm dialogs. Use inline UI state.
- Frontend forms collect pre-hook, post-hook, and model config in one pass; do not split this into a multi-step guide.

### Config File Display And Editing

Tool config files such as `~/.claude/settings.json`, `~/.codex/config.toml`, and `~/.zshrc` have only three ConfigPanel modes:

- **view**: default except for Markdown; CodeMirror 6 read-only with syntax highlighting.
- **edit**: CodeMirror 6 writable with save and TOCTOU external-modification detection.
- **render**: Markdown only; react-markdown with GFM and Shiki code blocks.

Do not reintroduce list mode, schema-driven inline editing, or field controls. The only schema residue is linting for the `~/.dch/profiles.json` edit modal: `src/schemas/dch-store.ts` and `src/client/components/editor/schema-lint.ts` use codemirror-json-schema. This internal constraint is unrelated to tool config schemas.

## Review Expiry And Minimum Re-Review Scope

Use this section to determine the minimum scope for the next review. `ref/reviews/` records expiring coverage; it is not a permanent exemption list.

The next review's minimum scope is:

```text
unreviewed files union expired reviewed files union scope_unknown files
```

`scope_unknown files` are files whose previous review coverage cannot be trusted because the review lacks a parseable `review-scope`, lacks a usable `baseline_commit`, or cannot be mapped to the current path.

Since the latest REVIEW `baseline_commit` that covered a file, that file expires when any condition is true:

- Net change is at least `min(200 lines, 30% of current LOC)`.
- At least 3 distinct commits touched the file.
- At least 90 days have passed and the file changed at least once.
- REVIEW frontmatter sets `expired: true`.

Before review, run `bash scripts/file-level-review-expiry.sh` from the repository root. If the script is missing, use `git log` to apply the conditions above manually.

## File-Size Guardrail (500 LOC)

Before submitting, attempt to split any source file over 500 LOC, including comments and blank lines. Generated code, lockfiles, snapshots, migrations, and fixtures are exempt. Test files and individual changelog/review records may be relaxed to 800 lines; above 800, split by topic when practical. New source files must stay within 500 lines from their first commit.

Split in this order:

1. Extract module-level pure functions, types, and constants.
2. Move same-directory submodules behind stable import paths.
3. Split classes through a facade and shared context only after a plan or review.

When a file truly cannot be split, record the path, concrete reason, and revisit trigger in the relevant final record: use the changelog's "Do Not Split Protection" for feature, behavior, API, or dependency changes, or the review's "Residual Risk" for debug, performance, security, or review-driven work.

## Validation Flow

```bash
bunx tsc --noEmit
bun run build:fe
bun test
```

For an end-to-end desktop smoke, run `bun install`, `bun run dev`, and `bun run cli`. After changing `src-tauri/**`, rerun `bun run dev` so the Rust backend rebuilds; frontend-only changes reload through HMR.

Profile switching smoke is manual and destructive to its home directory. Run it only with an isolated disposable home:

```bash
DCH_SMOKE_ROOT="$(mktemp -d)"
env HOME="$DCH_SMOKE_ROOT" bun run cli profile init claude
env HOME="$DCH_SMOKE_ROOT" bun run cli profile add claude claude-test --dir "$DCH_SMOKE_ROOT/.claude-test" --desc "smoke"
env HOME="$DCH_SMOKE_ROOT" bun run cli profile use claude-test
env HOME="$DCH_SMOKE_ROOT" bun run cli profile current claude
env HOME="$DCH_SMOKE_ROOT" bun run cli profile use claude-default
env HOME="$DCH_SMOKE_ROOT" bun run cli profile remove claude-test --yes
```

## Deployment / Packaging

Build and install the macOS app locally with:

```bash
bunx tauri build --bundles app
cp -R "src-tauri/target/release/bundle/macos/Dev Config Hub.app" /Applications/
```

Dev Config Hub ships as an installable Tauri desktop app with a `dch` CLI entry:

- Packaging must generate and ship `build-info.json` with at least app/package name, semantic version when available, full git commit, short commit, branch when available, dirty flag when determinable, and build timestamp.
- The installed artifact keeps `build-info.json` in app resources and exposes both human-readable status through `dch --version` and machine-checkable freshness through `dch --check-installed`.
- The freshness check compares installed metadata with the current source checkout commit, may compare local `origin/main`, never fetches remotes, and reports missing metadata separately from a commit mismatch.
