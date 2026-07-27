# Dev Config Hub

A local desktop app for visually viewing and editing development-tool config files, and for quickly switching between multiple **Claude Code / Codex CLI / Grok Build / Cursor configuration profiles** (subscription vs API key, and similar scenarios).

Built on [Tauri v2](https://v2.tauri.app/): a Rust backend and a React/TypeScript WebView frontend, with [Bun](https://bun.sh/) used for the frontend toolchain and CLI. **Supports macOS / Windows 10+ / Linux**. On Windows, profile switching automatically uses NTFS junctions instead of symlinks, with no Developer Mode or elevated privileges required.

## Platform Support Matrix

| Platform | Status | Notes |
|---|---|---|
| **macOS 12+ (Apple Silicon / Intel)** | **GA** | Primary development and test platform; symlink + bash hook; Shell view covers Zsh/Bash and discovers installed Fish/PowerShell |
| **Windows 10 1703+ / 11** | **beta** | Symlink automatically uses junctions (no SeCreateSymbolicLinkPrivilege / Developer Mode required); hooks use PowerShell by default; Shell view dynamically reads the two CurrentUser profiles for each installed Windows PowerShell / PowerShell 7 family |
| **Linux** | **beta** | Same symlink behavior as macOS; hooks use bash; Shell view covers Zsh/Bash and discovers installed Fish/PowerShell |

The platform-support target is **macOS GA, with Windows and Linux remaining beta platforms**.

Windows real-machine E2E remains pending CI validation (see [REVIEW_1](ref/reviews/history/REVIEW_1.md)).

## Configuration Scope

Dev Config Hub intentionally displays and manages only user-level/global tool configuration. Project- or workspace-local configuration files are out of scope and are not enumerated or edited.

Missing primary files remain visible and can be created with valid starter content. Missing optional files stay hidden to keep the list compact.

## Supported Tools

| Tool | User-level Config Files | Format |
|------|---------|------|
| **Shell** | macOS/Linux: `$ZDOTDIR` or `~` → `.zshenv`, `.zprofile`, `.zshrc`; `~/.bash_profile`, `~/.bashrc`, `~/.profile`; Fish `$XDG_CONFIG_HOME/fish/config.fish`; discovered PowerShell CurrentUser profiles. Windows: dynamically resolved `CurrentUserAllHosts` + `CurrentUserCurrentHost` for installed PowerShell families | shell / PowerShell |
| **Claude Code** | `~/.claude/settings.json`, `~/.claude/CLAUDE.md` | JSON / Markdown |
| **Codex CLI** | `$CODEX_HOME/config.toml`; effective global instructions: `AGENTS.override.md`, otherwise `AGENTS.md` | TOML / Markdown |
| **Grok Build** | `$GROK_HOME/config.toml`; existing optional `managed_config.toml`, `requirements.toml` | TOML |
| **Cursor** | `~/.cursor/cli-config.json` | JSON |

The catalog follows the tools' current user-scope documentation: [Claude Code settings](https://docs.anthropic.com/en/docs/claude-code/settings), [Codex config](https://developers.openai.com/codex/config-basic) and [global AGENTS.md](https://developers.openai.com/codex/guides/agents-md), [Grok Build settings](https://docs.x.ai/build/settings), and Cursor [CLI permissions](https://docs.cursor.com/cli/reference/permissions). Project examples in those documents are intentionally excluded here.

## Core Capabilities

- **Config visualization**: display all config files grouped by tool
- **Source-file viewing + direct edit/save**: CodeMirror 6 syntax highlighting + line numbers + folding + search (Cmd+F); edit mode includes external-modification TOCTOU detection
- **Markdown rendering**: markdown files such as `CLAUDE.md` use react-markdown + GFM + shiki code blocks by default
- **Automatic tool version detection**
- **CLI + GUI dual entry points**: `dch` subcommands cover all functionality; `dch gui` / `bun run dev` starts the desktop window
- **Fast profile switching**: maintain multiple Claude / Codex / Grok / Cursor configs and atomically switch each tool's user config root with one action. Cursor profiles switch `~/.cursor`; editor `settings.json` / `keybindings.json` are outside both this catalog and profile switching
- **Pre/post switch hooks**: each profile can define `preSwitch` / `postSwitch` shell scripts for automatically killing leftover processes, starting VPN, health checks, osascript notifications, etc. `preSwitch` failure aborts the switch
- **Shell wrapper env injection**: `dch profile env` + a shell wrapper injects `profile.env` into the selected tool process itself (OAuth / API through proxy)
- **Editable backup and restore (.dchpack)**: ordered file-coverage and secret-handling rules can be managed at factory, tool, and profile-snapshot levels. Profiles and optional `~/.dch/scripts/` switch scripts are packaged through the same filtering/redaction engine. **Tokens / API keys are placeholder-redacted by default**; immutable preview shows every included/excluded file and its matching rules before the exact snapshot is committed.

## Requirements

- [Bun](https://bun.sh/) >= 1.1 (on Windows, install with `irm bun.sh/install.ps1 | iex`)
- [Rust](https://rustup.rs/) >= 1.77
- Platform: macOS 12+ / **Windows 10 1703+** (Windows uses junctions and does not require Developer Mode) / Linux (GTK + WebKitGTK)

## Quick Start

```bash
# Install dependencies
bun install

# Development mode (Tauri desktop window + HMR)
bun run dev

# Build production package
bun run build

# Install to /Applications (macOS)
bunx tauri build --bundles app
cp -R "src-tauri/target/release/bundle/macos/Dev Config Hub.app" /Applications/

# Install on Windows (the .msi output is under src-tauri/target/release/bundle/msi/)
# bunx tauri build --bundles msi
# Double-click to install

# CLI mode
bun run cli                                # overview
bun run cli --version                      # compare source HEAD with installed app commit
bun run cli --check-installed              # exit non-zero when installed app commit differs
bun run cli claude                         # view Claude Code config
bun run cli grok                           # view Grok Build config
bun run cli cursor                         # view Cursor config
bun run cli edit ~/.claude/settings.json   # edit with $EDITOR (Windows defaults to notepad)
bun run cli gui                            # start desktop window

# Profile subcommands
bun run cli profile                              # list all profiles
bun run cli profile init claude                  # convert ~/.claude to symlink/junction and create default profile
bun run cli profile add claude claude-api --dir ~/.claude-api --env ANTHROPIC_API_KEY=sk-...
bun run cli profile use claude-api               # atomic switch + run pre/post hooks
```

The first `bun run dev` must compile Rust dependencies and takes about 2-3 minutes; later starts are near-instant.

## CLI Usage

After registering the global command with `bun link`, use `dch` directly:

```bash
bun link

dch                   # overview of all tools
dch --version         # print source and installed build commits
dch --check-installed # machine-check installed app freshness by commit
dch shell             # Shell config
dch claude            # Claude Code config
dch codex             # Codex CLI config
dch grok              # Grok Build config
dch cursor            # Cursor config
dch all               # show everything
dch gui               # start desktop window (same as bun run dev)
dch edit <file>       # edit a specific config file with $EDITOR

# Profile management
dch profile                                  # list all profiles (grouped by tool, active marked)
dch profile show <id>                        # print profile JSON
dch profile add <claude|codex|grok|cursor> <id> [...] # create an empty directory; use --existing to register an existing one
dch profile update <id> --payload <json>       # update directory, hooks, env, description, or profile timeout
dch profile edit <id>                        # open ~/.dch/profiles.json in $EDITOR
dch profile remove <id> [--yes]              # delete profile (does not delete configDir)
dch profile use <id>                         # atomically switch the profile's tool root + run pre/post hooks
dch profile current [tool]                   # query current active profile
dch profile env <claude|codex|grok|cursor>   # output active profile.env in shell-eval format
dch profile init <claude|codex|grok|cursor>  # convert the tool root to a symlink/junction and create default profile
dch profile hook test <id> <pre|post>        # run one hook for testing
dch profile backup [opts]                    # back up profiles + optional DCH switch scripts to .dchpack
                                             # overwrites ~/.dch/backups/latest.dchpack by default (default slot)
                                             # [--keep] keep as dch-backup-<TS>.dchpack history copy
                                             # [--out <file>] [--profiles <id1,id2>] [--no-scripts]
                                             # [--no-placeholder] [--yes]
                                             # --no-shared remains a deprecated alias for --no-scripts
dch profile restore <pack> [opts]            # restore .dchpack (auto-adds -restored-<TS> suffix to avoid name collisions)
                                             # [--prefix <p>] [--rename OLD=NEW,...]
                                             # [--dry-run] [--yes]
                                             # [--fill-secrets] interactively fill K unique secrets (hidden input)
                                             # [--secrets-json <file>] feed from JSON file (CI / automation)
dch profile backups                          # list all .dchpack files (default / pinned / history groups)
dch profile backup-rm <file> [--yes]         # delete a backup (basename or absolute path; deletes same-name .pinned too)
dch profile backup-pin <file> [--unpin]      # pin (default slot -> copy + pin; others -> pin in place)
```

Production builds include `build-info.json` in the Tauri app resources. `dch --version` prints the source checkout commit plus the installed app commit, branch, dirty flag, and build time. `dch --check-installed` returns `0` when the installed app was built from the current checkout commit, `1` when it differs, and `2` when no installed build metadata is available. Set `DCH_APP_PATH` or `DEV_CONFIG_HUB_APP` to check a non-default app path.

## Profile System

### Data Model

All profiles are persisted in `~/.dch/profiles.json`:

```jsonc
{
  "version": 2,
  "profiles": [
    {
      "id": "claude-api",
      "tool": "claude",
      "configDir": "~/.claude-api",
      "env": { "HTTP_PROXY": "http://127.0.0.1:1082" },
      "description": "Claude Code via API key",
      "hooks": {
        "preSwitch":  "pkill -f 'claude' || true",
        "postSwitch": "osascript -e 'display notification \"Switched to API\" with title \"dch\"'"
      },
      "hookTimeoutMs": 30000
    }
  ],
  "active": {
    "claude": "claude-api",
    "codex": null,
    "grok": null,
    "cursor": null
  },
  "backup": {
    "toolPolicies": {},
    "scriptsEnabled": true
  }
}
```

Creating a profile never generates `settings.json`, `config.toml`, or another tool file, and cloning another profile is not supported. Without `--existing`, `profile add` creates a new empty management directory and rejects an already-existing path. With `--existing`, it registers a real existing directory without copying or modifying its contents. Each profile owns its `hookTimeoutMs`; a missing value defaults to 30 seconds. Legacy global `preferences.hookTimeoutMs` is intentionally ignored and removed on the next store save.

> By default, `profile.env` is visible only inside `preSwitch` / `postSwitch` scripts (for hook-local curl proxy settings, etc.). **To also inject env into the tool process itself** (such as OAuth login through an HTTP proxy), use `dch profile env <tool>` + a shell wrapper (see the "Shell wrapper" section below). Claude Code can alternatively receive variables through the `env` block in `<configDir>/settings.json`.

### Hook-Injected Environment Variables

When running `preSwitch` / `postSwitch` scripts, the following variables are injected:

```
DCH_PROFILE_ID         profile id being switched to
DCH_PROFILE_TOOL       claude | codex | grok | cursor
DCH_PROFILE_CONFIG_DIR absolute path of that profile
DCH_SWITCH_TO          target profile id (same as DCH_PROFILE_ID)
DCH_SWITCH_FROM        previous active profile id (may be empty after first init)
```

**Two hook script forms** (`types.ts` `HookScript = string | { posix?, powershell?, cmd? }`):

```jsonc
// Form 1: string (backward-compatible; runs with the current platform's default shell)
"hooks": {
  "preSwitch": "echo hello"   // POSIX -> bash -lc / Win -> powershell -NoProfile -Command
}

// Form 2: object (recommended for scripts with platform-specific syntax)
"hooks": {
  "preSwitch": {
    "posix":      "pkill -f 'claude' || true",
    "powershell": "Get-Process claude -ErrorAction SilentlyContinue | Stop-Process -Force"
  }
}
```

PowerShell accesses variables through `$env:DCH_PROFILE_ID`; POSIX uses `$DCH_PROFILE_ID`.

A nonzero `preSwitch` exit code aborts the switch, does not update active state, and does not run `postSwitch`. `postSwitch` failure only warns.

### Switching Semantics

`dch profile use <id>` does the following:

1. Run the `preSwitch` hook (with `profile.env`); abort on failure
2. Atomically modify the selected tool root to point at `profile.configDir`
   - **macOS / Linux**: temporary `ln -s` name + overwrite with `mv` (POSIX rename is atomic)
   - **Windows**: `fs.symlink(target, path, 'junction')` NTFS reparse point; target must be an absolute directory path and cannot cross partitions (profile configDirs are all under the user home, so they satisfy this)
3. Write back `active.<tool>` in `~/.dch/profiles.json`
4. Run the `postSwitch` hook

The switch roots are `~/.claude`, `$CODEX_HOME` or `~/.codex`, `$GROK_HOME` or `~/.grok`, and `~/.cursor`. Cursor's platform-specific editor `settings.json` / `keybindings.json` directories are deliberately not switched.

Before the first switch, run `dch profile init <tool>` once: it moves the existing real tool root to `~/.<tool>-default`, then symlinks / junctions back to it and registers it as the default profile.

### Shell Wrapper (Inject `profile.env` Into Tool Processes)

dch does not start a tool process when switching profiles, so `profile.env` does not reach OAuth login / API calls by default. Add wrappers in the shell startup file so each tool run reads env from the active profile. The following shows Claude and Codex; Grok uses the same pattern with `grok`, while Cursor CLI uses profile key `cursor` and executable `cursor-agent`.

**macOS / Linux** (`~/.zshrc` or `~/.bashrc`):

```bash
claude() (
  eval "$(command dch profile env claude 2>/dev/null)"
  exec command claude "$@"
)
codex() (
  eval "$(command dch profile env codex 2>/dev/null)"
  exec command codex "$@"
)
```

**Windows** (PowerShell `$PROFILE`):

```powershell
function claude {
  $env_lines = & dch profile env claude 2>$null
  if ($env_lines) {
    foreach ($line in ($env_lines -split "`n")) {
      if ($line -match '^export\s+(\w+)=(.*)$') {
        [Environment]::SetEnvironmentVariable($matches[1], $matches[2].Trim("'"), "Process")
      }
    }
  }
  & claude.exe @args
}
# codex wrapper follows the same pattern
```

Key points:

- POSIX subshell `(...)` wrapper: env affects only the wrapped tool process and **does not pollute the parent shell**
- `exec command claude` replaces the subshell process, avoids one extra fork, and bypasses the wrapper itself to prevent recursion
- Windows PowerShell function writes process-scoped env with `[Environment]::SetEnvironmentVariable(..., "Process")` (does not pollute processes outside the current shell session)
- `dch profile env <tool>` active empty / env empty -> silent output, so the wrapper naturally falls through to the original command
- profile.env keys use strict `^[A-Za-z_][A-Za-z0-9_]*$` validation + single-quoted values, so there is **no shell-injection risk**

After switching profiles, newly started wrapped tool processes automatically use the new profile env; no shell reload required.

## Backup And Restore (.dchpack)

Package profiles plus optional `~/.dch/scripts/` switch scripts into one `.dchpack` file for cross-machine migration, local disaster recovery, or controlled sharing. This script scope is DCH-global and is useful only when profile hooks call reusable files stored under `~/.dch/scripts/`; profiles that keep their switch commands inline do not need it. `~/.agents/**` is never scanned or included. Legacy packages containing `shared/agents/**` remain importable, but that payload is explicitly ignored and is never restored.

### Three-Tier Backup Model

Backups under `~/.dch/backups/` are grouped by purpose:

| Category | Filename Pattern | Behavior | Purpose |
|---|---|---|---|
| **📌 Default slot** | `latest.dchpack` (fixed) | Overwritten by each `dch profile backup` | Latest backup; analogous to the "current snapshot" in a git working tree |
| **⭐ Pinned** | Any file + same-name `.pinned` sidecar | Never overwritten | Important milestone kept permanently until manually deleted |
| **📜 History** | `dch-backup-<YYYYMMDD-HHMMSS>.dchpack` | Created by `--keep`, no sidecar | Explicit snapshots accumulated over time |

"Pin default slot" semantics: copy `latest.dchpack` -> `dch-backup-<TS>.dchpack` + add `.pinned` sidecar. The original `latest.dchpack` remains the default slot and the next backup still overwrites it; the pinned copy is retained permanently.

### Commands

```bash
# Back up all profiles + DCH switch scripts -> ~/.dch/backups/latest.dchpack
dch profile backup

# Keep as a history copy (do not overwrite default slot)
dch profile backup --keep
# -> ~/.dch/backups/dch-backup-<YYYYMMDD-HHMMSS>.dchpack

# Back up a subset
dch profile backup --profiles claude-pro,codex-pro --out /tmp/share.dchpack

# Skip DCH switch scripts for this run (--no-shared is a deprecated alias)
dch profile backup --no-scripts

# Convert only placeholder actions to keep-original; other excludes still apply.
# Interactive use asks for confirmation; automation must add --yes.
dch profile backup --no-placeholder

# Restore (auto-adds -restored-<TS> suffix to avoid name collisions; does not switch active)
dch profile restore ~/.dch/backups/latest.dchpack

# Interactively fill K unique secrets (hidden input; ENTER skips; Ctrl+C aborts)
dch profile restore <file> --fill-secrets

# CI / automation: feed secrets from a JSON file and automatically fan out to all locations
echo '{"ANTHROPIC_AUTH_TOKEN-1":"sk-ant-...","API_KEY-1":"sk-..."}' > secrets.json
dch profile restore <file> --secrets-json secrets.json --yes
# Missing key -> counted as skipped (placeholder kept); extra key -> counted as unknown (warn, do not fail)

# dry-run conflicts / unique secret overview (after dedup) / switch-script diff
dch profile restore <file> --dry-run

# Rename specific profile
dch profile restore <file> --rename claude-pro=claude-pro-v2,codex-pro=codex-pro-v2

# Global suffix
dch profile restore <file> --prefix -from-mac

# List all backups (grouped by default / pinned / history)
dch profile backups

# Pin / unpin
dch profile backup-pin latest.dchpack       # default slot -> copy + pin
dch profile backup-pin dch-backup-XXX.dchpack
dch profile backup-pin <file> --unpin       # unpin

# Delete a backup (also deletes same-name .pinned sidecar)
dch profile backup-rm dch-backup-XXX.dchpack [--yes]
```

### UX

- ProfilePanel separates tool tabs, primary actions, current status, and profile cards. Tool-level, profile-level, and switch-script rule editors show the active source and enabled-rule counts.
- Backup-rule defaults stay with file coverage, long rule tables are collapsed by category, each category owns its add action, and priority is adjusted directly on the affected row.
- Single profile cards expose edit, switch, export, and profile-rule actions; hooks and environment details stay collapsed until needed.
- Export first prepares an immutable snapshot, then shows included/excluded counts, secret actions, policy sources, and the exact matching rule for every file. Confirming publishes those same bytes without rescanning.
- Backup history modal shows three sections (default slot / pinned / history), each row: filename / time / size / profile count / placeholder count / source host; row actions: restore / pin / delete
- Restore follows the package manifest, performs path-safety and conflict checks, and does not apply the machine's current backup rules again.

### Complete Cross-Machine Migration Flow

**Old machine**:

```bash
dch profile backup
# -> ~/.dch/backups/latest.dchpack (add --keep to save as dch-backup-<YYYYMMDD-HHMMSS>.dchpack instead)
# Transfer the .dchpack to the new machine with AirDrop / scp / USB drive
```

**New machine** (first install dch + restore):

```bash
git clone <dev-config-hub repo> && cd dev-config-hub
bunx tauri build --bundles app
cp -R "src-tauri/target/release/bundle/macos/Dev Config Hub.app" /Applications/

# Important: init each tool you plan to switch so its root becomes a symlink/junction
# Using without init reports: target does not exist; run first: dch profile init
dch profile init claude
dch profile init codex
dch profile init grok
dch profile init cursor

# Restore
dch profile restore <pack> --dry-run    # inspect conflicts / placeholders / shared diff
dch profile restore <pack>              # real restore (does not switch active)

# Fill real credentials back into the placeholder files reported by the prompt, then switch
dch profile use <id>
```

### Filling Credentials Back In (After Migrating To A New Machine)

During backup, all sensitive fields are replaced with `<<DCH_PLACEHOLDER:KEY_NAME>>` and globally merged into `manifest.secrets_index` by transient `sha256(value)` identity; the most frequent field name becomes the logical-key label. **Observed in one 4-profile backup: 148 placeholders -> 32 logical keys (4.6x dedup compression)**. During restore, filling once automatically fans out to all locations by `fieldPath`.

#### Three Fill Methods

**1. UI 4-step flow** (recommended for desktop users)

`📥 Import Backup` -> preview -> rename conflicts -> **fill K secrets** (new) -> apply+report.

The blue banner at the top of step 2 (rename) also lists the K logical keys (not just a number), so users know what they will need to fill before renaming. Step 3 (fill) shows:

- monospace logical key name (`ANTHROPIC_AUTH_TOKEN-1`) + count + hint (`13 occurrences across 2 profiles`)
- password input + eye icon toggle to reveal plaintext
- "Skip" checkbox (keeps the placeholder for later manual editing)
- details disclosure with N packPath occurrences (first 3 by default; when >3, show "+M more")
- top banner with 4 states: all skipped yellow / all filled green / partial filled neutral / pending blue

The export preview shows placeholder totals and per-file rule hits before writing the immutable snapshot. The import flow reads the package's logical-key list when credentials need to be filled.

**2. CLI interactive mode** (hidden input)

```bash
$ dch profile restore latest.dchpack --fill-secrets --yes
Fill 32 unique secrets (148 placeholders · ENTER skips · Ctrl+C aborts)

[1/32] ANTHROPIC_AUTH_TOKEN-1 (count=4, 4 occurrences across 2 profiles)
  ↳ profiles/claude-default/configDir/providers/opus.json
  ↳ profiles/claude-pro/configDir/providers/opus.json
  ↳ profiles/claude-default/configDir/providers/sonnet.json
  ↳ +1 more
Value (hidden, ENTER skips): ●●●●●●●●●●●●●●●●●●●●●●●●●●●●●

...
```

Raw mode disables echo (typed characters are not shown, so password length is not leaked); `try/finally` restores raw mode so Ctrl+C does not leave the terminal stuck; non-TTY (CI / pipe) falls back to plaintext lines.

**3. CLI JSON automation** (CI / script scenarios)

```bash
$ echo '{"ANTHROPIC_AUTH_TOKEN-1":"sk-ant-...","API_KEY-1":"sk-...","Authorization-1":"Bearer ..."}' > secrets.json
$ dch profile restore latest.dchpack --secrets-json secrets.json --yes
✓ Restored 4 profiles
Secrets filled: filled 34 occurrences · skipped 29 logical keys · unknown 0
Remaining placeholders: 114 occurrences (not replaced after fan-out, mostly _meta.json env sections; manually edit ~/.dch/profiles.json)
```

JSON schema validation is strict: it must be a plain object and every value must be a string. Missing keys count as `secretsSkipped` (placeholder kept); extra keys count as `secretsUnknown` (warn, do not fail). **Secret values are never printed to stdout**.

#### Security Constraints

- `manifest.secrets_index` **never** contains `valueHash` or any real value (hash is used only as an in-memory group key during backup and is discarded immediately after assigning the logical key)
- UI secrets cross the Tauri Rust tempfile route only once when calling `restoreApplyWithSecrets`: webview TS never sees the tempfile path / `OpenOptions::create_new(true).mode(0o600)` restricts read/write to the current user / drop guard forces `remove_file` cleanup
- CLI hidden input and JSON automation never print real values to stdout (logs use only logical key names / count / hint)
- Old dchpacks without `secrets_index` automatically fall back to the original dump list during restore, preserving backward compatibility

#### Known Limits

- **Whole-file credentials** (`auth.json` / `credentials.json` / `mcp_credentials.json`) are excluded by the factory rules. If a custom rule changes them to whole-file placeholders, filling cannot reconstruct the original OAuth document shape; use the tool itself to log in again.
- **`profile.env` sections** (`_meta.json` `$.env.K`): excluded from fan-out (fieldPath does not align with the top-level `~/.dch/profiles.json` shape `{ profiles: [...], active: {...} }`), so users manually edit profiles.json afterward.

### Editable Rule Model And Factory Defaults

The hierarchy is **factory rule → optional saved tool rule → profile live inheritance or independent snapshot**. The first profile edit copies the then-effective rule set into a complete snapshot; later tool changes do not affect it. “Restore inheritance” deletes that snapshot and reconnects the profile to the live tool rule. Switch-script rules are global only.

- **Coverage**: each policy has a default include/exclude action plus sortable path rules. Enabled rules run top-to-bottom and the first match wins. Targets are relative path or basename; matchers are case-aware Glob or regex.
- **Secrets**: whole-file rules run first and are terminal. Structured JSON, JSONC, and TOML then apply the first matching field rule before content rules; text files use content rules. Overlapping content spans are claimed by earlier rules, while any accepted `exclude-file` hit excludes the complete file.
- **Actions**: replace with placeholder, exclude the complete file, keep the original value, or ignore the hit. `keep-original` is prominently marked as dangerous. `--no-placeholder` changes only `placeholder` actions to `keep-original`; coverage excludes and `exclude-file` remain enforced.
- **Fixed safety boundaries**: symlinks and special files are never followed; archive and restore paths stay inside declared roots. These boundaries are not editable backup rules.

All four tool policies default to include unmatched real files, include unscannable files with a warning, and exclude common private keys, databases, histories, logs, locks, caches, temporary data, and maintenance state. Specifically this includes `.netrc`, `.ssh/**`, `id_rsa` / `id_dsa` / `id_ecdsa` / `id_ed25519`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `*.jsonl`, `*.db*`, `*.sqlite*`, `*.log`, `*.lock`, `.cache/**`, `.tmp/**`, and the documented root runtime directories. Factory whole-file rules exclude `auth.json`, `credentials.json`, and `mcp_credentials.json`. Field rules ignore expiry/path/URL metadata before placeholder-redacting key, token, secret, password, credential, bearer, and authorization names. Content rules cover Anthropic/OpenAI/GitHub/GitLab/Slack/AWS tokens, HTTP authorization headers, and sensitive `KEY=VALUE` forms.

Tool-specific additions are:

| Scope | Additional factory exclusions |
|---|---|
| Claude | `plugins/cache/**`, `plugins/marketplaces/**` |
| Codex | no additions beyond the common rules |
| Grok | `docs/user-guide/**` |
| Cursor | `projects/**` (the config page still displays only `~/.cursor/cli-config.json`; directory-semantic profile backup remains broader) |
| DCH switch scripts | common private-key, database, log, lock, backup-copy, `.DS_Store`, `.cache/**`, and `.tmp/**` exclusions |

Factory rules and reset sources live in `src/profiles/backup-policy-defaults.ts`; schema validation, matching, and transformation live in the adjacent `backup-policy-*` modules.

### Encrypted Migration (Including Real Credentials)

`--no-placeholder` may keep raw tokens wherever a placeholder rule matches, so inspect the preview and encrypt the outer file:

```bash
dch profile backup --no-placeholder --keep
gpg --symmetric --cipher-algo AES256 ~/.dch/backups/dch-backup-<TS>.dchpack
# Transfer .gpg -> new machine, then gpg --decrypt -> dch profile restore (no placeholders -> immediately usable)
```

## Project Structure

Test files (`*.test.ts(x)` / `fs_tests.rs`) live next to the files they test and are omitted from this tree.

```
├── AGENTS.md                 # Companion agent entry: only entry-specific tool mechanics differences
├── CLAUDE.md                 # Shared project rules: Bun first / record workflow / project invariants / validation workflow
├── UI_COPY_LANGUAGE.md        # Source of truth for user-facing UI/CLI copy language
├── README.md                 # User-facing feature overview, startup instructions, and project structure
├── .ref/                     # Ignored workspace for non-final AI plans/reviews/raw notes
├── build/fe/                 # Frontend build output (git ignored)
├── src/
│   ├── platform.ts           # Cross-platform abstraction: IS_DARWIN/IS_WIN/IS_LINUX, HOME, defaultShellRunner, defaultEditor
│   ├── cli.ts                # CLI entry
│   ├── cli-colors.ts         # ANSI color constants (shared by cli.ts + cli-profile.ts)
│   ├── cli-profile.ts        # `dch profile ...` subcommand implementation, supports --json
│   ├── cli-profile-policy.ts # Profile update + backup-policy CLI bridge commands
│   ├── cli-shared.ts         # Shared helper for cli-profile / cli-backup (JSON_MODE / parseFlags / readStdinLine, etc.)
│   ├── cli-backup-create.ts  # Immutable backup prepare / commit / cancel commands
│   ├── cli-backup.ts         # Restore / history / delete / pin commands + backup facade exports
│   ├── format-bytes.ts       # Byte formatting (single shared source for CLI + frontend)
│   ├── types.ts              # Shared types (ConfigScope / ToolConfig)
│   ├── config-locations.ts   # Shared user-level path catalog for Shell/Claude/Codex/Grok/Cursor
│   ├── config-environment.ts # CLI runtime discovery: env roots, Fish, PowerShell profiles
│   ├── config-loader.ts      # Shared optional/precedence-aware config loader
│   ├── schemas/              # Only remaining use: schema-aware editor for dch profiles.json
│   │   ├── types.ts          # FieldSchema / ToolSchema types
│   │   ├── dch-store.ts      # ~/.dch/profiles.json schema (ProfileStoreEditor lint)
│   │   └── to-json-schema.ts # FieldSchema -> JSON Schema (for codemirror-json-schema)
│   ├── utils.ts              # File-reading utilities, etc.
│   ├── profiles/             # Profile system core (Bun-only)
│   │   ├── types.ts          # Profile / ProfileStore / HookScript / HookResult / ...
│   │   ├── defaults.ts       # Default configDir values for new profiles (single source for UI / CLI)
│   │   ├── store.ts          # ~/.dch/profiles.json read/write + cross-platform collapseHome
│   │   ├── store-shape.ts    # Store default completion (shared by frontend / CLI to prevent drift)
│   │   ├── hooks.ts          # Run pre/post shell scripts (platform split) + pickScriptForRunner
│   │   ├── symlink.ts        # Symlink switching (macOS/Linux symlink + Windows junction)
│   │   ├── manager.ts        # CRUD + switch orchestration (shared core)
│   │   ├── backup.ts         # Stable backup facade
│   │   ├── backup-create.ts / backup-pending.ts # Filtered archive build + immutable preview/commit
│   │   ├── backup-shared.ts  # Shared backup types + fs / subprocess helpers
│   │   ├── backup-restore.ts # parseBackup / applyBackup / applyBackupWithSecrets (fan-out fill)
│   │   ├── backup-restore-files.ts / backup-restore-paths.ts / backup-restore-secrets.ts # safe file restore / path validation / secrets fill
│   │   ├── backup-manage.ts  # listBackups / deleteBackup / pinBackup (three-tier default + pinned + history management)
│   │   ├── backup-policy-defaults.ts # Factory policies for Claude/Codex/Grok/Cursor/scripts
│   │   ├── backup-policy-match.ts / backup-policy-transform.ts / backup-policy-validation.ts # Editable rule engine
│   │   ├── secrets-index.ts  # Global backup placeholder dedup + restore fieldPath addressing fan-out
│   │   ├── field-path.ts     # fieldPath parsing + addressing (split from secrets-index and re-exported through it)
│   │   └── redact.ts         # Placeholder/redaction compatibility utilities used by secrets-index tests
│   ├── readers/
│   │   └── index.ts          # CLI adapter over shared catalog + five-tool version detection
│   └── client/               # Tauri frontend (React)
│       ├── index.html / main.tsx / App.tsx / styles.css / profile-workflows.css / dev-server.ts
│       ├── bridge.ts         # Tauri IPC bridge + dchProfile.* wrappers + readFileWithMtime + getHomeDir
│       ├── bridge-core.ts    # dch CLI invoke primitive (shared base for bridge / bridge-backup)
│       ├── bridge-mtime.ts   # mtime CAS error type + classifier (TOCTOU detection)
│       ├── bridge-backup.ts  # Backup IPC (restoreApplyWithSecrets / restorePreviewSecrets, etc.)
│       ├── backup-cache.ts   # Cross-mount cache for backup history modal (avoids respawning dch CLI)
│       ├── format-bytes.ts   # Compatibility re-export -> ../format-bytes.ts
│       └── components/
│           ├── ConfigPanel.tsx           # Main config panel (view / edit / markdown render modes)
│           ├── ProfilePanel.tsx
│           ├── Select.tsx                # Custom dropdown (replaces native <select> for dark theme)
│           ├── editor/                   # CodeMirror 6 wrapper
│           │   ├── CMEditor.tsx          # React 19 controlled wrapper (self-wrapped, not @uiw)
│           │   ├── theme.ts              # one-dark + project color tokens
│           │   ├── languages.ts          # ConfigScope.format -> CM6 language extension
│           │   └── schema-lint.ts        # codemirror-json-schema wrapper (ProfileStoreEditor only)
│           ├── markdown/                 # react-markdown + shiki code blocks (MarkdownView / highlighter)
│           ├── panel-visibility.tsx
│           └── profile/                  # Components split out of ProfilePanel
│               ├── AddProfileModal.tsx
│               ├── ProfileCard.tsx
│               ├── ProfileStoreEditor.tsx  # schema-aware modal for ~/.dch/profiles.json
│               ├── BackupPolicyModal.tsx / BackupRuleTable.tsx # Ordered rule editor + hierarchy/reset controls
│               ├── ExportBackupModal.tsx   # Prepare exact preview, audit files, then commit immutable .dchpack
│               ├── RestoreBackupModal.tsx  # Import .dchpack (4 steps: preview + rename + fill K secrets + apply+report)
│               ├── restore-modal-bodies.tsx / restore-modal-helpers.ts # Step bodies / helpers split from RestoreBackupModal
│               ├── RestoreSecretsBody.tsx  # Step 3 "fill K secrets" form for K logical keys
│               ├── UniqueSecretsList.tsx / CrossFieldBadge.tsx # Deduplicated secret list + cross-field-name badge
│               ├── BackupHistoryModal.tsx  # Backup history (default / pinned / history groups + restore / pin / delete)
│               ├── HookOutputModal.tsx
│               └── helpers.ts
├── src-tauri/                # Tauri backend (Rust)
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs
│       ├── lib.rs            # Tauri Builder + command registration
│       ├── atomic.rs         # Atomic write + mtime CAS (prevents partial files / TOCTOU overwrite)
│       ├── path_policy.rs    # fs command path-boundary policy (prevents arbitrary webview reads/writes)
│       ├── proc_timeout.rs   # spawn_with_timeout (process group + timeout kills whole group)
│       └── commands/
│           ├── mod.rs        # command module exports
│           ├── dch.rs        # run_dch_command / secret tempfile IPC
│           ├── environment.rs # User env roots + Fish/PowerShell profile discovery for the UI
│           ├── fs.rs         # file read/write / mtime / read_link / read_dir IPC
│           ├── shell.rs      # shell invocation helper
│           └── version.rs    # tool version detection IPC
├── ref/
│   ├── changelogs/{recent-3-days,recent-week,recent-month,history}/
│   │                           # Feature/structure/dependency records; root + bucket indexes
│   ├── reviews/{recent-3-days,recent-week,recent-month,history}/
│   │                           # Debug/performance/security records; root + bucket indexes
│   └── plans/{recent-3-days,recent-week,recent-month,history}/
│                               # Final plan archive; root + bucket indexes
├── scripts/
│   ├── file-level-review-expiry.sh  # Mechanical review-expiry check
│   ├── ref-archive-reminder-pre-commit.sh # Advisory .ref archive hook
│   └── write-build-info.ts           # Package build metadata generator
└── package.json
```

## License

MIT
