import type { ConfigScope } from "./types.ts";

export const CONFIG_TOOL_IDS = ["shell", "claude", "codex", "grok", "cursor"] as const;
export type ConfigToolId = (typeof CONFIG_TOOL_IDS)[number];

export const PROFILE_TOOL_IDS = ["claude", "codex", "grok", "cursor"] as const;
export type ProfileToolId = (typeof PROFILE_TOOL_IDS)[number];

export type SupportedPlatform = "darwin" | "win32" | "linux";

export interface PowerShellProfileLocation {
  label: string;
  path: string;
}

/** Runtime values are collected by Node for the CLI and by Rust for the Tauri UI. */
export interface ConfigEnvironment {
  home: string;
  platform: SupportedPlatform;
  codexHome?: string | null;
  grokHome?: string | null;
  zdotdir?: string | null;
  xdgConfigHome?: string | null;
  appData?: string | null;
  fishInstalled: boolean;
  powerShellProfiles: PowerShellProfileLocation[];
}

export interface ConfigFileLocation {
  level: ConfigScope["level"];
  label: string;
  filePath: string;
  format: ConfigScope["format"];
  /** Valid starter content for a newly created file. */
  initialContent?: string;
  /** Missing optional files stay out of the UI to keep the list compact. */
  optional?: boolean;
  /** Only the highest-priority existing file in a group is shown. */
  alternativeGroup?: string;
  alternativePriority?: number;
}

export interface ConfigToolDefinition {
  id: ConfigToolId;
  name: string;
  icon: string;
  description: string;
  files: ConfigFileLocation[];
}

function separator(platform: SupportedPlatform): string {
  return platform === "win32" ? "\\" : "/";
}

export function joinConfigPath(
  platform: SupportedPlatform,
  base: string,
  ...parts: string[]
): string {
  const sep = separator(platform);
  const cleanBase = base.replace(/[\\/]+$/, "");
  const cleanParts = parts.map((p) => p.replace(/^[\\/]+|[\\/]+$/g, ""));
  return [cleanBase, ...cleanParts].filter(Boolean).join(sep);
}

export function expandConfigRoot(value: string | null | undefined, env: ConfigEnvironment): string | null {
  if (!value) return null;
  if (value === "~") return env.home;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return joinConfigPath(env.platform, env.home, value.slice(2));
  }
  return value;
}

export function profileToolRoot(env: ConfigEnvironment, tool: ProfileToolId): string {
  switch (tool) {
    case "claude":
      return joinConfigPath(env.platform, env.home, ".claude");
    case "codex":
      return expandConfigRoot(env.codexHome, env)
        ?? joinConfigPath(env.platform, env.home, ".codex");
    case "grok":
      return expandConfigRoot(env.grokHome, env)
        ?? joinConfigPath(env.platform, env.home, ".grok");
    case "cursor":
      return joinConfigPath(env.platform, env.home, ".cursor");
  }
}

function rootLabel(envValue: string | null | undefined, fallback: string, variable: string): string {
  return envValue ? `$${variable}` : fallback;
}

function cursorUserDir(env: ConfigEnvironment): { path: string; label: string } {
  if (env.platform === "darwin") {
    return {
      path: joinConfigPath(env.platform, env.home, "Library", "Application Support", "Cursor", "User"),
      label: "~/Library/Application Support/Cursor/User",
    };
  }
  if (env.platform === "win32") {
    const base = expandConfigRoot(env.appData, env)
      ?? joinConfigPath(env.platform, env.home, "AppData", "Roaming");
    return {
      path: joinConfigPath(env.platform, base, "Cursor", "User"),
      label: env.appData ? "%APPDATA%\\Cursor\\User" : "~/AppData/Roaming/Cursor/User",
    };
  }
  const xdg = expandConfigRoot(env.xdgConfigHome, env)
    ?? joinConfigPath(env.platform, env.home, ".config");
  return {
    path: joinConfigPath(env.platform, xdg, "Cursor", "User"),
    label: env.xdgConfigHome ? "$XDG_CONFIG_HOME/Cursor/User" : "~/.config/Cursor/User",
  };
}

function shellFiles(env: ConfigEnvironment): ConfigFileLocation[] {
  if (env.platform === "win32") {
    return env.powerShellProfiles.map((p) => ({
      level: "user",
      label: p.label,
      filePath: p.path,
      format: "powershell",
    }));
  }

  const zshRoot = expandConfigRoot(env.zdotdir, env) ?? env.home;
  const zshLabel = env.zdotdir ? "$ZDOTDIR" : "~";
  const xdg = expandConfigRoot(env.xdgConfigHome, env)
    ?? joinConfigPath(env.platform, env.home, ".config");
  const fishLabel = env.xdgConfigHome
    ? "$XDG_CONFIG_HOME/fish/config.fish"
    : "~/.config/fish/config.fish";

  const files: ConfigFileLocation[] = [".zshenv", ".zprofile", ".zshrc"].map((name) => ({
    level: "user",
    label: `${zshLabel}/${name}`,
    filePath: joinConfigPath(env.platform, zshRoot, name),
    format: "dotfile",
  }));

  files.push(
    { level: "user", label: "~/.bash_profile", filePath: joinConfigPath(env.platform, env.home, ".bash_profile"), format: "dotfile" },
    { level: "user", label: "~/.bashrc", filePath: joinConfigPath(env.platform, env.home, ".bashrc"), format: "dotfile" },
    { level: "user", label: "~/.profile", filePath: joinConfigPath(env.platform, env.home, ".profile"), format: "dotfile" },
    {
      level: "user",
      label: fishLabel,
      filePath: joinConfigPath(env.platform, xdg, "fish", "config.fish"),
      format: "dotfile",
      optional: !env.fishInstalled,
    },
    ...env.powerShellProfiles.map((p) => ({
      level: "user" as const,
      label: p.label,
      filePath: p.path,
      format: "powershell" as const,
    })),
  );
  return files;
}

export function buildConfigToolDefinitions(env: ConfigEnvironment): ConfigToolDefinition[] {
  const claudeRoot = profileToolRoot(env, "claude");
  const codexRoot = profileToolRoot(env, "codex");
  const grokRoot = profileToolRoot(env, "grok");
  const cursorRoot = profileToolRoot(env, "cursor");
  const cursorUser = cursorUserDir(env);
  const codexLabel = rootLabel(env.codexHome, "~/.codex", "CODEX_HOME");
  const grokLabel = rootLabel(env.grokHome, "~/.grok", "GROK_HOME");

  return [
    {
      id: "shell",
      name: "Shell",
      icon: "terminal",
      description: env.platform === "win32"
        ? "PowerShell 用户配置"
        : "Zsh / Bash 用户环境配置（按需发现 Fish / PowerShell）",
      files: shellFiles(env),
    },
    {
      id: "claude",
      name: "Claude Code",
      icon: "claude",
      description: "Anthropic AI 编码助手",
      files: [
        { level: "user", label: "~/.claude/settings.json", filePath: joinConfigPath(env.platform, claudeRoot, "settings.json"), format: "json", initialContent: "{}\n" },
        { level: "user", label: "~/.claude/CLAUDE.md", filePath: joinConfigPath(env.platform, claudeRoot, "CLAUDE.md"), format: "markdown" },
      ],
    },
    {
      id: "codex",
      name: "Codex CLI",
      icon: "codex",
      description: "OpenAI AI 编码助手",
      files: [
        { level: "user", label: `${codexLabel}/config.toml`, filePath: joinConfigPath(env.platform, codexRoot, "config.toml"), format: "toml" },
        {
          level: "user",
          label: `${codexLabel}/AGENTS.override.md`,
          filePath: joinConfigPath(env.platform, codexRoot, "AGENTS.override.md"),
          format: "markdown",
          optional: true,
          alternativeGroup: "codex-global-instructions",
          alternativePriority: 0,
        },
        {
          level: "user",
          label: `${codexLabel}/AGENTS.md`,
          filePath: joinConfigPath(env.platform, codexRoot, "AGENTS.md"),
          format: "markdown",
          alternativeGroup: "codex-global-instructions",
          alternativePriority: 1,
        },
      ],
    },
    {
      id: "grok",
      name: "Grok",
      icon: "grok",
      description: "Grok Build 编码助手",
      files: [
        { level: "user", label: `${grokLabel}/config.toml`, filePath: joinConfigPath(env.platform, grokRoot, "config.toml"), format: "toml" },
        { level: "user", label: `${grokLabel}/managed_config.toml`, filePath: joinConfigPath(env.platform, grokRoot, "managed_config.toml"), format: "toml", optional: true },
        { level: "user", label: `${grokLabel}/requirements.toml`, filePath: joinConfigPath(env.platform, grokRoot, "requirements.toml"), format: "toml", optional: true },
      ],
    },
    {
      id: "cursor",
      name: "Cursor",
      icon: "cursor",
      description: "AI 代码编辑器与 Agent 配置",
      files: [
        { level: "user", label: `${cursorUser.label}/settings.json`, filePath: joinConfigPath(env.platform, cursorUser.path, "settings.json"), format: "jsonc", initialContent: "{}\n" },
        { level: "user", label: `${cursorUser.label}/keybindings.json`, filePath: joinConfigPath(env.platform, cursorUser.path, "keybindings.json"), format: "jsonc", initialContent: "[]\n" },
        { level: "user", label: "~/.cursor/mcp.json", filePath: joinConfigPath(env.platform, cursorRoot, "mcp.json"), format: "json", initialContent: "{}\n" },
        { level: "user", label: "~/.cursor/cli-config.json", filePath: joinConfigPath(env.platform, cursorRoot, "cli-config.json"), format: "json", initialContent: "{}\n" },
        { level: "user", label: "~/.cursor/hooks.json", filePath: joinConfigPath(env.platform, cursorRoot, "hooks.json"), format: "json", initialContent: "{}\n", optional: true },
      ],
    },
  ];
}
