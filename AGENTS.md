# AGENTS.md

> This repository-level entry point loads alongside the shared project rules.
> Shared project rules live in `CLAUDE.md`: repository basics, base directory structure, required records after changes, plan/review lifecycle, project-specific invariants, and validation.
> Keep this file focused on entry-specific tool mechanics; do not duplicate the full project rule set.

## Read Order

1. Read `CLAUDE.md` first, then follow its repository basics, base directory structure, change-record rules, plan/review lifecycle, project invariants, and validation flow. Paired-entry audits and `ref/` history checks are defined there.

## Entry Mechanics

- Use `rg` for search and `apply_patch` for manual edits.
- Do not write files through shell redirection or ad hoc scripts when `apply_patch` is enough.
- Use the worktree or handoff tools provided by the current environment. When a worktree path is involved, run shell commands with `git -C <worktree>` or absolute paths.
- For SDK sessions, MCP tools, skills, and prompt assets, follow the current environment's explicit contract. Do not invent tool workflows when no contract is present.
- If an async teammate/review tool sends work to another session, report the dispatched work and end the turn instead of polling with `sleep`.

## Entry Differences

`CLAUDE.md` is the shared project source of truth. Add content here only when this entry point needs different tool mechanics to execute the same project rule.
