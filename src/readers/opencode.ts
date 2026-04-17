import type { ToolConfig, ConfigScope, ConfigEntry } from "../types.ts";
import { HOME, readFileIfExists, getToolVersion, maskObject } from "../utils.ts";
import { OPENCODE_DESCRIPTIONS } from "../descriptions.ts";
import { join } from "path";

function jsonToEntries(parsed: Record<string, unknown>, descMap: Record<string, string>): ConfigEntry[] {
  return Object.entries(parsed).map(([key, value]) => ({
    key, value, type: typeof value, description: descMap[key],
  }));
}

export async function readOpenCodeConfig(): Promise<ToolConfig> {
  const version = await getToolVersion("opencode --version");
  const configPath = join(HOME, ".config", "opencode", "opencode.json");
  const { exists, content, rawContent } = await readFileIfExists(configPath);

  let parsed: Record<string, unknown> = {};
  let items: ConfigEntry[] = [];

  if (exists && rawContent.trim()) {
    try {
      parsed = JSON.parse(rawContent);
      const masked = maskObject(parsed);
      items = jsonToEntries(masked, OPENCODE_DESCRIPTIONS);
      parsed = masked;
    } catch { /* show raw only */ }
  }

  return {
    name: "OpenCode", version, icon: "opencode",
    description: "开源 AI 编码助手 (schema: opencode.ai/config.json)",
    scopes: [{
      level: "global", label: "~/.config/opencode/opencode.json", filePath: configPath,
      exists, format: "json", content, parsed,
      categories: items.length > 0 ? [{ name: "配置项", description: "", items }] : [],
    }],
  };
}
