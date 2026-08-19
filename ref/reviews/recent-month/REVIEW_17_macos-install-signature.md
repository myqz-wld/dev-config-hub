---
review_id: 17
reviewed_at: 2026-07-31
baseline_commit: 64e8f462a73b7161cfb1cd1ae1867b355b813987
expired: false
---

# REVIEW_17_macos-install-signature: macOS install and launch integrity

## Trigger Scenario

The installed `/Applications/Dev Config Hub.app` appeared not to start. The
development build completed successfully, while the installed executable
exited immediately without application-level output.

This was a user-triggered incident review, not a periodic broad audit. The
file-level expiry inventory was run before the review; the changed
`package.json` scope was previously unknown, and the new installer was
unreviewed, so both are included here with the complete documentation surface.

## Scope

```review-scope
CLAUDE.md
README.md
package.json
scripts/install-macos-app.sh
```

## Method

- Reproduced development and installed launches independently.
- Compared executable hashes, inodes, bundle signatures, process lifetimes,
  native window creation, WebKit load completion, and macOS crash reports.
- Rebuilt the release bundle, exercised clean and replacement installs in
  isolated temporary destinations, and launched the staged result.
- Audited the installer failure paths for running-app refusal, target identity,
  staging, signing, fresh-inode replacement, backup retention, and rollback.

## Findings

### Confirmed And Fixed

| Severity | Finding | Evidence | Fix |
|---|---|---|---|
| HIGH | Updating an existing app with `cp -R` rewrote the installed executable in place. macOS then killed it before Rust/Tauri initialization because cached code pages no longer matched that inode. | The crash report recorded `SIGKILL (Code Signature Invalid)` and `CODESIGNING / Invalid Page`. The failing inode was `32591600`; replacing the bundle produced inode `32779853` and launched normally. | Added a destination-volume staging installer that moves the old bundle aside and installs a newly copied executable inode. It refuses to touch the target while that exact app is running. |
| HIGH | A fresh local Tauri bundle had only its linker signature, which did not seal `build-info.json` and other bundle resources. Strict verification failed with `code has no resources but signature indicates they must be present`. | The rebuilt bundle failed `codesign --verify --deep --strict`; an ad-hoc signature applied to a staged copy produced identifier `com.dch.devconfighub`, sealed two resources, and passed strict verification and launch. | The installer preserves a valid complete signature; otherwise it ad-hoc signs only the staged local copy and verifies the complete bundle before replacement. |
| MED | `README.md` and `CLAUDE.md` prescribed the unsafe in-place copy and provided no running-process guard, signature gate, backup, or rollback path. | Both documents used `cp -R ... /Applications/`; the prior build migration intentionally retained that command. | Added `bun run install:macos`, documented its behavior, and encoded the no-in-place-overwrite invariant in the shared workflow. |

### Rejected Hypotheses

| Hypothesis | Rebuttal |
|---|---|
| The React application or Tauri command bridge caused the installed app to exit. | The installed process was killed by dyld/code signing before application initialization. The development app compiled, created a native window, and loaded its document. |
| The ordinary-browser `invoke` error was the desktop startup failure. | A normal browser lacks Tauri's injected `invoke` bridge by design. The native webview completed both document and frame loads once the bundle integrity problem was removed. |

## Fixes Landed

- Added `scripts/install-macos-app.sh` and the `install:macos` package script.
- Required macOS, absolute paths, the expected app name, executable, and
  `com.dch.devconfighub` bundle identifier before mutation.
- Refused replacement when the exact installed executable is running.
- Staged the bundle under the destination parent, repaired only incomplete
  local linker signatures with an ad-hoc signature, and performed strict
  verification before and after replacement.
- Preserved the old application under
  `~/Library/Application Support/Dev Config Hub/Install Backups/` and restored
  it on a pre-commit installation failure.
- Replaced the unsafe command in `README.md` and `CLAUDE.md`.
- Repaired the current machine without deleting the old application. The
  incident copy remains recoverable at
  `~/Library/Application Support/Dev Config Hub/Install Backups/Dev Config Hub-20260731-191806.app-backup`
  after the duplicate-registration cleanup recorded in REVIEW_18.

## Validation

- `bash -n scripts/install-macos-app.sh`
- Running-target refusal through `bun run install:macos`
- Two consecutive isolated installs: different executable inodes, exactly one
  retained backup, and a valid final signature
- Fresh `bunx tauri build --bundles app`, followed by installer ad-hoc signing
  of the staged copy and `codesign --verify --deep --strict`
- Staged release launch remained alive, created an on-screen `1100x720` window
  at `(206,73)`, and completed WebKit frame and document loads
- `DCH_APP_PATH=<staged app> bun run cli --check-installed`
- Current `/Applications` install remained alive, created the same on-screen
  window, and matched the baseline commit through `dch --check-installed`
- `bunx tsc --noEmit`
- `bun run build:fe`
- `bun test` (`538` pass, `0` fail)
- `bunx tauri build --bundles app`
- `git diff --check`

## Residual Risk

- Ad-hoc signing is appropriate only for local development installation; a
  distributed build still needs the project's future Developer ID signing and
  notarization workflow.
- Backup retention is intentionally manual and can consume disk space over
  time. The installer never silently deletes prior bundles.
- A non-catchable process termination between the two destination renames can
  leave the old app at the explicit `.dch-rollback-*` sibling path. No app data
  is overwritten, but manual recovery may be required.
- `shellcheck` was unavailable on this machine; Bash syntax validation and
  macOS functional install/launch smokes covered the script instead.

## Follow-ups

- Add signed/notarized distribution packaging when external distribution is
  introduced; do not weaken the local installer's strict final verification.
