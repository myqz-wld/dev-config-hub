---
review_id: 11
reviewed_at: 2026-06-19
baseline_commit: <missing>
expired: false
---

# REVIEW_11 — Paper UI render-path performance audit

> Completion date: 2026-06-19
> Related changelog: CHANGELOG_33 (cross-platform font + first-paint flash; same delivery)

## Trigger scenario

User asked to audit the UI render path for optimization opportunities after the handwritten paper UI landing (CHANGELOG_32). The shell was reworked into persistently-mounted panels toggled by `display` (App.tsx comment at the `<main>` block) to avoid unmount/remount cost, but the panels were never memoized, so the re-render cost the comment worried about ("Markdown shiki 重渲染") was only half-addressed.

## Method

- Solo static read of the post-CHANGELOG_32 render path: `App.tsx`, `ConfigPanel.tsx`, `ProfilePanel.tsx`, `MarkdownView.tsx`, `CMEditor.tsx`, `NavPencilCircle.tsx`.
- Traced the re-render trigger chain on a sidebar click and the prop-reference stability of each panel.
- Confirmed regression safety with `bun test` (428 pass) and `tsc --noEmit` (clean).

## Three-state verdict checklist

| State | Severity | Location | Verdict |
|---|---|---|---|
| ✅ | MED | `App.tsx` / `ConfigPanel.tsx` / `ProfilePanel.tsx` | Each sidebar click runs `setNavCircleVariant` + `setView`, re-rendering App and — because panels are mounted permanently and unmemoized — every hidden `ConfigPanel` / `ProfilePanel` too. Wrapped both in `React.memo`; `tool` / `store` / `active` references are stable outside reloads, so hidden panels now skip re-render. |
| ✅ | MED | `MarkdownView.tsx` | Re-rendering a panel re-ran the full remark/rehype/sanitize pipeline on unchanged `source` (large files such as `CLAUDE.md`). Wrapped in `React.memo`; unchanged `source` now skips the parse. |
| ✅ | LOW | `App.tsx` | `onSave` was a fresh closure each render, which would defeat `React.memo` on `ConfigPanel`. Wrapped in `useCallback([flash, loadFilesOnly])`, both already-stable callbacks. |
| ❌ | LOW | `NavPencilCircle.tsx` | Considered reducing the ~150–216 SVG nodes generated per active pencil circle. Rejected: only one circle is visible at a time and it is generated once per click; not a hot path. Left as-is. |
| ❓ | LOW | CMEditor visibility remeasure | `CMEditor` remeasures via `usePanelVisible()` context, not via `ConfigPanel` re-render, so memoizing the panel does not regress the remeasure-on-show fix. Verified by reading the data flow; not exercised by an automated visibility test. |

## Fix items

- `src/client/App.tsx`: wrap `onSave` in `useCallback`.
- `src/client/components/ConfigPanel.tsx`: wrap `ConfigPanel` in `React.memo`.
- `src/client/components/ProfilePanel.tsx`: wrap `ProfilePanel` in `React.memo`.
- `src/client/components/markdown/MarkdownView.tsx`: wrap `MarkdownView` in `React.memo`.

## Validation

- `bun test` → 428 pass.
- `tsc --noEmit` → clean.
- `bun build src/client/index.html` → bundles without error.
