---
review_id: 18
reviewed_at: 2026-08-19
baseline_commit: a4d94932c5c73d84de646f5a46d8b5ee8d594f5e
expired: false
skipped_expired:
  - file: "*"
    reason: "Focused user-triggered review of duplicate macOS application discovery and installer backup behavior."
---

# REVIEW_18_macos-duplicate-app-registration: Canonical macOS installation

## Scope

Investigate duplicate Dev Config Hub applications, preserve the signature-safe
replacement workflow, and clean existing duplicates without deleting rollback
data.

```review-scope
README.md
package.json
scripts/install-macos-app.sh
scripts/install-macos-app.test.sh
```

## Findings

### Confirmed Issues

| # | Severity | Finding | Evidence | Resolution |
|---|---|---|---|---|
| 1 | MEDIUM | The installer retained prior versions with a terminal `.app` suffix, so macOS treated rollback data as additional applications. | Spotlight metadata and Launch Services contained backup paths under `~/Library/Application Support/Dev Config Hub/Install Backups/`. | Store and migrate rollback bundles as `.app-backup`, unregistering legacy paths before rename. |
| 2 | MEDIUM | The Tauri release artifact remained a valid `.app` after installation, leaving a second candidate for the same bundle identifier. | `NSWorkspace` returned both the repository release bundle and `/Applications/Dev Config Hub.app` for `com.dch.devconfighub`. | Archive the generated input as reusable `.app-build` after successful installation and refresh the installed registration. |
| 3 | LOW | The installer behavior had only incident-time manual checks, so backup suffix and duplicate-discovery regressions were not continuously covered. | No installer test script or package entry existed. | Added a two-install macOS regression with signature, inode, migration, archive, and path-count assertions. |

### Rejected Alternatives

| Alternative | Reason rejected |
|---|---|
| Delete every older app bundle | Rollback contents can remain recoverable without being classified as applications. |
| Hide or unregister valid `.app` build paths only | `NSWorkspace` continued to discover the valid bundle; changing it to non-application form is deterministic. |
| Restore in-place copying | It would reintroduce the executable inode and code-signature failure fixed by the prior installer review. |

## Validation / Evidence

- Two isolated installs produced different executable inodes, a strict-valid
  final signature, one migrated legacy backup, one retained prior install, and
  zero `.app` directories in the backup root.
- `NSWorkspace` now returns only `/Applications/Dev Config Hub.app` for
  `com.dch.devconfighub`.
- `bunx tsc --noEmit`, `bun run build:fe`, all 538 Bun tests, and the new
  installer regression passed.

## Fixes Landed

- Converted two existing rollback bundles to `.app-backup` without deleting
  their contents.
- Converted the current release artifact to `.app-build` without deleting it.
- Updated the installer, package scripts, documentation, and regression suite.
- Preserved destination staging, rollback, fresh-inode replacement, and strict
  signature verification.

## Residual Risk

- A fresh build remains a discoverable `.app` until the installer completes;
  successful installation immediately archives it as `.app-build`.
- Retained rollback directories can consume disk space over time.
- Launch Services refresh is best-effort, while the non-`.app` suffixes remain
  the durable duplicate-prevention mechanism.

## Follow-ups

- Keep Developer ID signing and notarization separate from this local ad-hoc
  installation workflow.
