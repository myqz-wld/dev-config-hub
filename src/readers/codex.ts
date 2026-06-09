import type { ToolConfig, ConfigScope } from "../types.ts";
import { HOME, readFileIfExists, getToolVersion } from "../utils.ts";
import { join } from "path";

export async function readCodexConfig(): Promise<ToolConfig> {
  const version = await getToolVersion("codex --version");
  const configPath = join(HOME, ".codex", "config.toml");
  const agentsPath = join(HOME, ".codex", "AGENTS.md");
  const [config, agents] = await Promise.all([
    readFileIfExists(configPath),
    readFileIfExists(agentsPath),
  ]);
  const scopes: ConfigScope[] = [
    {
      level: "global",
      label: "~/.codex/config.toml",
      filePath: configPath,
      exists: config.exists,
      format: "toml",
      content: config.content,
    },
    {
      level: "user",
      label: "~/.codex/AGENTS.md",
      filePath: agentsPath,
      exists: agents.exists,
      format: "markdown",
      content: agents.content,
    },
  ];
  return {
    name: "Codex CLI", version, icon: "codex", description: "OpenAI AI 编码助手",
    scopes,
  };
}
