import type { Profile, TerminalApp, ToolKind } from "./types.ts";
import { expandHome } from "./store.ts";

const TOOL_ENV_KEY: Record<ToolKind, string> = {
  claude: "CLAUDE_CONFIG_DIR",
  codex: "CODEX_HOME",
};

function shellQuote(s: string): string {
  // 单引号转义：把 ' 替换成 '\''
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function osascriptEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildExports(profile: Profile): string {
  const env: Record<string, string> = { ...(profile.env ?? {}) };
  const k = TOOL_ENV_KEY[profile.tool];
  env[k] = expandHome(profile.configDir);
  return Object.entries(env)
    .map(([key, val]) => `export ${key}=${shellQuote(val)}`)
    .join("; ");
}

export interface SpawnResult {
  terminal: TerminalApp;
  command: string;
}

export async function spawnTerminal(
  profile: Profile,
  terminal: TerminalApp,
): Promise<SpawnResult> {
  const exports = buildExports(profile);
  const shell = process.env.SHELL || "/bin/zsh";
  const inner = `${exports}; exec ${shell} -l`;

  let osa: string[];
  switch (terminal) {
    case "Terminal":
      osa = [
        "osascript",
        "-e", `tell application "Terminal" to do script "${osascriptEscape(inner)}"`,
        "-e", 'tell application "Terminal" to activate',
      ];
      break;
    case "iTerm":
      osa = [
        "osascript",
        "-e", `tell application "iTerm" to create window with default profile command "${osascriptEscape(`${shell} -lc ${shellQuote(inner)}`)}"`,
        "-e", 'tell application "iTerm" to activate',
      ];
      break;
    case "Ghostty":
      // Ghostty AppleScript 支持有限，用 open -na 兜底
      osa = ["open", "-na", "Ghostty", "--args", "-e", inner];
      break;
  }

  const proc = Bun.spawn(osa, { stdout: "pipe", stderr: "pipe" });
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  if ((proc.exitCode ?? 0) !== 0) {
    throw new Error(`spawn ${terminal} 失败 (exit ${proc.exitCode}): ${stderr.trim()}`);
  }
  return { terminal, command: inner };
}
