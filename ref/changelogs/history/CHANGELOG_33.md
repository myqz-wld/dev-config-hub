---
changelog_id: 33
changed_at: 2026-06-19
---

# CHANGELOG_33

## Summary

Follow-up to the handwritten paper UI (CHANGELOG_32): makes the handwritten look hold up off macOS and fixes the real root cause of the dark first-paint flash. The rendering-performance work from the same pass is recorded separately in `ref/reviews/history/REVIEW_11.md`. No user-facing copy changes; `bun test` stays green (428 pass) and `tsc --noEmit` is clean.

## Changes

- `src/client/styles.css`: consolidates the five repeated handwritten font-family literals (27 occurrences) into a single `--hand` variable and enriches the fallback chain so non-macOS platforms also land on a handwriting/kai font instead of collapsing to Comic Sans / generic cursive — Windows `KaiTi` / `楷体` / `Ink Free` / `Segoe Print`, Linux `Comic Neue`. A self-hosted webfont can later be added at this single insertion point.
- `src/client/paper-overrides.css`: points the existing `--paper-hand-font` at `var(--hand)` so the `!important` paper-form font rules share the same enriched stack.
- `src/client/index.html`: changes the inline `<body style>` background/text and the pre-mount "Loading…" color from dark GitHub values to paper cream / ink. This inline style overrides the stylesheet `body` rule, so it — not the CSS — was the actual source of the dark flash before the bundle loads; the CHANGELOG_32 follow-up `body` CSS change only takes effect after this is fixed.
