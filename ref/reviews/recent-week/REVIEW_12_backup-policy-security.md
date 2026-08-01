---
review_id: 12
reviewed_at: 2026-07-26
baseline_commit: 5c33aef39f0d6f6d666b7ce7f361f24ecb158f6a
expired: false
---

# REVIEW_12_backup-policy-security: Backup policy and profile workflow audit

## Trigger Scenario

The profile and backup subsystems were substantially rewritten to introduce
editable rules, immutable preview/export, manifest-only restore, existing
directory registration, and profile-local hook timeouts. This review audited
the changed implementation for secret exposure, path traversal and symlink
boundaries, preview/export drift, migration mistakes, inheritance errors, and
UI state mismatches. It also covered the tab paint regression and the removal
of legacy shared-agent restore behavior.

## Method

- Read the complete changed TypeScript, React, schema, CSS, and test surface
  against the approved terminal plan.
- Traced prepare → transform → manifest → commit → parse → plan → apply data
  flow, including legacy package paths and raw-secret overrides.
- Exercised ordered rule conflicts, structured/text/binary formats,
  profile-policy inheritance, pending snapshot lifecycle, CLI aliases, raw
  confirmation, and manifest-only restore through focused and full tests.
- Ran a disposable-HOME CLI smoke for real filesystem and archive behavior.
- Applied three-state adjudication below; all confirmed findings were fixed
  before the final validation run.

## Review Scope

```review-scope
src/cli-backup-create.ts
src/cli-backup.ts
src/cli-json-protocol.test.ts
src/cli-profile-creation.test.ts
src/cli-profile-policy.ts
src/cli-profile.exit-time.test.ts
src/cli-profile.parseFlags.test.ts
src/cli-profile.ts
src/cli-shared.ts
src/client/App.test.tsx
src/client/bridge-backup.invariants.test.ts
src/client/bridge-backup.ts
src/client/bridge.test.ts
src/client/bridge.ts
src/client/components/ProfilePanel.tsx
src/client/components/profile/AddProfileModal.test.tsx
src/client/components/profile/AddProfileModal.tsx
src/client/components/profile/BackupHistoryModal.tsx
src/client/components/profile/BackupPolicyModal.tsx
src/client/components/profile/BackupRuleTable.tsx
src/client/components/profile/ExportBackupModal.test.tsx
src/client/components/profile/ExportBackupModal.tsx
src/client/components/profile/ProfileCard.tsx
src/client/components/profile/ProfileStoreEditor.test.tsx
src/client/components/profile/ProfileStoreEditor.tsx
src/client/components/profile/helpers.ts
src/client/components/profile/restore-modal-bodies.test.tsx
src/client/components/profile/restore-modal-bodies.tsx
src/client/index.html
src/client/paper-overrides.css
src/client/profile-workflows.css
src/client/styles.css
src/client/tab-paint-regression.test.ts
src/config-locations.test.ts
src/config-locations.ts
src/profiles/backup-create.ts
src/profiles/backup-manage.test.ts
src/profiles/backup-manage.ts
src/profiles/backup-pending.ts
src/profiles/backup-policy-defaults.ts
src/profiles/backup-policy-match.ts
src/profiles/backup-policy-transform.ts
src/profiles/backup-policy-validation.ts
src/profiles/backup-policy.fixture.ts
src/profiles/backup-policy.test.ts
src/profiles/backup-policy.ts
src/profiles/backup-preview-e2e.test.ts
src/profiles/backup-restore-files.test.ts
src/profiles/backup-restore-files.ts
src/profiles/backup-restore.ts
src/profiles/backup-safety.test.ts
src/profiles/backup-shared.ts
src/profiles/backup.ts
src/profiles/defaults.ts
src/profiles/manager.stale-lock.test.ts
src/profiles/manager.ts
src/profiles/secrets-index.ts
src/profiles/store-shape.test.ts
src/profiles/store-shape.ts
src/profiles/store.test.ts
src/profiles/store.ts
src/profiles/types.ts
src/schemas/dch-store.ts
src/schemas/to-json-schema.test.ts
```

## Three-State Verdict

### Confirmed And Fixed

| Severity | Finding | Evidence and resolution |
|---|---|---|
| HIGH | Restore validated manifest children but did not independently reject an archive root or destination root that was itself a symlink; an empty file list could bypass descendant checks. | Added root/ancestor symlink rejection relative to trusted archive and HOME roots, including empty-manifest regression tests. |
| HIGH | Restore/history warnings inferred plaintext credentials mainly from the old `no_placeholder` option, so custom `keep-original` policies could produce a raw package without the prominent warning. | Made `backup_audit.contains_raw_secrets` authoritative across CLI, preview, history, and restore while retaining old-package fallback behavior. |
| MED | Structured JSON/JSONC/TOML values stopped content processing after the first rule that matched anywhere, skipping later ordered non-overlapping rules. | Evaluate every ordered content rule while preserving earlier claimed spans; added a two-rule structured-value regression test. |
| MED | Export could locally re-enable switching scripts even when the global script-backup switch was disabled. | Threaded the global state into export and disabled the one-shot checkbox when global policy is off; added a component test. |
| MED | Saving an otherwise unchanged profile through the normal editor could flatten platform-specific hook objects into the current platform's text form. | Preserve the original hook object unless the displayed hook text is actually edited; added helper coverage. |
| LOW | `--no-placeholder` raw-secret confirmation could be requested both by the CLI path and the lower backup layer. | Made confirmation ownership explicit and carried a confirmed flag through the prepare path. |

### Rejected Or Intentionally Not Applied

| State | Proposal | Adjudication |
|---|---|---|
| ❌ | Reapply the destination machine's current policy during restore as a second filter. | Rejected because it breaks package snapshot fidelity and makes preview diverge from restore. Restore applies only manifest-declared files after fixed integrity, path, symlink, and conflict checks. |
| ❌ | Narrow Cursor backup to `cli-config.json` because the configuration page now shows only that file. | Rejected by the approved design choice. Catalog display is narrow, while Cursor profile backup remains directory-semantic and excludes `projects/**` runtime data. |

### Uncertain / Environment-Blocked

| State | Item | Current evidence |
|---|---|---|
| ❓ | Repeated-switch visual smoke in the actual in-app/Tauri browser. | Browser bootstrap failed before navigation with `Cannot redefine property: process` (Agent Deck issue `7d49dca6-8649-42c4-a063-8e6d3ac4e9ad`). Component render tests, CSS/DOM structural regression tests, typecheck, and production frontend build all pass. |

## Security Invariants Verified

- Preview and commit use the same prepared package bytes; source mutations
  after preview do not alter the committed manifest or archive.
- Preview JSON and manifest audit never contain raw secret values or transient
  secret hashes.
- `--no-placeholder` converts only placeholder actions and cannot include an
  excluded private key or whole credential file.
- New manifests contain neither `agents_paths` nor `shared/agents/**`; legacy
  payloads are ignored and never enter conflict or write plans.
- Restore never evaluates current backup policies and writes only
  manifest-declared files after fixed safety checks.
- Invalid glob, regex, capture-group, target, action, schema version, and
  duplicate rule IDs fail validation rather than silently falling back.

## Validation

- `bunx tsc --noEmit` → clean.
- `bun run build:fe` → 661 modules bundled.
- `bun test` → 508 pass, 0 fail, 1,284 assertions across 39 files.
- Isolated-HOME CLI profile/policy/backup/restore smoke → clean.
- `git diff --check` and source/test size scans → clean.

## Residual Risk

The automated gates cover data flow and structural rendering behavior, but the
actual Tauri WebView needs a repeated tab-switch visual smoke once the in-app
browser runtime issue is fixed. No source file requires a file-size exception.

Related records:
[CHANGELOG_37_profile-backup-policies](../../changelogs/recent-3-days/CHANGELOG_37_profile-backup-policies.md)
and
[PLAN_2_profile-backup-policies](../../plans/recent-3-days/PLAN_2_profile-backup-policies.md).
