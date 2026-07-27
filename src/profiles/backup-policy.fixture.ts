import type { ToolKind } from "./types.ts";

export interface BackupCoverageFixture {
  tool: ToolKind | "scripts";
  path: string;
  action: "include" | "exclude";
  ruleId: string | null;
}

/**
 * Representative persistent/runtime files for every built-in agent plus DCH
 * switching scripts. Tests lock these decisions so factory defaults cannot
 * drift through an unrelated glob edit.
 */
export const BACKUP_COVERAGE_FIXTURES: BackupCoverageFixture[] = [
  { tool: "claude", path: "settings.json", action: "include", ruleId: null },
  { tool: "claude", path: "CLAUDE.md", action: "include", ruleId: null },
  { tool: "claude", path: "projects/demo/memory/MEMORY.md", action: "include", ruleId: null },
  { tool: "claude", path: "projects/demo/session.jsonl", action: "exclude", ruleId: "history-jsonl" },
  { tool: "claude", path: "plugins/cache/vendor/pkg.js", action: "exclude", ruleId: "claude-plugin-cache" },
  { tool: "claude", path: "plugins/local/my-plugin/index.js", action: "include", ruleId: null },
  { tool: "claude", path: "auth.json", action: "include", ruleId: null },
  { tool: "claude", path: "keys/client.pem", action: "exclude", ruleId: "private-pem" },

  { tool: "codex", path: "config.toml", action: "include", ruleId: null },
  { tool: "codex", path: "AGENTS.md", action: "include", ruleId: null },
  { tool: "codex", path: "skills/custom/SKILL.md", action: "include", ruleId: null },
  { tool: "codex", path: "sessions/2026/run.jsonl", action: "exclude", ruleId: "history-jsonl" },
  { tool: "codex", path: "state/state.sqlite", action: "exclude", ruleId: "database-sqlite" },

  { tool: "grok", path: "config.toml", action: "include", ruleId: null },
  { tool: "grok", path: "docs/user-guide/start.md", action: "exclude", ruleId: "grok-user-guide" },
  { tool: "grok", path: "docs/team-notes.md", action: "include", ruleId: null },
  { tool: "grok", path: "mcp_credentials.json", action: "include", ruleId: null },

  { tool: "cursor", path: "cli-config.json", action: "include", ruleId: null },
  { tool: "cursor", path: "mcp.json", action: "include", ruleId: null },
  { tool: "cursor", path: "hooks.json", action: "include", ruleId: null },
  { tool: "cursor", path: "rules/team.mdc", action: "include", ruleId: null },
  { tool: "cursor", path: "projects/demo/runtime.json", action: "exclude", ruleId: "cursor-projects" },

  { tool: "scripts", path: "ensure-proxy.sh", action: "include", ruleId: null },
  { tool: "scripts", path: "settings.json", action: "include", ruleId: null },
  { tool: "scripts", path: "logs/run.log", action: "exclude", ruleId: "runtime-log-file" },
  { tool: "scripts", path: ".cache/result", action: "exclude", ruleId: "hidden-cache" },
  { tool: "scripts", path: "keys/deploy.key", action: "exclude", ruleId: "private-key" },
];
