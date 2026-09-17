---
review_id: 19
reviewed_at: 2026-09-16
baseline_commit: c57afe3e7bbea88a572b48f7b3e5a86b0059960c
expired: false
skipped_expired:
  - file: "*"
    reason: "Focused completion audit of the approved privacy and removal scope; unrelated expired coverage remains unreviewed."
---

# Privacy And Removal Completion Audit

## Scope And Method

Lead inspection of the approved implementation and its dependency closure,
meaningful regression tests, isolated CLI/installer smoke, and deterministic
Git-object comparisons. No independent or paired reviewers were requested.
The file-level expiry scan ran before the audit. Nine historical reviews with
no usable baseline are explicitly marked `scope_unknown` and expired.

```review-scope
CLAUDE.md
README.md
UI_COPY_LANGUAGE.md
bun.lock
package.json
scripts/install-macos-app.sh
scripts/install-macos-app.test.sh
src-tauri/src/atomic.rs
src-tauri/src/commands/dch.rs
src-tauri/src/commands/fs.rs
src-tauri/src/lib.rs
src-tauri/src/path_policy.rs
src/cli-json-protocol.test.ts
src/cli-profile-contract.test.ts
src/cli-profile-update.ts
src/cli-profile.exit-time.test.ts
src/cli-profile.parseFlags.test.ts
src/cli-profile.ts
src/cli-shared.ts
src/client/App.test.tsx
src/client/App.tsx
src/client/bridge-core.ts
src/client/bridge.test.ts
src/client/bridge.ts
src/client/components/ConfigPanel.test.tsx
src/client/components/ConfigPanel.tsx
src/client/components/DoodleIcon.tsx
src/client/components/ProfilePanel.tsx
src/client/components/profile/ProfileCard.tsx
src/client/components/profile/ProfileFormModal.test.tsx
src/client/components/profile/ProfileFormModal.tsx
src/client/components/profile/ProfileStoreEditor.test.tsx
src/client/components/profile/ProfileStoreEditor.tsx
src/client/font-paint-regression.test.ts
src/client/paper-overrides.css
src/client/profile-global.css
src/client/profile-modals.css
src/client/profile-workflows.css
src/client/styles.css
src/client/tab-paint-regression.test.ts
src/config-file-overrides.test.ts
src/config-loader.ts
src/config-locations.test.ts
src/profiles/hook-timeout.ts
src/profiles/hooks.test.ts
src/profiles/manager.stale-lock.test.ts
src/profiles/manager.test.ts
src/profiles/manager.ts
src/profiles/store-shape.test.ts
src/profiles/store-shape.ts
src/profiles/store.test.ts
src/profiles/store.ts
src/profiles/types.ts
src/schemas/dch-store.ts
src/schemas/to-json-schema.test.ts
src/types.ts
src/utils.ts
```

Deleted backup modules, tests, styles and their producer/consumer boundaries
were included in the removal audit. Scope entries above name surviving files.

## Findings And Adjudication

| State | Evidence | Resolution |
|---|---|---|
| Accepted and fixed | Confirmed personal machine paths remained in 43 historical blob versions. | Exact replacements in an independent clone; reachable history rescanned. |
| Accepted and fixed | Ordinary update and timeout helpers lived in backup modules. | Moved before deleting their former modules; update, hooks, env and lock tests pass. |
| Accepted and fixed | Missing modification times selected an unchecked save endpoint. | Required the timestamp contract, removed that endpoint, and disabled raw-store save after a failed initial read. |
| Accepted and fixed | Installer permanently retained old apps and migrated legacy copies. | Retains only the current installation's temporary rollback copy; success cleanup and failure recovery pass. |
| Rejected | Removing cross-platform branches, both hook forms, catalog defaults, env masking, active path checks or locks. | These are current supported behavior and remain. |
| Rejected | Deleting existing archives or installing over a live app during validation. | Used disposable fixtures; live data and installed bundles were untouched. |
| Unverified | Native visual appearance through Agent Deck Browser. | Navigation and snapshot operations timed out; no screenshot or visual claim is made. |

## Validation And Evidence

- `bunx tsc --noEmit`, `bun run build:fe`: pass.
- `bun test`: 230 pass, 0 fail, 602 assertions across 27 files.
- `cargo check --manifest-path src-tauri/Cargo.toml`: pass.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 42 pass, 0 fail.
- Installer fixtures: new executable inode, strict signature verification,
  temporary-copy cleanup, `.app-build` reuse, injected post-replacement
  signature failure restoring the original inode, exact running-target
  refusal, and preservation of pre-existing historical directories.
- Disposable HOME/tool roots: Claude, Codex, Grok and Cursor all pass
  init/add/update/use/current/env/hooks/remove. Both hook forms and shell
  quoting are exercised; removing a profile preserves its directory.
- Rendered UI: four tool tabs and Advanced Settings, ordinary profile form,
  store editing, external-edit conflicts and catalog defaults pass.
- Removed commands return the normal JSON unknown-command error; negative
  tests preserve existing archive bytes and reject v1 before init changes a
  directory or save changes a store.
- Isolated `bun run dev` rebuilt and launched the Tauri debug target. The task
  process ended with the interrupted tool session. The installed app and all
  Agent Deck processes were left untouched.
- Whitespace, source-size, prompt inventory/hash and current-file privacy
  checks pass. Final record links and buckets are checked after archival.

## History Verification

The final filter input contains the 153 original commits plus the implementation
commit. All 154 commits remain, with identical author/committer metadata,
timestamps and message bytes, and mapped parent topology. All 1,323 unique
old/new blob pairs equal the exact approved transformation; 43 blob versions
change. Filenames, modes and both branch-tip trees are unchanged. All 153
historical transformed trees match the earlier independently verified candidate.
Confirmed personal path prefixes are absent from reachable blobs, filenames
and commit messages.

The earlier candidate let filter-repo remap hash references inside commit
messages. The final run uses `--preserve-commit-hashes`, so its commit identities
differ while original messages remain intact. Current Markdown record references
are remapped separately; archival findings and reviewer methods are preserved.

Local `main` and `refactor/privacy-simplification` were updated with exact
old-ref checks. Stale local `origin/main` and its symbolic HEAD were removed so
unsanitized history is not retained by a reachable local tracking ref. The
remote itself remains unchanged. Private recovery bundles, replacement values,
commit maps and verification summaries remain outside the repository at
`../dev-config-hub-private-recovery-20260916/`.

## Residual Risk

- Remote publication awaits the concrete approval gate in PLAN_3. Recheck its
  expected remote main immediately before the exact lease-protected push.
- Other clones, forks, platform caches, local reflogs/unreachable objects and
  private recovery bundles are not erased by rewriting reachable refs.
- Existing ignored build output was outside the historical cleanup scope.
  Newly generated bundles passed the build gate; no app was packaged or
  installed, and old ignored outputs must not be distributed.
- Browser visual verification is unavailable in this session. Windows/Linux
  behavior is retained in code and platform tests, but native smoke ran on macOS.

## Follow-ups

Only the remote-publication decision remains in this delivery. Do not infer
approval to overwrite the remote from the successful local integration.
