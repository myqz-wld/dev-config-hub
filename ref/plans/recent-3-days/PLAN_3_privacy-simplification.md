---
plan_id: 3
created_at: 2026-09-16
completed_at: 2026-09-16
status: local-complete-publication-pending
base_commit: 254a061f44ae73c690391b7a7e4aaa745bc9682a
implementation_commit: c57afe3e7bbea88a572b48f7b3e5a86b0059960c
---

# Privacy Simplification And History Cleanup

## Goal

Remove confirmed personal machine paths from Git history, remove unnecessary
pre-release compatibility and all backup functionality, and add privacy rules
to the three user-level agent instruction files.

## Confirmed Decisions And Constraints

- D1: replace only the confirmed historical path prefixes. Use relative project
  paths, `$HOME` for external tool paths, and neutral example usernames. Keep
  attribution, email, LICENSE content, files, original commits and topology.
- D2/D6: remove the complete `.dchpack` feature and accept only current v2
  profile stores; older/unknown versions fail explicitly instead of migrating.
- D3/D4: the user enabled durable planning and chose `$HOME/.claude/CLAUDE.md`,
  `$CODEX_HOME/AGENTS.md` and `$GROK_HOME/AGENTS.md` for identical privacy rules.
  These sections were applied once and verified; no project Grok file is added.
- D5: remove installer permanent retention and legacy-copy migration; preserve
  temporary failure rollback, signing, new-inode replacement, running-target
  refusal and reusable `.app-build` output.
- D7: preserve core profile CRUD/switching, env, both hook forms, timeout and
  store locks, actual platform support, syntax highlighting, file editing,
  atomic writes, path boundaries, explicit overwrite/conflict warnings,
  masking, and restoration of the default file-management list.
- Existing user archives, profile directories, installed apps and historical
  installation copies are not automatically removed.
- D8/D11: serial implementation in the current ordinary checkout on
  `refactor/privacy-simplification`, explicitly approved after worktree creation
  stalled. No worktree retry, agent delegation, or host process mutation.
- D9: private verified recovery bundles and independent filtering; exact old-ref
  checks protect local integration. Private maps stay outside published files.
- D10: remote overwrite is a separate, concrete approval gate after all local
  work is implemented and validated. No broad mirror force-push is permitted.
- Current UI/CLI language remains Simplified Chinese; active records use English.
- Repository prompt wording was approved: remove obsolete backup invariants and
  scope examples, update installer retention, inspect AGENTS as a paired entry.
  No custom prompt points apply; scoped inventories and hashes are refreshed.

## Completed Tasks

| Task | Result |
|---|---|
| T1 | Removed coupled UI/CLI/TS/Rust/schema backup code and exclusive tests/dependencies; retained ordinary update and timeout helpers. |
| T2 | Removed v1 coercion, old aliases/forwarders, command-string probes, dead policy/styles and unchecked save fallback. |
| T3 | Replaced permanent old-app retention with temporary rollback; isolated success/failure regressions pass. |
| T4 | Verified the three global privacy sections and updated approved repository docs; AGENTS remains a shared-rule reference. |
| T5 | Completed code/build/tests, isolated smoke, focused audit, records, sizes, privacy and link checks. |
| T6 local | Integrated exact sanitized history into both local branches; remapped current record commit references and expired unusable baselines. |
| T6 remote | Awaiting approval for the final reviewed branch tip to replace remote main with an explicit expected-head lease. |

## Validation

TypeScript, frontend build, 230 Bun tests, Rust check and 42 Rust tests pass.
Installer and four-tool disposable-home CLI smoke pass. Isolated Tauri dev
startup is verified. Browser navigation and snapshot timed out, so visual
verification is not claimed. Detailed evidence and preserved boundaries are in
[REVIEW_19](../../reviews/recent-3-days/REVIEW_19_privacy-simplification.md).

The history rewrite preserves all 154 input commits, author/committer metadata,
timestamps, message bytes and topology. All 1,323 blob pairs match the exact
transformation; 43 historical blob versions change. All 153 original commit
trees match the independently verified path-sanitized baseline. Both latest
branch trees remain unchanged by filtering and no confirmed path prefix remains
in reachable blobs, filenames or commit messages.

## Recovery And Publication Gate

Private recovery: `../dev-config-hub-private-recovery-20260916/`. It contains
verified original and implementation bundles, private literal replacements,
independent sanitized clones, commit maps and deterministic verification results.
The final candidate preserves original message bytes; it supersedes the earlier
candidate that automatically changed hash references in commit messages.

- Remote target: `origin`, `refs/heads/main` only.
- Expected remote main: `7b2d1c40be9a0342b2fec7f234dfce5898a4ce9d`.
- Publication source: the final committed `refactor/privacy-simplification` tip,
  including these records. Present its exact hash at the gate.
- Re-read remote refs immediately before publication; if main differs, stop the
  overwrite and reconcile new work. Use an explicit `--force-with-lease` for
  `refs/heads/main`, never an unrestricted force or mirror push.
- Local stale remote-tracking refs were removed; this is not a claim that remote
  history is already cleaned. No remote write occurred during implementation.
- Rewriting refs does not erase forks, caches, other clones, local reflogs or
  private recovery material. Existing ignored build files remain outside scope.

## Final Status

All authorized local implementation and history integration are complete.
Remote publication requires the exact D10 confirmation. No functional scope,
prompt wording, worktree entry, global privacy insertion or test setup needs to
be repeated. No install or Agent Deck restart is part of this delivery.

Related [CHANGELOG_43](../../changelogs/recent-3-days/CHANGELOG_43_privacy-simplification.md).
