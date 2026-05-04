import type { ToolConfig, ConfigScope } from "../types.ts";
import { HOME, readFileIfExists, getToolVersion } from "../utils.ts";
import { IS_WIN } from "../platform.ts";
import { join } from "node:path";

/**
 * Shell 配置 reader。POSIX 读 zsh + bash 配置；Windows 读 PowerShell `$PROFILE`
 * （CurrentUserCurrentHost）+ AllUsersAllHosts。POSIX bash 配置作为顺手补充
 * （macOS 默认 zsh，Linux 多数 bash）。
 */
export async function readShellConfig(): Promise<ToolConfig> {
  const isWin = IS_WIN;
  const version = await getToolVersion(isWin ? "powershell -NoProfile -Command $PSVersionTable.PSVersion.ToString()" : "zsh --version");

  const files: { level: ConfigScope["level"]; label: string; path: string }[] = isWin
    ? [
        // PowerShell $PROFILE 默认 CurrentUserCurrentHost
        { level: "user", label: "$PROFILE (CurrentUser)", path: join(HOME, "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1") },
        { level: "user", label: "$PROFILE (PowerShell 7)", path: join(HOME, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1") },
      ]
    : [
        { level: "global", label: "~/.zprofile", path: join(HOME, ".zprofile") },
        { level: "user", label: "~/.zshrc", path: join(HOME, ".zshrc") },
        // Linux 顺手覆盖 bash（macOS bash 也常见）
        { level: "user", label: "~/.bashrc", path: join(HOME, ".bashrc") },
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
    name: isWin ? "Shell (PowerShell)" : "Shell (Zsh / Bash)",
    version, icon: "terminal",
    description: isWin ? "PowerShell profile 配置" : "Zsh / Bash shell 环境配置",
    scopes,
  };
}
