import type { ToolConfig, ConfigScope } from "../types.ts";
import { HOME, readFileIfExists, getToolVersion } from "../utils.ts";
import { join } from "path";

async function readScope(
  filePath: string,
  level: ConfigScope["level"],
  label: string,
  format: ConfigScope["format"],
): Promise<ConfigScope> {
  const { exists, content } = await readFileIfExists(filePath);
  return { level, label, filePath, exists, format, content };
}

export async function readClaudeCodeConfig(): Promise<ToolConfig> {
  const version = await getToolVersion("claude --version");
  const scopes: ConfigScope[] = await Promise.all([
    readScope(join(HOME, ".claude", "settings.json"), "user", "~/.claude/settings.json", "json"),
    readScope(join(HOME, ".claude", "settings.local.json"), "local", "~/.claude/settings.local.json", "json"),
    readScope(join(HOME, ".claude", "CLAUDE.md"), "user", "~/.claude/CLAUDE.md", "markdown"),
    readScope(join(HOME, ".claude", ".mcp.json"), "user", "~/.claude/.mcp.json", "json"),
  ]);
  return { name: "Claude Code", version, icon: "claude", description: "Anthropic AI 编码助手", scopes };
}
