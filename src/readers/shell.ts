import type { ToolConfig, ConfigScope } from "../types.ts";
import { HOME, readFileIfExists, getToolVersion } from "../utils.ts";
import { join } from "path";

export async function readShellConfig(): Promise<ToolConfig> {
  const version = await getToolVersion("zsh --version");

  const files: { level: ConfigScope["level"]; label: string; path: string }[] = [
    { level: "global", label: "~/.zprofile", path: join(HOME, ".zprofile") },
    { level: "user", label: "~/.zshrc", path: join(HOME, ".zshrc") },
  ];

  const scopes: ConfigScope[] = [];
  for (const { level, label, path } of files) {
    const { exists, content } = await readFileIfExists(path);
    scopes.push({
      level, label, filePath: path, exists, format: "dotfile",
      content, parsed: {}, categories: [],
    });
  }

  return {
    name: "Shell (Zsh)",
    version, icon: "terminal",
    description: "Zsh shell 环境配置",
    scopes,
  };
}
