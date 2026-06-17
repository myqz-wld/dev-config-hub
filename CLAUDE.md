# CLAUDE.md

> This file is the repository-level shared SSOT for Dev Config Hub. It records the repository foundation, directory architecture, post-change requirements, plan/review lifecycle, review expiry rules, file-size guardrails, project-specific invariants, and validation workflow.
> `AGENTS.md` is the companion entry. It records only runtime/tooling mechanism differences; shared rules live here to avoid drift between the two entries.

## Repository Foundation

- macOS environment (Tauri depends on WebKit; profile-switching semantics closely follow the macOS filesystem)
- Package manager/runtime: **use Bun consistently** (do not mix npm / pnpm / yarn)
- Rust >= 1.77 (Tauri v2 backend)
- Before changing either `CLAUDE.md` or `AGENTS.md`, audit the other entry at the same time so their rule semantics stay aligned

## Base Directory Architecture

When creating or maintaining the repository, place files according to this structure. Unless the project already has a stronger contract, do not create parallel directories for the same kind of file:

- `CLAUDE.md`: shared project SSOT (this file).
- `AGENTS.md`: entry/tooling mechanism differences; references the shared rules in this file.
- `UI_COPY_LANGUAGE.md`: language rules for user-visible UI/CLI copy. New or changed user-facing UI/CLI copy must follow it; if the requested copy language or support scope differs from that file, update that file first.
- `README.md`: user-facing feature overview, startup instructions, validation steps, and project structure.
- `src/`: Bun/React frontend, CLI, profile business logic, and tool config readers.
- `src-tauri/`: Tauri v2 Rust backend. `src-tauri/target/` is the standard Cargo/Tauri output directory and must stay git ignored.
- `scripts/`: project scripts and automation helper scripts.
- `build/fe/`: frontend build output. The repository root `/build/` stays git ignored.
- `ref/changelogs/INDEX.md`: final changelog index. Feature, behavior, API, dependency, or structure changes go in `ref/changelogs/CHANGELOG_X.md`.
- `ref/reviews/INDEX.md`: final review index. Debug, performance, security, or review-driven fixes go in `ref/reviews/REVIEW_X.md`.
- `ref/plans/INDEX.md`: final plan index. Completed plans are archived under `ref/plans/`.
- `ref/conventions/INDEX.md`: index of promoted project conventions. Convention bodies use `ref/conventions/<X>-<topic>.md`.
- `ref/conventions/tally.md`: tally entry for repeated user feedback / repeated agent pitfalls.
- `.refs/`: must be in `.gitignore`; contains only non-final plan/review working copies, never final records.

## Documentation Language

Write active project documentation and maintainer/agent-facing instructions in English by default, including changelogs, plans, reviews, and conventions. Exceptions are `UI_COPY_LANGUAGE.md`, user-facing UI/CLI copy governed by that file, locale examples, quoted/source text, and explicit non-English trigger anchors or examples.

## Build & Local Install

```bash
bunx tauri build --bundles app
cp -R "src-tauri/target/release/bundle/macos/Dev Config Hub.app" /Applications/
```

---

## Required After Changes

### 1. Decide Whether To Update README.md

**README.md is the "feature overview"**: the user-facing capability list. Ask three questions:

1. Did you add or change **user-visible behavior or user-facing UI/CLI copy**? (CLI subcommands, UI controls, config keys, symlink-switching semantics, hook-injected variables, user-visible copy) -> update the relevant section and follow `UI_COPY_LANGUAGE.md`; if the language requirements differ, update that file first
2. Did you change **file structure / create a new module**? -> update the "Project Structure" section
3. Did you change **startup instructions / dependencies / validation steps**? -> update the "Quick Start" section

Pure bug fixes / internal refactors that do not change user perception -> do not touch README; record them in `ref/changelogs/` or `ref/reviews/`.

### 2. Write A Changelog Or Review (**required; choose one**)

| Type | Write to | Examples |
|---|---|---|
| **Feature change** (new feature / behavior change / API / dependency upgrade) | `ref/changelogs/` | Add profile system, remove env mode, add `dch profile env` |
| **Debug / performance / security review** (no new feature; only fixes or hardening) | `ref/reviews/` | TOCTOU / shell injection / hook timeout review |

**Any change under a `ref/` subdirectory must also update that directory's `INDEX.md`** (compact table: `filename | one-line summary`).

#### `ref/changelogs/` Rules

- Filename: `CHANGELOG_X.md`, where X is an incrementing integer. Before creating a file, run `ls ref/changelogs/` and find the largest X.
- **Small changes** (one or two files, tens of lines, same topic) -> append to the latest `CHANGELOG_X.md`; **large changes** (multiple modules / hundreds of lines / new feature) -> create `CHANGELOG_X+1.md`.
- Single-file structure: title + summary (2-3 lines) + changes (module-based bullets). **Do not write pitfall details / reasoning traces** there; those belong in `ref/reviews/`.

#### `ref/reviews/` Rules

- Filename: `REVIEW_X.md`, where X is an incrementing integer. Before creating a file, run `ls ref/reviews/` and find the largest X.
- Single-file structure: trigger scenario + method (two-adversary agents / scope / tools) + three-state verdict checklist + fix items.

### 3. Plan / Review Document Lifecycle

- Non-final plan/review working copies live in the current environment workspace. Without a stronger contract, use `<repo>/.refs/plans/<plan-id>.md` / `<repo>/.refs/reviews/<review-id>.md`.
- Once final, archive the plan and its dedicated supporting materials into `ref/plans/`, archive the review into `ref/reviews/REVIEW_X.md`, sync the relevant INDEX, and clean up the workspace copy. Final records must not exist only in `.refs/`.

### 4. Read Historical Records Before Changing Features

Before modifying any module, **run `ls ref/changelogs/ ref/conventions/ ref/reviews/ ref/plans/` and browse the relevant entries** to understand recorded design decisions, project conventions, plans, and review conclusions.

---

## Project-Specific Conventions (Design Notes Quick Reference)

Repeated design decisions to watch before changing code:

### Bun First; Do Not Introduce Node-Synonym Tools

`tsconfig.json` already anchors types and runtime to Bun. All equivalent tools must use Bun's built-ins:

- Use `bun <file>` instead of `node <file>` / `ts-node <file>`
- Use `bun test` instead of `jest` / `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` / `esbuild`
- Use `bun install` / `bun run <script>` / `bunx <pkg>`; do not mix npm / pnpm / yarn
- Bun loads `.env` automatically; **do not introduce dotenv**
- Use `Bun.serve()` for HTTP (with WebSocket / HTTPS / routes); do not introduce express
- Use `bun:sqlite` for SQLite; do not introduce better-sqlite3
- Prefer `Bun.file` for file IO and `Bun.$` for subprocesses; do not introduce execa

The frontend uses Bun HTML imports + the built-in bundler (automatic React / CSS / Tailwind support); do not introduce vite.

### Profile System: Symlink Is The Only Switching Channel

- `~/.claude` / `~/.codex` are always symlinks pointing to a `<configDir>`. `dch profile use <id>` performs atomic replacement by first running `ln -s` to a temporary name and then overwriting with `mv`.
- Before the first switch, `dch profile init <tool>` must run: move the existing real directory to `~/.<tool>-default`, symlink back to it, and register it as the default profile.
- **Env switching mode is forbidden**: profile switching may use only symlink / junction. Do not add a path that skips symlink switching and only writes env into user-level `settings.json`; that path pollutes every cwd, and Codex has no equivalent mechanism (CHANGELOG_3).
- Switching semantics have four steps: (1) run the `preSwitch` hook (with `profile.env`), abort on failure and do not update active; (2) atomically swap the symlink; (3) write back `active.<tool>` in `~/.dch/profiles.json`; (4) run the `postSwitch` hook, warning only on failure.

### Dual Injection Path For `profile.env`

By default, `profile.env` is visible only inside `preSwitch` / `postSwitch` scripts (for hook-local curl proxy settings, etc.). To also inject env into the claude / codex process itself (OAuth login / API calls through a proxy):

- Recommended: `dch profile env <tool>` outputs shell-eval format + a subshell wrapper in `~/.zshrc` (CHANGELOG_4)
- Also possible: write env into the `env` block in `<configDir>/settings.json` (**Claude Code only**; Codex has no such mechanism)

`dch profile env` output is strictly validated: keys must match `^[A-Za-z_][A-Za-z0-9_]*$`, values are single-quoted and escaped, and **shell injection must be prevented**. The wrapper directly `eval`s this output, so any missing validation is an injection point (CHANGELOG_4). When active is empty / env is empty, output nothing silently so the wrapper naturally falls through to the original command.

### Hook-Injected Environment Variables (Stable Contract)

When running `preSwitch` / `postSwitch` scripts, inject:

```
DCH_PROFILE_ID         profile id being switched to
DCH_PROFILE_TOOL       claude | codex
DCH_PROFILE_CONFIG_DIR absolute path of that profile
DCH_SWITCH_TO          target profile id (same as DCH_PROFILE_ID)
DCH_SWITCH_FROM        previous active profile id (may be empty after first init)
```

Variable names are an external contract; do not hardcode absolute paths in scripts. A nonzero `preSwitch` exit code -> abort the switch, do not update active state, and do not run `postSwitch`.

### Tauri / Frontend Boundary

- The frontend lives in `src/client/` and calls Tauri commands through `bridge.ts`; backend entry `src-tauri/src/lib.rs` only performs Tauri Builder setup and command registration. Concrete IPC implementations live in `src-tauri/src/commands/`.
- **CLI is the single entry point**: every UI profile operation goes through `run_dch_command` to call CLI subcommands. Do not duplicate profile logic in Rust (avoids UI / CLI behavior drift).
- **Do not use `window.confirm`**: Tauri 2 webviews do not show native confirm dialogs. All confirmations must become inline UI state (CHANGELOG_5).
- Frontend forms collect preHook / postHook + model config in one pass; do not split this into a multi-step guide (CHANGELOG_5).

### Config File Display And Editing

Tool config files (`~/.claude/settings.json` / `~/.codex/config.toml` / `~/.zshrc`, etc.) have only three modes in ConfigPanel:

- **view** (default, except markdown files): CodeMirror 6 read-only + syntax highlighting
- **edit**: CodeMirror 6 writable + save (with TOCTOU external-modification detection)
- **render** (markdown files only, such as `CLAUDE.md`): react-markdown + GFM + shiki code blocks

**Do not reintroduce "list" / "schema-driven inline editing" / "field controls"**. The schema system has been fully removed (CHANGELOG_14). The only remaining schema residue is linting for the `~/.dch/profiles.json` edit modal (`ProfileStoreEditor`): `src/schemas/dch-store.ts` + `editor/schema-lint.ts` use codemirror-json-schema. This is an internal dch constraint and unrelated to tool config schemas.

### Single File <= 500 Lines

- Code files, **including comments and blank lines, must not exceed 500 lines**. If a file exceeds that limit, the next change must split/refactor it before adding new logic (split by responsibility / pure logic vs IO layering / one component per file).
- **Exceptions**: test files and individual changelog/review files may be relaxed to <= 800 lines; above 800, consider splitting by topic.
- New files must stay <= 500 lines in the first commit. Split from the start rather than creating one large file and splitting later.

---

## Repeated Feedback / Repeated Pitfalls -> Promote Conventions (Self-Maintenance)

Candidates go in `ref/conventions/tally.md`; count >= 3 promotes them into `ref/conventions/<X>-<topic>.md` and syncs `ref/conventions/INDEX.md`.

| Type | Trigger |
|---|---|
| **User feedback** (`# User Feedback Candidates`) | The user gives corrective / preference feedback: "do not...", "should...", "from now on...", "remember...", "every time..." |
| **Agent pitfalls** (`# Agent Pitfall Candidates`) | A coding agent discovers that it repeated the same class of mistake while reviewing or fixing a bug (typical examples: skipped symlink path validation, shell injection, native confirm in Tauri 2) |

count = 3 -> run a "two-adversary three-state verdict" review of the promotion proposal, then write it. count < 3 -> silently update the tally. If not updated for 30 days and count < 3, it may be cleaned up on the next scan.

> `ref/conventions/tally.md` is a project record maintained by agents. Do not delete entries manually.

---

## Review Expiry And Minimum Re-Review Scope

When preparing the next review, use this section to determine the minimum re-review scope. `ref/reviews/` contains coverage records that expire; it is not a permanent exemption.

Minimum scope for the next review:

```text
unreviewed files ∪ expired reviewed files ∪ scope_unknown files
```

Since the latest REVIEW baseline covering a file, coverage expires when any of these conditions is true:

- Net changes >= `min(200 lines, 30% of current LOC)`.
- Distinct commit count >= 3.
- At least 90 days have passed and the file has changed at least once.
- REVIEW frontmatter marks `expired: true`.

When preparing a review, run `bash scripts/file-level-review-expiry.sh` from the repository root. If the script is missing, determine the above conditions manually with `git log`.

---

## Validation Workflow

```bash
# Unit tests
bun test

# End-to-end smoke
bun install
bun run dev                                      # Tauri desktop window + HMR
bun run cli                                      # CLI overview

# Profile path smoke (must init first)
bun run cli profile init claude                  # convert ~/.claude to symlink + create default
bun run cli profile add claude claude-test --dir ~/.claude-test --desc "smoke"
bun run cli profile use claude-test              # switch + run hooks
bun run cli profile current claude               # should output claude-test
bun run cli profile use claude-default           # switch back
bun run cli profile remove claude-test --yes
```

After changing `src-tauri/**`, rerun `bun run dev` (the Rust backend must rebuild). Frontend-only changes are pushed automatically by HMR.
