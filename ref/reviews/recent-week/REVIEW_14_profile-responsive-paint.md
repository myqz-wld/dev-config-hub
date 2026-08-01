---
review_id: 14
reviewed_at: 2026-07-26
baseline_commit: 097512405ad19acb0364fe2e2f665ba8c363a84f
expired: false
---

# REVIEW_14_profile-responsive-paint: Responsive actions and stable text paint

## Trigger Scenario

The installed application exposed two remaining profile-page problems:

1. At a narrower window width, the flexible spacer before Advanced Edit
   consumed the first row and forced that single action onto a detached second
   row.
2. Resizing the window and then repeatedly switching profile tool tabs could
   still make handwritten text appear progressively darker, despite the
   earlier removal of transforms and text shadows from glyph-bearing nodes.

## Scope

```review-scope
src/client/App.tsx
src/client/components/ProfilePanel.tsx
src/client/components/profile/ProfileModalPortal.test.tsx
src/client/profile-workflows.css
src/client/styles.css
src/client/tab-paint-regression.test.ts
```

## Findings

### Confirmed And Fixed

| Severity | Finding | Evidence and resolution |
|---|---|---|
| MED | The previous text-paint fix left every transparent persistent panel inside `contain: layout paint style` plus `isolation: isolate`. This was the remaining panel-level retained paint boundary capable of changing WebKit glyph rasterization after resize and visibility changes. | Removed panel paint containment and isolation while retaining persistent mounting and `display: none` for inactive panels. Fixed WebKit font smoothing to `antialiased`, and kept all existing no-transform/no-shadow guards on text nodes. |
| LOW | `.profile-toolbar-spacer { flex: 1 }` deliberately separated Advanced Edit from the other actions. When the row became tight, the spacer preserved its separation by wrapping Advanced Edit alone. | Removed the spacer node and rule. All actions now participate in the same ordered wrapping flow, so Advanced Edit uses available first-row space and otherwise follows the preceding action naturally. |

### Superseded Prior Decision

| State | Prior decision | Updated adjudication |
|---|---|---|
| Superseded | REVIEW_13 rejected removing panel paint containment because it was expected to reopen the text-darkening issue. | The post-install resize-and-switch reproduction showed that paint containment did not solve the issue and remained a likely raster-layer trigger. This review removes only that paint/isolation boundary while preserving persistent mounts, inactive-panel `display: none`, portal-based modals, and transform/shadow guards. |

## Validation / Evidence

- The supplied installed-app screenshot shows Advanced Edit isolated on the
  second row while enough combined row width remains once the spacer is
  removed.
- Structural regression coverage verifies that panel hosts create no
  containment/isolation layer, inactive panels remain `display: none`, WebKit
  antialiasing is fixed, and the toolbar spacer cannot return.
- Focused `tab-paint-regression` and `App` component tests pass.
- Full validation results are recorded in the related changelog.

## Fixes Landed

- Removed the toolbar spacer node and CSS rule.
- Consolidated panel visibility CSS in `styles.css` as ordinary block /
  `display: none` behavior.
- Removed duplicate containment rules from `profile-workflows.css`.
- Forced stable WebKit font antialiasing for the application document.
- Reworked structural regression assertions around the corrected paint model.
- Updated the portal regression name so it describes the persistent panel
  boundary without claiming that paint containment still exists.

## Residual Risk

The in-app browser bootstrap still fails before navigation with
`Cannot redefine property: process` (Agent Deck issue
`7d49dca6-8649-42c4-a063-8e6d3ac4e9ad`), so automated raster-level comparison
after repeated native-window resize and tab switching remains unavailable.
The structural causes are removed, but the installed application still needs
the final visual confirmation after packaging.

## Follow-ups

None in application code.
