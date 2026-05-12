import type { ToolConfig, ConfigScope } from "../types.ts";
import { HOME, readFileIfExists, getToolVersion } from "../utils.ts";
import { join } from "path";

export async function readCodexConfig(): Promise<ToolConfig> {
  const version = await getToolVersion("codex --version");
  const configPath = join(HOME, ".codex", "config.toml");
  const { exists, content } = await readFileIfExists(configPath);
  const scope: ConfigScope = {
    level: "global",
    label: "~/.codex/config.toml",
    filePath: configPath,
    exists,
    format: "toml",
    content,
  };
  return {
    name: "Codex CLI", version, icon: "codex", description: "OpenAI AI 编码助手",
    scopes: [scope],
  };
}
