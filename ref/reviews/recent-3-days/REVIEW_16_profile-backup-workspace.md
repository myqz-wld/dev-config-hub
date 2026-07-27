---
review_id: 16
reviewed_at: 2026-07-27
baseline_commit: a860cc978493b9b76cdded3be67e340b2a5cb67f
expired: false
---

# REVIEW_16_profile-backup-workspace: Profile, backup cache, and dialog boundary audit

## Trigger Scenario

Four user-reported problems shared one UI boundary: backup rules reopened cold,
cross-tool operations appeared inside a selected tool tab, the existing-folder
picker was denied by Tauri ACL, and the create-profile form mixed directory
intent with unrelated fields in an unclear order.

## Method

- Traced the profile-tab state, modal ownership, export defaults, policy
  resolution lifecycle, and Tauri dialog registration/capability path.
- Checked policy-cache mutation and refresh races, especially unsaved editor
  state and tool-policy changes that invalidate inherited profile results.
- Exercised the new tab boundaries and profile form with rendered component
  interactions.
- Rebuilt the Tauri backend and ran type, production bundle, focused, and full
  test gates.

## Review Scope

```review-scope
src-tauri/capabilities/default.json
src/client/App.test.tsx
src/client/backup-cache.test.ts
src/client/backup-cache.ts
src/client/components/ProfilePanel.tsx
src/client/components/profile/AddProfileModal.test.tsx
src/client/components/profile/AddProfileModal.tsx
src/client/components/profile/BackupPolicyModal.tsx
src/client/components/profile/ExportBackupModal.test.tsx
src/client/components/profile/ExportBackupModal.tsx
src/client/dialog-capability.test.ts
src/client/index.html
src/client/profile-form.css
src/client/profile-global.css
src/client/profile-modals.css
src/client/tab-paint-regression.test.ts
```

## Findings

### Confirmed And Fixed

| Severity | Finding | Evidence and resolution |
|---|---|---|
| MED | Export, history, import, and raw advanced editing were rendered in every active tool toolbar even though their data scope was global. Export therefore selected Codex profiles while visually nested under Claude. | Added Backup Center and Advanced Settings tabs. Tool tabs now contain only tool-owned actions; export choices are grouped and labeled as cross-tool. |
| MED | Backup-policy resolution always spawned the CLI after modal mount, despite the existing history cache demonstrating the latency benefit of fast reopen. A direct object cache could also leak unsaved edits or overwrite them during refresh. | Added a 30-second target cache with clone-on-read/write, dirty-state refresh protection, silent stale refresh, and mutation invalidation. |
| MED | The dialog plugin was registered in Rust and JavaScript but no window capability granted `plugin:dialog|open`, producing the reported ACL error. | Added a main-window capability with `core:default` and only `dialog:allow-open`; Cargo/Tauri context generation and a structural capability test pass. |
| LOW | New-profile creation exposed a second tool selector inside a tool tab, always displayed an existing-directory picker, and interleaved directory intent with basic and optional fields. | Fixed tool ownership to the opening tab and reorganized the single form into directory mode, essentials, and collapsed automation sections. |

### Rejected Or Intentionally Not Applied

| State | Proposal | Adjudication |
|---|---|---|
| ❌ | Filter or rewrite `.dchpack` history and import behavior according to whichever tool tab happened to be active. | Rejected because packages intentionally support multiple tools and restore follows the package manifest. Moving these operations to an explicitly cross-tool workspace removes the misleading context without changing backup semantics. |
| ❌ | Grant `dialog:default` for convenience. | Rejected as broader than required. The current UI uses only the native open command. |

## Validation / Evidence

- Tool-workspace component coverage proves Claude's toolbar has no global
  export/history/import/advanced actions and that both global tabs render their
  expected operations.
- Profile-form coverage proves the tool is fixed, the directory picker is
  hidden for empty-directory creation, and it appears for existing-directory
  management.
- Cache coverage proves target isolation and clone semantics.
- Capability coverage proves the main window includes
  `dialog:allow-open` but not `dialog:default`.
- `bunx tsc --noEmit` and `bun run build:fe` pass.
- Full `bun test`: 529 pass, 0 fail, 1,411 assertions across 45 files.
- `cargo check --manifest-path src-tauri/Cargo.toml` and a Tauri debug rebuild
  pass.

## Residual Risk

A policy changed by another process can remain visually cached for at most 30
seconds, matching backup-history freshness behavior. Users can close and reopen
after the TTL; local saves and resets invalidate the cache immediately.

Raster-level screenshot automation remains unavailable because the in-app
browser bootstrap fails with the already tracked runtime issue. Rendered
interaction tests and the native Tauri rebuild cover behavior and integration,
but final subjective visual acceptance still belongs in the packaged app.

## Follow-ups

None required in application code.

Related changelog:
[CHANGELOG_38_profile-backup-workspaces](../../changelogs/recent-3-days/CHANGELOG_38_profile-backup-workspaces.md).
