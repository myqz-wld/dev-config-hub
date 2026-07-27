---
changelog_id: 37
changed_at: 2026-07-26
---

# CHANGELOG_37_profile-backup-policies: Profile workflows and editable backup policies

## Summary

Dev Config Hub now creates empty profile directories or registers existing
directories without generating tool configuration files. Hook timeouts are
profile-local, backup behavior is controlled by ordered editable policies, and
exports use an immutable prepared preview whose manifest and bytes are exactly
what the user commits. The profile page, Cursor catalog, and tab rendering were
streamlined at the same time.

## Changes

### Profile creation and management

- Replaced profile cloning and starter-file generation with two explicit
  actions: create an empty management directory or register an existing real
  directory without copying or modifying its contents.
- Added normal profile editing for directory, description, environment,
  platform-aware hooks, and a profile-local `hookTimeoutMs`.
- Upgraded the profile store to version 2. Missing profile timeouts resolve to
  30 seconds; legacy `preferences.hookTimeoutMs` is deliberately ignored and
  removed on the next save.
- Enforced profile ID and normalized-directory uniqueness in the manager layer,
  and sized switch locks from the longest registered profile timeout.

### Editable backup policies

- Added versioned ordered rules with a factory → tool → profile inheritance
  model. Profiles can follow the effective tool policy, capture an independent
  snapshot, or restore live inheritance.
- Added sortable file coverage, whole-file secret, structured-field secret,
  and content secret rules with validated glob/regex matchers and explicit
  include, exclude, placeholder, exclude-file, keep-original, and ignore
  actions.
- Added concrete factory policies and fixtures for Claude, Codex, Grok,
  Cursor, and DCH switching scripts. Cursor backup remains directory-semantic
  while its configuration page now exposes only `~/.cursor/cli-config.json`.
- Added a global-only switching-script policy and enable switch. `--no-scripts`
  is the preferred one-shot CLI skip flag; deprecated `--no-shared` remains an
  equivalent alias.
- Defined `--no-placeholder` as converting only placeholder actions to
  keep-original. It never bypasses file exclusions, exclude-file decisions,
  ignore rules, or fixed path/symlink boundaries, and raw export requires
  explicit confirmation.

### Exact preview, package, and restore behavior

- Split backup preparation, pending-snapshot lifecycle, creation, policy
  evaluation, transformation, and restore file application into bounded
  modules.
- Preview now creates a permission-restricted immutable pending package and
  reports policy source/digest, file decisions, rule IDs, secret actions,
  unscannable warnings, and raw-secret status without exposing secret values or
  hashes. Commit publishes those exact prepared bytes without rescanning.
- Restore follows only package manifest file lists and does not apply the
  destination machine's current backup rules. Source and destination roots,
  ancestors, relative paths, symlinks, and conflicts remain safety-checked.
- Removed `~/.agents/**` from new scanning, manifests, UI, and restore. Legacy
  `.dchpack` files remain importable, but `shared/agents/**` is counted as
  ignored and can never be written back to the machine.

### Profile page and rendering

- Reorganized the profile page around tool status, create/manage actions,
  global rule actions, compact profile cards, expandable details, and
  profile-specific edit/rule/export actions.
- Added table-based policy editing with visible source and counts, ordered
  move controls, collapsed advanced regex/raw JSON controls, restore-default
  and restore-inheritance actions, and prominent keep-original warnings.
- Simplified export to profile selection, script inclusion, destination,
  prepare-preview, and commit. The preview exposes per-file matching rules and
  secret decisions before export.
- Fixed text darkening across repeated sidebar and profile-tool tab switches by
  keeping transforms and shadows off glyph-bearing nodes and isolating
  persistently mounted panel paint layers.

## Validation

- `bunx tsc --noEmit` (clean)
- `bun run build:fe` (661 modules bundled)
- `bun test` (508 pass, 0 fail, 1,284 assertions)
- Isolated-HOME CLI smoke: init, empty profile creation, existing-directory
  registration, switch, policy snapshot/inherit, backup, and dry-run restore
  (clean; store v2 with three profiles)
- `git diff --check` (clean)
- Source/test size guardrail scan (no source above 500 LOC and no test above
  800 LOC)
- Automated component tests and structural tab-paint regression tests (clean)

## Do Not Split Protection

None. All changed source files remain at or below 500 lines; changed tests
remain below 800 lines.

## Notes

The in-app browser runtime failed before opening the local Tauri page with
`Cannot redefine property: process`, so repeated-switch visual smoke could not
be completed in that runtime. This environment problem is tracked as Agent
Deck issue `7d49dca6-8649-42c4-a063-8e6d3ac4e9ad`; automated render and
structural paint tests passed.

Related records:
[PLAN_2_profile-backup-policies](../../plans/recent-3-days/PLAN_2_profile-backup-policies.md)
and
[REVIEW_12_backup-policy-security](../../reviews/recent-3-days/REVIEW_12_backup-policy-security.md).
