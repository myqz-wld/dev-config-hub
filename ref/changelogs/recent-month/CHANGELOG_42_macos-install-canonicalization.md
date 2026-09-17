---
changelog_id: 42
changed_at: 2026-08-19
---

# CHANGELOG_42_macos-install-canonicalization: Keep one discoverable macOS app

## Summary

The local macOS installer now keeps `/Applications/Dev Config Hub.app` as the
only discoverable application while preserving rollback and reusable build
artifacts in non-application forms.

## Changes

### Canonical installation and recovery

- Store new rollback copies with an `.app-backup` suffix and automatically
  migrate legacy `.app` backups after unregistering their old paths.
- Archive the installed release build input as `.app-build`, replace that
  generated archive on later builds, and reuse it for repeat installation when
  no fresh build bundle exists.
- Keep the destination-volume staging, ad-hoc signing, strict verification,
  fresh-inode replacement, running-app refusal, and automatic rollback gates.
- Refresh Launch Services after installation so the `/Applications` bundle is
  canonical.

### Regression coverage and documentation

- Added a macOS installer test that performs two isolated installs and checks
  signature validity, inode replacement, legacy backup migration, build archive
  replacement, and zero `.app` backup directories.
- Added `bun run test:install:macos` and documented the new archive behavior.

## Validation

- `bunx tsc --noEmit`
- `bun run build:fe`
- `bun test` (538 passed, 0 failed)
- `bun run test:install:macos`
- Real `NSWorkspace` application lookup

## Do Not Split Protection

None. The installer is 278 lines and its regression test is 78 lines; all
changed source files remain below the 500-line guardrail.

## Notes

Existing rollback contents were preserved as `.app-backup` directories rather
than deleted.

### Related review

- `ref/reviews/recent-3-days/REVIEW_18_macos-duplicate-app-registration.md`
