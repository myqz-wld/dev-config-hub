import type { ToolConfig, ConfigScope, ConfigCategory, ConfigEntry } from "../types.ts";
import { HOME, readFileIfExists, getToolVersion, maskObject } from "../utils.ts";
import { CLAUDE_CODE_DESCRIPTIONS } from "../descriptions.ts";
import { join } from "path";

function jsonToEntries(parsed: Record<string, unknown>, descMap: Record<string, string>): ConfigEntry[] {
  return Object.entries(parsed).map(([key, value]) => ({
    key, value, type: typeof value, description: descMap[key],
  }));
}

async function readJsonScope(
  filePath: string, level: ConfigScope["level"], label: string,
  descMap: Record<string, string>,
): Promise<ConfigScope> {
  const { exists, content, rawContent } = await readFileIfExists(filePath);
  if (!exists) return { level, label, filePath, exists: false, format: "json", content: "", parsed: {}, categories: [] };

  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(rawContent); } catch {
    return { level, label, filePath, exists: true, format: "json", content, parsed: {}, categories: [] };
  }
  const masked = maskObject(parsed);
  const items = jsonToEntries(masked, descMap);
  return {
    level, label, filePath, exists: true, format: "json", content, parsed: masked,
    categories: items.length > 0 ? [{ name: "配置项", description: "", items }] : [],
  };
}

export async function readClaudeCodeConfig(): Promise<ToolConfig> {
  const version = await getToolVersion("claude --version");
  const scopes: ConfigScope[] = await Promise.all([
    readJsonScope(join(HOME, ".claude", "settings.json"), "user", "~/.claude/settings.json", CLAUDE_CODE_DESCRIPTIONS),
    readJsonScope(join(HOME, ".claude", "settings.local.json"), "local", "~/.claude/settings.local.json", CLAUDE_CODE_DESCRIPTIONS),
    (async () => {
      const { exists, content } = await readFileIfExists(join(HOME, ".claude", "CLAUDE.md"));
      return { level: "user" as const, label: "~/.claude/CLAUDE.md", filePath: join(HOME, ".claude", "CLAUDE.md"), exists, format: "markdown" as const, content, parsed: {}, categories: [] };
    })(),
    readJsonScope(join(HOME, ".claude", ".mcp.json"), "user", "~/.claude/.mcp.json", {}),
  ]);
  return { name: "Claude Code", version, icon: "claude", description: "Anthropic AI 编码助手 (schema: claude-code-settings.json)", scopes };
}
