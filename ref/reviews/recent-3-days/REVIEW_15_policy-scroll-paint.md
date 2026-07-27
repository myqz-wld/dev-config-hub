---
review_id: 15
reviewed_at: 2026-07-27
baseline_commit: 385563f0349ac8605bdbee56a12e049363a96b3a
expired: false
---

# REVIEW_15_policy-scroll-paint: Policy editor scroll backing and text paint

## Trigger Scenario

After live window resizing and repeated tool-tab switching, the backup-policy
table could still show handwritten text with inconsistent darkness. In the
reported screenshot, adjacent horizontal bands of otherwise identical rows
were rasterized at visibly different weights.

## Scope

```review-scope
src/client/styles.css
src/client/profile-modals.css
src/client/profile-workflows.css
src/client/font-paint-regression.test.ts
```

## Findings

### Confirmed And Fixed

| Severity | Finding | Evidence and resolution |
|---|---|---|
| MED | The policy editor had two independently scrollable WebKit layers. The outer `.modal-policy > .modal-body` had an opaque background, but the inner `.rule-table-wrap` computed to `overflow-x: auto`, `overflow-y: auto` with a transparent background. The table text therefore lived in a second transparent scrolling backing whose tiles could be retained and rasterized differently after resize and tab visibility changes. | Read-only inspection of the installed Tauri application's live WKWebView confirmed the computed styles. The policy modal body is now the single opaque two-axis scroller, while its table wrapper uses `overflow: visible`. At an 800 × 500 native window, the outer body retained `clientWidth: 768` and `scrollWidth: 970`, so horizontal access remains available without the nested layer. |
| LOW | The document allowed synthetic font styles even though the handwritten font stack provides only a limited set of physical weights on macOS. That left another rendering-dependent path for artificial emboldening. | Added `font-synthesis: none` at the document body and a regression assertion alongside the existing fixed WebKit antialiasing rule. |

### Superseded Prior Decision

| State | Prior decision | Updated adjudication |
|---|---|---|
| Superseded | REVIEW_14 treated removal of panel containment and fixed font smoothing as the remaining structural text-paint fix. | Native runtime inspection showed that the glyph-bearing policy table still had its own transparent scroll backing. The previous regression tests never inspected that nearest scroll layer, so they could not prove that the paint path was stable. |

## Validation / Evidence

- The installed application's actual WKWebView reported:
  - modal body: `overflow-x: hidden`, `overflow-y: auto`, opaque
    `rgb(255, 250, 240)` background;
  - policy table wrapper: `overflow-x: auto`, `overflow-y: auto`, transparent
    `rgba(0, 0, 0, 0)` background.
- A candidate rule was injected only into the live page for read-only
  diagnostics. At 800 × 500, the outer body became the horizontal scroller
  (`clientWidth: 768`, `scrollWidth: 970`) while the inner wrapper computed to
  `visible/visible`.
- A real React/WKWebView probe with 72 rows completed 16 modal, tab, scroll,
  and native-resize cycles. The corrected page reported
  `font-synthesis: none`; before/after captures had only 3 pixels with a color
  delta greater than 2, with a maximum delta of 3.
- Native captures of the installed application completed discrete and
  continuous resize/tab cycles without material text-region differences in
  the controlled run. This did not make the intermittent report
  deterministically reproducible, but it allowed the live computed scroll
  hierarchy to be inspected instead of inferred from source.
- Focused paint-regression tests pass.
- Full validation:
  - `bunx tsc --noEmit`
  - `bun run build:fe` (665 modules)
  - `bun test` (523 pass, 0 fail, 1374 assertions across 43 files)

## Fixes Landed

- Made the policy modal's opaque body the single two-axis scroll surface.
- Removed policy-table scrolling from the transparent inner wrapper.
- Disabled synthetic font emboldening at the document level.
- Added focused regression coverage for both the scroll hierarchy and font
  synthesis.

## Residual Risk

The exact intermittent visual artifact did not reproduce deterministically in
the controlled native cycles. Final acceptance still requires checking the
newly packaged application on the user's normal resize and tab-switch
sequence. Unlike the earlier fixes, this change is based on the installed
WKWebView's actual computed scroll hierarchy and removes the layer that owns
the affected glyphs.

The in-app browser bootstrap remains unavailable because it fails before
navigation with `Cannot redefine property: process` (Agent Deck issue
`7d49dca6-8649-42c4-a063-8e6d3ac4e9ad`). Native application diagnostics were
used instead of treating static CSS assertions as visual proof.

## Follow-ups

Package and install this source change, then repeat the user's resize and
tool-tab sequence for final visual acceptance.
