import { homedir } from "node:os";

/**
 * 跨平台运行时常量与工具。集中收口 `process.platform === '...'` 判断与平台相关 fallback，
 * 避免散落各处。新增 / 调整平台分支时统一改这里。
 */

export const IS_DARWIN = process.platform === "darwin";
export const IS_WIN = process.platform === "win32";
export const IS_LINUX = process.platform === "linux";

/** 用户主目录。优先用 `os.homedir()` 而非 `process.env.HOME`：Win 默认无 `HOME` 环境变量。 */
export const HOME = homedir();

/**
 * 抽象 shell-script runner：给 `Bun.spawn` / `child_process` 选合适的 shell 跑用户提供的
 * inline script（典型场景：profile.preSwitch / postSwitch hook 内的 bash 命令）。
 *
 * - Win：默认 `powershell -NoProfile -Command <script>`（PowerShell 5.1 内置；7.x 需 `pwsh`）
 * - macOS / Linux：默认 `bash -lc <script>`（login shell 才能拿到 brew / nvm 等 PATH 注入）
 *
 * 该函数仅产出"该如何 spawn"的描述，不实际 spawn —— 交给调用方自己 `Bun.spawn(...)`，
 * 避免把 stdio / env 等参数耦合进来。
 */
export interface ShellRunner {
  cmd: string;
  args: (script: string) => string[];
  kind: "powershell" | "bash" | "cmd";
}

export function defaultShellRunner(): ShellRunner {
  if (IS_WIN) {
    return {
      cmd: "powershell",
      args: (s) => ["-NoProfile", "-Command", s],
      kind: "powershell",
    };
  }
  return {
    cmd: "bash",
    args: (s) => ["-lc", s],
    kind: "bash",
  };
}

/**
 * 默认编辑器选择：
 * - 优先 `$EDITOR` / `$VISUAL`（用户显式偏好）
 * - Win fallback `notepad`（每台 Win 都有；vi 在 Win 默认无）
 * - POSIX fallback `vi`（macOS / 大多 Linux 默认装）
 */
export function defaultEditor(): string {
  return process.env.EDITOR || process.env.VISUAL || (IS_WIN ? "notepad" : "vi");
}
