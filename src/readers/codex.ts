import type { ToolConfig, ConfigScope, ConfigEntry } from "../types.ts";
import { HOME, readFileIfExists, getToolVersion, maskObject } from "../utils.ts";
import { CODEX_DESCRIPTIONS } from "../descriptions.ts";
import { join } from "path";
import { parse as parseToml } from "smol-toml";

function tomlToEntries(parsed: Record<string, unknown>, descMap: Record<string, string>): ConfigEntry[] {
  return Object.entries(parsed).map(([key, value]) => ({
    key, value, type: typeof value, description: descMap[key],
  }));
}

export async function readCodexConfig(): Promise<ToolConfig> {
  const version = await getToolVersion("codex --version");
  const configPath = join(HOME, ".codex", "config.toml");
  const { exists, content, rawContent } = await readFileIfExists(configPath);

  let parsed: Record<string, unknown> = {};
  let items: ConfigEntry[] = [];

  if (exists && rawContent.trim()) {
    try {
      parsed = parseToml(rawContent) as Record<string, unknown>;
      const masked = maskObject(parsed);
      items = tomlToEntries(masked, CODEX_DESCRIPTIONS);
      parsed = masked;
    } catch { /* show raw only */ }
  }

  return {
    name: "Codex CLI", version, icon: "codex",
    description: "OpenAI AI 编码助手 (docs: developers.openai.com/codex/config-reference)",
    scopes: [{
      level: "global", label: "~/.codex/config.toml", filePath: configPath,
      exists, format: "toml", content, parsed,
      categories: items.length > 0 ? [{ name: "配置项", description: "", items }] : [],
    }],
  };
}
