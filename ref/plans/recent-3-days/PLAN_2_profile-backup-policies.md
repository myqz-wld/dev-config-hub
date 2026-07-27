# Profile Management And Backup Policy Plan

Status: completed
Created At: 2026-07-26
Revised At: 2026-07-26
Completed At: 2026-07-26

## Goal

Simplify configuration-profile creation and management, make hook timeouts
profile-local, replace the fixed backup filters with a general ordered policy
engine, remove `~/.agents/**` from backup and restore, fix the tab-switch paint
regression, streamline the profile page, and limit Cursor's configuration
catalog to `~/.cursor/cli-config.json`.

The revised plan was approved and implemented on 2026-07-26.

## Invariants

- Profile switching remains symlink/junction-only.
- The frontend invokes profile mutations through the CLI.
- Backup traversal never follows symlinks and never accepts a path outside the
  selected profile or `~/.dch/scripts` root.
- Old profile-store files remain readable, but their old global hook timeout is
  intentionally ignored.
- Old `.dchpack` files remain importable. This compatibility is not weakened by
  the hook-timeout migration.
- Restore consumes the package snapshot as written. It never reapplies today's
  backup policy to package contents.
- User-facing copy remains Simplified Chinese.
- No source file should exceed 500 LOC.

## Two Decisions Included In Approval

Approval of this plan accepts the recommended choices below. Revision feedback
may select the alternative.

1. **CLI scripts flag — recommended:** add `--no-scripts` as the preferred name
   and keep `--no-shared` as a deprecated compatibility alias with identical
   behavior. Alternative: keep only `--no-shared`.
2. **Cursor backup scope — recommended:** reduce only the configuration-file
   page to `~/.cursor/cli-config.json`; keep Cursor backup directory-semantic so
   persistent user files such as `mcp.json`, `hooks.json`, and rules are still
   protected by backup. Alternative: make the Cursor factory backup policy an
   allowlist containing only `cli-config.json`.

## 1. Profile Creation And Registration

- Remove "copy from existing profile" from UI and CLI.
- Remove main-config content input/generation from profile creation. Creating a
  Claude, Codex, Grok, or Cursor profile never creates `settings.json`,
  `config.toml`, `cli-config.json`, or any other starter file.
- Provide two explicit modes:
  - **Create empty profile directory:** create a new empty directory, then
    register it.
  - **Manage existing directory:** select or enter an existing directory,
    verify it is a real directory, and register it without copying or modifying
    its contents.
- Enforce profile ID and normalized config-directory uniqueness in the manager
  layer. UI checks are only early feedback.
- Removing a profile continues to leave its config directory untouched.
- Add a normal Edit Profile flow for description, directory, variables,
  scripts, and timeout. Raw JSON editing remains an escape hatch.

## 2. Profile-Local Hook Timeout And Store Migration

- Add `hookTimeoutMs` to `Profile`.
- Missing or invalid profile-local values resolve directly to `30000`.
- Do **not** read, inherit, or copy legacy `preferences.hookTimeoutMs`.
- Normalizing an old store:
  - maps every profile to `hookTimeoutMs: 30000` when missing;
  - emits the new store version;
  - drops the old `preferences` object;
  - preserves all unrelated profile fields and active state.
- The next successful profile mutation persists the normalized shape.
- Remove the one-field Settings popover and `profile config hookTimeoutMs`.
- The target profile's timeout controls pre-switch, post-switch, hook testing,
  Tauri command timeout calculation, and lock stale/wait limits.
- Store-lock sizing uses the maximum normalized timeout among registered
  profiles so a concurrent mutation cannot steal a lock held by another
  profile's long hook.

## 3. Backup Policy Storage And Inheritance

### 3.1 Hierarchy

The hierarchy is:

```text
tool factory policy
  -> optional tool-level saved policy
    -> profile chooses inheritance OR a complete independent snapshot
```

- A missing tool-level policy means "use the current factory policy".
- A profile in inheritance mode follows the currently effective tool policy.
- When a profile starts customization, the app copies the effective policy at
  that moment into the profile. It becomes an independent complete snapshot and
  no longer follows later tool-level changes.
- **Restore inheritance** deletes the profile snapshot and re-establishes the
  live inheritance relationship.
- Resetting a tool-level policy deletes it and exposes the current factory
  policy again.
- Factory policies are code-owned and not serialized into every store.

### 3.2 Store Shape

```ts
interface BackupPolicyStore {
  toolPolicies: Partial<Record<ToolKind, BackupPolicyV1>>;
  scriptsEnabled?: boolean;          // missing => true
  scriptsPolicy?: BackupPolicyV1;    // missing => factory DCH-script policy
}

interface Profile {
  // existing fields...
  hookTimeoutMs: number;
  backupPolicy?: BackupPolicyV1;     // missing => inherit effective tool policy
}
```

`~/.dch/scripts/**` has only one global policy. It never has a profile-level
override.

## 4. Determinate Backup Policy Schema

```ts
type FileAction = "include" | "exclude";
type SecretAction =
  | "placeholder"
  | "exclude-file"
  | "keep-original"
  | "ignore";
type TextFormat = "json" | "jsonc" | "toml" | "text";

interface RuleBase {
  id: string;               // stable unique ID inside one policy
  label: string;
  enabled: boolean;
}

interface MatchExpression {
  kind: "glob" | "regex";
  pattern: string;
  caseSensitive?: boolean;  // missing => false
}

interface FileCoverageRule extends RuleBase {
  target: "relative-path" | "basename";
  match: MatchExpression;
  action: FileAction;
}

interface WholeFileSecretRule extends RuleBase {
  target: "relative-path" | "basename";
  match: MatchExpression;
  action: SecretAction;
  placeholderName?: string;
}

interface FieldSecretRule extends RuleBase {
  formats: Array<"json" | "jsonc" | "toml">;
  match:
    | { kind: "exact" | "contains" | "suffix" | "glob"; pattern: string; caseSensitive?: boolean }
    | { kind: "regex"; pattern: string; caseSensitive?: boolean };
  action: SecretAction;
  placeholderName?: string;
}

interface ContentSecretRule extends RuleBase {
  formats: TextFormat[];
  match:
    | { kind: "regex"; pattern: string; caseSensitive?: boolean; secretCaptureGroup?: number }
    | { kind: "key-value"; keyPattern: string; minValueLength: number; caseSensitive?: boolean };
  action: SecretAction;
  placeholderName?: string;
}

interface BackupPolicyV1 {
  schemaVersion: 1;
  defaultFileAction: FileAction;
  unscannableFileAction: "include-with-warning" | "exclude";
  fileRules: FileCoverageRule[];
  secretRules: {
    wholeFile: WholeFileSecretRule[];
    field: FieldSecretRule[];
    content: ContentSecretRule[];
  };
}
```

### 4.1 Supported Inputs

- JSON and JSONC: structured recursive string-value processing.
- TOML: structured recursive string-value processing.
- Markdown, YAML, shell, dotenv, INI, XML, source code, and unknown valid UTF-8:
  text processing.
- Invalid JSON/JSONC/TOML: text fallback plus a manifest warning.
- Non-UTF-8/binary: follow `unscannableFileAction`; no fake claim of secret
  scanning.
- Arrays of strings retain the parent field name for field-rule evaluation.

### 4.2 File Rule Order

1. Fixed safety boundary rejects symlinks, special files, path traversal, and
   paths escaping the selected root. Users cannot override this.
2. Start with `defaultFileAction`.
3. Evaluate enabled `fileRules` from top to bottom.
4. The **first matching rule wins**. No later file rule is evaluated.

This makes ordering useful and allows a specific include rule above a broad
exclude rule.

### 4.3 Secret Rule Order And Cross-Type Conflicts

For a file that passed coverage:

1. Evaluate `wholeFile` rules top to bottom. The first match is terminal for
   the complete file.
2. If there is no whole-file match and the file parses structurally, inspect
   each string value:
   - first matching `field` rule wins for that value;
   - only when no field rule matches, first matching `content` rule wins.
3. For text files, evaluate content rules in order. Earlier rules claim
   overlapping spans; later rules cannot rewrite claimed spans.
4. If any independently matched occurrence resolves to `exclude-file`, the
   complete file is excluded. This aggregate safety result outranks
   placeholder/keep/ignore results elsewhere in that file.
5. `placeholder` replaces only the matched value/span and records a location.
6. `keep-original` retains the secret, records a raw-secret audit event, marks
   the package as containing plaintext credentials, and requires prominent UI
   confirmation or CLI `--yes`.
7. `ignore` suppresses that match as a known false positive and does not mark
   the package as containing a retained secret.

Whole-file `keep-original` and `ignore` are terminal and deliberately bypass
field/content processing; the advanced UI must explain this.

### 4.4 Validation

- IDs must be unique and stable.
- Empty glob/regex patterns are rejected.
- Every glob must compile with `Bun.Glob`.
- Every regex must compile, stay under a documented length limit, and use only
  the engine-provided global/case flags.
- `secretCaptureGroup` must exist in the compiled regex.
- `placeholderName` must satisfy the placeholder-key grammar.
- Unknown schema versions/actions/targets are rejected before saving.
- Invalid policies never silently fall back during export.

## 5. Factory Policies And Fixtures

The following are proposed factory policies and become confirmed only when this
plan is approved.

### 5.1 Common File Coverage Rules

All four tool policies use `defaultFileAction: "include"` and
`unscannableFileAction: "include-with-warning"`.

Ordered common excludes:

```text
private-netrc       **/.netrc
private-ssh-tree    **/.ssh/**
private-ssh-id      **/{id_rsa,id_dsa,id_ecdsa,id_ed25519}
private-ssh-id-dir  **/ssh/id_*
private-key-files   **/*.{pem,key,p12,pfx,jks,keystore}
history-jsonl       **/*.jsonl
database-db         **/*.db{,-shm,-wal,-journal}
database-sqlite     **/*.sqlite{,-shm,-wal,-journal}
database-sqlite3    **/*.sqlite3{,-shm,-wal,-journal}
runtime-log         **/*.log
runtime-lock        **/*.lock
maintenance-copy   **/*.{bak,backup}.*
mac-metadata        **/.DS_Store
hidden-cache        **/.cache/**
hidden-temp         **/.tmp/**
root-debug          debug/**
root-file-history   file-history/**
root-session-env    session-env/**
root-sessions       sessions/**
root-shell-snapshot shell_snapshots/** and shell-snapshots/**
root-paste-cache    paste-cache/**
root-cache          cache/**
root-backups        backups/**
root-ide            ide/**
root-state          state/**
root-tasks          tasks/**
root-statsig        statsig/**
root-log            log/** and logs/**
root-temp           tmp/**
root-memory         memory/** and memories/**
root-ai-tracking    ai-tracking/**
root-extensions     extensions/**
root-skills-cursor  skills-cursor/**
maintenance-files   .last-cleanup, .personality_migration, installation_id,
                    mcp-needs-auth-cache.json, plugins/install-counts-cache.json,
                    .claude.json, active_sessions.json, leader.sock
```

Brace expressions above are authoring shorthand only. Factory construction
expands them into individually validated `Bun.Glob` rules so runtime behavior is
unambiguous.

### 5.2 Tool-Specific File Rules

- **Claude**
  - keep directory-semantic fallback;
  - exclude `plugins/cache/**` and `plugins/marketplaces/**`;
  - preserve `plugins/local/**`, `skills/**`, `agents/**`, `commands/**`,
    `templates/**`, and `projects/**/memory/**` through the fallback;
  - common JSONL/database/log rules still remove project session history.
- **Codex**
  - common rules only;
  - preserve `config.toml`, `AGENTS.md`, `AGENTS.override.md`, `skills/**`,
    `agents/**`, `rules/**`, and prompts through the fallback.
- **Grok**
  - common rules plus `docs/user-guide/**`;
  - preserve user-authored files under other `docs/**` paths.
- **Cursor — recommended directory-semantic option**
  - common rules plus `projects/**`;
  - preserve persistent `cli-config.json`, `mcp.json`, `hooks.json`, and
    user-authored rule files through the fallback.
- **Cursor — alternative narrow option**
  - `defaultFileAction: "exclude"`;
  - first rule includes only `cli-config.json`.

### 5.3 Common Secret Rules

Ordered whole-file rules:

```text
auth-json             **/auth.json             -> exclude-file
credentials-json      **/credentials.json      -> exclude-file
mcp-credentials-json  **/mcp_credentials.json  -> exclude-file
```

These are excluded rather than replaced by unusable whole-file placeholders.
Users can customize this to placeholder/keep/ignore.

Ordered field rules:

```text
ignore-token-expiry       exact tokenExpiry / tokenIssuedAt -> ignore
ignore-path-like          regex (_path|_file|_url|_endpoint|_dir|_directory)$ -> ignore
redact-sensitive-name     contains api_key, apikey, token, secret, password,
                          credential, bearer, authorization -> placeholder
```

Ordered content rules:

```text
Anthropic sk-ant-*         -> placeholder
OpenAI sk-proj-*           -> placeholder
OpenAI sk-*                -> placeholder
GitHub ghp_/gho_/ghu_/ghs_ -> placeholder
GitLab glpat-*             -> placeholder
Slack xoxb-/xoxp-          -> placeholder
AWS AKIA*                  -> placeholder
Authorization/X-Api-Key/X-Auth-Token header token -> placeholder
generic sensitive KEY=value / KEY: value (minimum 8 chars) -> placeholder
```

The exact regex and capture group for every built-in content rule is stored in
the factory-policy source and asserted in snapshots; it is not hidden in a
second redaction implementation.

### 5.4 DCH Switching-Script Factory Policy

- Root: `~/.dch/scripts/**` only.
- `defaultFileAction: "include"`.
- Use common private-key, database, log, lock, backup-copy, `.DS_Store`,
  `.cache/**`, and `.tmp/**` exclusions.
- Apply common whole-file and content secret rules.
- Field rules apply when a script-root file is JSON/JSONC/TOML.
- This policy is global only and is named **切换脚本备份规则** in UI.

### 5.5 Test Fixtures

Add deterministic fixtures plus expected decision snapshots:

- Claude: settings, instructions, project memory/session JSONL, plugin
  cache/local plugin, auth file, private key.
- Codex: config, AGENTS files, skills, session JSONL, SQLite state.
- Grok: config layers, downloaded `docs/user-guide`, user-authored other docs.
- Cursor: `cli-config.json`, MCP/hooks/rules, projects/runtime data; expectations
  differ for the approved Cursor option.
- DCH scripts: ordinary shell script, JSON/TOML script config, token-bearing
  script, cache/log/private-key files.
- Conflict fixture: specific include above broad exclude, reversed ordering,
  field ignore before redact, whole-file terminal rule, overlapping content
  regex, and aggregate `exclude-file`.

## 6. Remove `~/.agents/**` Completely

- Delete backup scanning and archive writing for `~/.agents`.
- Delete restore planning/application for shared agents.
- Delete UI copy, controls, rule concepts, and toggles for agents.
- New manifests contain no `agents_paths` and no `shared/agents/**`.
- The legacy parser may recognize old `agents_paths` only to ignore it safely.
- Restoring an old `.dchpack`:
  - never copies `shared/agents/**`;
  - never adds those paths to conflict actions;
  - reports that legacy agent payloads were ignored;
  - still restores compatible profiles and DCH scripts.

## 7. DCH Script Backup And Restore Semantics

- Rename shared-resource UI to **切换脚本备份规则**.
- Only `~/.dch/scripts/**` remains.
- Backup uses the same ordered filtering and secret engine as profile files.
- Restore trusts the prepared package snapshot and manifest file list; it does
  not apply current tool/script backup rules.
- Restore performs only archive integrity, relative-path boundary, symlink,
  destination path safety, and conflict-policy checks before writing.
- Old package DCH scripts remain restorable after the same safety checks.

## 8. CLI Compatibility And Overrides

- Recommended: `--no-scripts` is the preferred one-shot skip flag;
  `--no-shared` remains an alias. Both mean only "skip `~/.dch/scripts` for this
  backup".
- `--no-placeholder` is an explicit one-shot override:
  - converts `placeholder` actions to `keep-original`;
  - does **not** override `exclude-file`, `ignore`, file coverage exclusions, or
    fixed path/symlink boundaries;
  - leaves already configured `keep-original` unchanged;
  - requires `--yes`;
  - sets manifest raw-secret warnings and lists affected rules/files without
    storing values.
- It never turns an excluded private key or excluded whole credential file into
  plaintext merely because the flag is present.

## 9. Exact Preview/Export Pipeline

Preview and export use one prepared immutable snapshot:

1. `backup prepare` scans once, resolves rules, transforms content, creates the
   final archive in a permission-restricted pending area, and returns an opaque
   token plus a value-free audit report.
2. UI shows that exact report.
3. Confirm performs no rescan; `backup commit <token>` atomically moves/copies
   the already prepared archive into the selected default/history/output slot.
4. Cancel removes the pending archive. Expired pending snapshots are cleaned on
   later backup operations.
5. CLI `backup` uses prepare+commit in one invocation.

The manifest audit contains:

- policy schema version, source (`factory`, `tool`, `profile-snapshot`,
  `scripts`), and deterministic policy digest;
- included/excluded/unscannable file counts;
- placeholder, excluded-secret, retained-secret, and ignored-hit counts;
- per-file coverage decision and matching file-rule ID;
- per-file secret action counts and matching rule IDs;
- raw-secret package flag and security warnings.

No secret value or value hash enters preview JSON or the manifest.

## 10. Usability Acceptance Criteria

- Normal UI is a sortable table, not raw JSON:
  - enabled, priority, target, matcher, pattern, action, and source;
  - move up/down controls with clear first-match-wins explanation;
  - rule-source badge and effective rule counts.
- Factory/tool/profile-snapshot/inherited state is always visible.
- Advanced regex, capture-group settings, raw policy JSON, and bulk ordering are
  collapsed by default.
- Restore Default/Restore Inheritance explains whether it deletes a saved tool
  override or profile snapshot.
- `keep-original` uses a prominent red warning, requires explicit confirmation,
  and cannot be hidden inside the advanced section.
- Preview lists:
  - number of included and excluded files;
  - all secret-action totals;
  - each file's matching coverage rule;
  - each file's secret rule IDs/actions;
  - unscannable warnings.
- The UI commits the prepared snapshot represented by the preview, guaranteeing
  preview/manifest/export consistency.

## 11. Profile Page And Export UX

- Reorganize the page into current tool/status, primary create/manage actions,
  backup/rule actions, and compact profile cards.
- Compact cards show ID, active/default state, directory, timeout, description,
  and summary badges.
- Variables and scripts move into an expandable details area.
- Secondary actions: Edit, Backup Rules, Export, Delete.
- Export UI retains profile selection, default/history choice, rule-source
  summary, Prepare Preview, and Commit. Secret/script policy editing moves out
  of Export.
- Advanced profile-store JSON editing remains available with the new schema.

## 12. Cursor Configuration Catalog

- The configuration-file page exposes only `~/.cursor/cli-config.json`.
- Remove editor settings, keybindings, MCP, and hooks from this page and its
  platform tests/documentation.
- Backup behavior follows the Cursor choice in "Two Decisions Included In
  Approval" and is tested independently from catalog display.

## 13. Tab Paint Regression

- Cover both sidebar navigation and the four profile tool tabs.
- Remove transforms/text shadows from text-bearing elements that cause unstable
  WebKit glyph compositing.
- Keep hand-drawn active decoration on pseudo/SVG layers, not on glyph layers.
- Add paint isolation/containment to persistent panel hosts so hidden panels
  cannot leave stale blended layers.
- Add structural CSS/DOM regression tests and perform repeated-switch visual
  smoke in the Tauri webview.

## 14. Validation Matrix

- Store migration:
  - old global timeout is ignored;
  - every missing profile timeout becomes 30000;
  - old `preferences` is removed on save.
- Inheritance:
  - factory -> tool inheritance;
  - profile live inheritance;
  - profile snapshot stops following;
  - restore inheritance resumes following;
  - tool reset returns to factory.
- Rule engine:
  - first-match order and reversed order;
  - cross-type conflict ordering;
  - overlapping regex;
  - aggregate `exclude-file`;
  - illegal glob/regex/capture group/schema/action;
  - fixed path/symlink boundaries cannot be overridden;
  - all supported formats and parse fallback;
  - binary include-warning/exclude.
- Scripts:
  - DCH script filtering and redaction;
  - script keep-original warning;
  - one-shot script skip flags.
- Legacy:
  - old `.dchpack` imports;
  - old agents payload is never restored;
  - old DCH scripts restore;
  - restore never re-filters package contents.
- CLI:
  - `--no-placeholder` exact override matrix;
  - raw confirmation requirement;
  - `--no-scripts`/`--no-shared` approved behavior.
- Preview:
  - prepared preview equals committed manifest;
  - rule digest and per-file audit match;
  - cancel/expiry cleanup;
  - no secret values/hashes in outputs.
- Profile UX:
  - empty directory creation;
  - existing directory registration;
  - no generated config file;
  - no clone option;
  - per-profile timeout editing.
- Cursor catalog contains exactly `~/.cursor/cli-config.json`.
- Repeated tab switches do not darken text.
- Commands:
  - `bunx tsc --noEmit`
  - `bun run build:fe`
  - targeted tests and full `bun test`
  - `bash scripts/file-level-review-expiry.sh`
  - isolated-HOME profile smoke
  - Tauri desktop visual smoke

## 15. Records And Final Handoff

- Update README and the store schema.
- Finalize a feature changelog, a debug/review record for the paint fix and
  security-sensitive backup engine, and archive this terminal plan.
- Implementation completed in dependency order: policy/store foundations,
  profile workflows, immutable backup/restore pipeline, CLI/UI integration,
  security hardening, documentation, and regression coverage.
- Final records: `CHANGELOG_37_profile-backup-policies.md` and
  `REVIEW_12_backup-policy-security.md`.
- The in-app browser runtime failed during the Tauri visual smoke before a page
  could be opened (`Cannot redefine property: process`). Automated component,
  structural paint-regression, type, build, and full test gates remain the
  executable acceptance evidence.
