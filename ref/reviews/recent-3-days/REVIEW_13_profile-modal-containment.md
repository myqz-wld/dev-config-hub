---
review_id: 13
reviewed_at: 2026-07-26
baseline_commit: 7a6ca88ac33a70819439517437ba71be3b97fb1c
expired: false
---

# REVIEW_13_profile-modal-containment: Profile overlay clipping

## Trigger Scenario

The installed application showed the backup-policy editor clipped to a narrow
slice inside the profile page: its header and footer were outside the visible
area while the lower half of the window remained empty. The same screenshot
also showed native macOS beveled selects that conflicted with the handwritten
notebook theme.

## Scope

```review-scope
src/client/components/ProfilePanel.tsx
src/client/components/profile/ProfileModalPortal.test.tsx
src/client/components/profile/ProfileModalPortal.tsx
src/client/index.html
src/client/profile-modals.css
src/client/profile-workflows.css
src/client/tab-paint-regression.test.ts
```

## Findings

### Confirmed And Fixed

| Severity | Finding | Evidence and resolution |
|---|---|---|
| MED | `.panel-host { contain: layout paint style; }` establishes a containing and clipping boundary for descendant fixed-position overlays. Because all profile modals were rendered inside the tall persistent profile panel, the long policy modal was centered against that panel and paint-clipped before its header/footer reached the viewport. | Kept paint containment for the tab-glyph regression, but rendered every profile modal through a React portal directly under `document.body`. Added explicit flex/min-height rules so the policy body owns vertical scrolling while its header and footer remain visible. |
| LOW | Policy selects retained the native macOS glossy bevel and spinner-like arrows despite inheriting the handwritten font. | Scoped `appearance: none` to policy selects and added a paper fill, irregular SVG frame, hand-drawn chevron, notebook focus ring, and themed option colors without replacing native keyboard/menu semantics. |

### Rejected

| State | Proposal | Adjudication |
|---|---|---|
| ❌ | Remove `contain: layout paint style` from persistent panels. | Rejected because it would reopen the repeated-tab glyph compositing bug. Portaling overlays fixes the containing-block conflict without weakening panel paint isolation. |

## Validation / Evidence

- User screenshot reproduced the exact CSS containing-block failure mode.
- Portal regression test verifies that the fixed overlay is a direct child of
  `document.body`, not the `.panel-host` render container.
- Structural CSS tests verify paint containment remains active and policy
  selects disable native appearance while retaining the notebook theme.
- `bunx tsc --noEmit` → clean.
- `bun run build:fe` → 663 modules bundled.
- `bun test` → 510 pass, 0 fail, 1,292 assertions across 40 files.
- `git diff --check` and source/test size scans → clean.

## Fixes Landed

- Added `ProfileModalPortal` and routed create, edit, hook output, raw-store,
  export, restore, history, and backup-policy dialogs through it.
- Added `profile-modals.css` for predictable long-modal scrolling and
  handwritten policy select controls.
- Added portal placement and CSS-structure regressions.

## Residual Risk

The in-app browser bootstrap still fails before navigation with
`Cannot redefine property: process` (Agent Deck issue
`7d49dca6-8649-42c4-a063-8e6d3ac4e9ad`), so an automated post-fix Tauri
WebView screenshot was unavailable. The user should perform the final visual
confirmation after the next local package/install.

## Follow-ups

None in the application code. The browser-runtime issue is tracked separately.
