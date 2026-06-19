# CHANGELOG_32

## Summary

Updated the app shell to read as clean white paper with hand-drawn text, doodled controls, a single doodled crease line between sidebar and content, hand-drawn framed config regions, and a red pencil-like small circle on the active sidebar row. The right-side panel chrome, tabs, headers, status strips, and profile cards now match the paper style; config and Markdown bodies render directly on the white paper instead of inside a dark code block. The circle texture is tuned from `~/Desktop/tmp.jpeg`: each sidebar click now gets a fresh circle variant with different size, rotation, stroke pressure, opacity, grain dots, short broken strokes, and an optional lower closing stroke.

## Changes

- `src/client/components/NavPencilCircle.tsx`: draws the sidebar mark from reference-like loop and tail paths in the original `234x216` coordinate system, then adds jittered pressure paths, grain dots, short strokes, click-time transform variation, and probabilistic rendering of the lower tail stroke.
- `src/client/components/DoodleIcon.tsx`: adds shared hand-drawn SVG icons for backup, restore, history, refresh, pin, switch, warning, key, lock, visibility, and pending states.
- `src/client/App.tsx`: renders the extracted pencil-circle component for the active sidebar item and regenerates its variant on every sidebar click.
- `src/client/styles.css`: changes the full sidebar into one clean white paper sheet, removes the dark header, wooden divider, grid lines, color strips, icon boxes, folded corner, and selected-row fill, prevents horizontal scrolling, restores right-side status marks as doodled green dots, applies handwritten text/icon styling to the header and every option, scopes the sketch SVG to the left icon area with enough gutter to avoid clipping, extends the paper/handwritten styling across the right panel shell and profile chrome, uses a single doodled crease line with subtle shadow between sidebar and content, changes the panel title and config dividers into drawn wavy lines, renders config body text with handwritten fonts while preserving syntax/read features, and adds a red scribble strike to missing-file paths.
- `src/client/paper-overrides.css`: marks config regions on white paper with hand-drawn closed frames and soft shadows; it also makes CodeMirror, markdown, raw, and JSON bodies transparent so the white paper is the actual content background.
- `src/client/components/editor/theme.ts`: removes the dark CodeMirror theme layer and keeps editor behavior, line numbers, selections, and syntax highlighting on a transparent paper background.
- `src/client/components/markdown/highlighter.ts` and `src/client/paper-overrides.css`: switch Markdown fenced-code highlighting to a light Shiki theme, raise Markdown preview contrast, and replace dark inline-code blocks with lighter hand-drawn pill marks.
- `src/client/paper-overrides.css`: lifts panels above the book-crease layer so modals fully cover the crease, and extends the handwritten paper treatment to profile-page form controls, path/code labels, popovers, and backup/restore modals.
- `src/client/paper-overrides.css`: replaces profile/modal checkbox checked states with a red pencil-textured check mark, including the backup-profile picker that previously used a blue fill with a white check.
- `src/client/paper-overrides.css`: makes the settings popover opaque paper instead of translucent, redraws the popover frame and modal header/footer separators with layered wavy strokes, and keeps modals free of a redundant outer drawn frame.
- `src/client/paper-overrides.css`: hides native number-input spinner buttons in profile modals/popovers so numeric fields keep the handwritten paper style.
- `src/client/paper-overrides.css`: removes the Markdown preview's standard container border, disables the soft blur shadow under tool config regions, and restyles horizontal/vertical scrollbars across paper-backed content areas as hand-drawn oval thumbs.
- `src/client/components/editor/CMEditor.tsx` and `src/client/paper-overrides.css`: align source/edit rendering with the `~/.codex/config.toml` paper-backed CodeMirror style, enable wrapping, and hide visible scrollbars across config bodies while retaining scrolling.
- `src/client/components/editor/CMEditor.tsx`: remeasures CodeMirror when a persistent hidden panel becomes visible, preventing stale viewport rendering where content only appears after manual scrolling.
- `src/client/paper-overrides.css` and `src/client/components/editor/theme.ts`: remove real rotation transforms from editable config regions and align CodeMirror line/gutter line-height, fixing cursor hit-testing offsets in edit mode.
- `src/client/components/ProfilePanel.tsx` and `src/client/components/profile/*`: replace visible configuration-plan page emoji with the shared doodled SVG icons.
- `src/client/App.test.tsx`: verifies the active sidebar item shows the sketch circle, removes the todo-box indicator, and changes shape after clicking again.

## Follow-up Polish (cohesion + legibility)

A second pass tightens the paper theme where dark-theme remnants and cold accents still leaked through, plus dead-code cleanup. No logic changes; `bun test` stays green (428 pass).

- `src/client/styles.css`: switches the `body` base background to paper cream and text to ink, so the first-paint loading/error screens and overscroll no longer flash the old dark GitHub background; recolors the spinner ring to faint sepia.
- `src/client/styles.css`: fixes low-contrast light-grey ink (`var(--fg1)`) left on transparent paper for `.raw` / `.json` / `.profile-hook-script`, recoloring their text to ink `#2a2116`.
- `src/client/styles.css` and `src/client/paper-overrides.css`: unify every cold GitHub-blue interactive accent (buttons, tabs, links, hover/active/selected states, focus rings, category badges, doodle pin) to a single warm fountain-pen ink-blue (`#33567f`), aligning interactive color with the existing red/green/teal/sepia ink palette.
- `src/client/styles.css`: warms pure-black scrims and shadows (modal backdrop, toast, modal/popover/select shadows) to sepia `rgba(58,43,26,…)`, and restyles the toast as a paper card with handwritten font.
- `src/client/styles.css`: removes dead sticky-note `.scope` styling (color-cycling `--note-*` vars, tape tab, gradient fill, blur shadow, tilt) fully superseded by the `body .scope*` hand-drawn frame in `paper-overrides.css`, keeping only the positioning and the `::before` base properties (`content`/`position`/`pointer-events`) the override depends on.
