import type { ToolConfig, ConfigScope, ConfigEntry } from "../types.ts";
import { HOME, readFileIfExists, getToolVersion } from "../utils.ts";
import { OPENCODE_DESCRIPTIONS } from "../descriptions.ts";
import { IS_WIN } from "../platform.ts";
import { join } from "node:path";

function jsonToEntries(parsed: Record<string, unknown>, descMap: Record<string, string>): ConfigEntry[] {
  return Object.entries(parsed).map(([key, value]) => ({ key, value, type: typeof value, description: descMap[key] }));
}

/**
 * OpenCode config reader。
 *
 * 路径策略：
 * - POSIX：XDG `~/.config/opencode/opencode.json`（macOS / Linux 主流）
 * - Win：优先 `%APPDATA%\opencode\opencode.json`（Win 标准 user config 位置）；
 *   找不到回退 XDG（少数用户主动设了 XDG_CONFIG_HOME）
 */
export async function readOpenCodeConfig(): Promise<ToolConfig> {
  const version = await getToolVersion("opencode --version");

  let configPath: string;
  if (IS_WIN) {
    const appData = process.env.APPDATA;
    const winPath = appData ? join(appData, "opencode", "opencode.json") : "";
    const xdgPath = join(HOME, ".config", "opencode", "opencode.json");
    if (winPath) {
      const { exists } = await readFileIfExists(winPath);
      configPath = exists ? winPath : xdgPath;
    } else {
      configPath = xdgPath;
    }
  } else {
    configPath = join(HOME, ".config", "opencode", "opencode.json");
  }

  const { exists, content } = await readFileIfExists(configPath);

  let parsed: Record<string, unknown> = {};
  let items: ConfigEntry[] = [];
  if (exists && content.trim()) {
    try {
      parsed = JSON.parse(content);
      items = jsonToEntries(parsed, OPENCODE_DESCRIPTIONS);
    } catch { /* show raw only */ }
  }

  const label = IS_WIN
    ? configPath.includes("AppData")
      ? "%APPDATA%\\opencode\\opencode.json"
      : "~/.config/opencode/opencode.json"
    : "~/.config/opencode/opencode.json";

  return {
    name: "OpenCode", version, icon: "opencode", description: "开源 AI 编码助手",
    scopes: [{ level: "global", label, filePath: configPath, exists, format: "json", content, parsed,
      categories: items.length ? [{ name: "配置项", description: "", items }] : [] }],
  };
}
