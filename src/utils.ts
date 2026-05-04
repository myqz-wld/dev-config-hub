import { join } from "node:path";
import { HOME } from "./platform.ts";

export { HOME };

export function expandHome(p: string): string {
  return p.startsWith("~") ? join(HOME, p.slice(1)) : p;
}

export async function readFileIfExists(
  filePath: string,
): Promise<{ exists: boolean; content: string }> {
  const file = Bun.file(filePath);
  const exists = await file.exists();
  if (!exists) return { exists: false, content: "" };
  const content = await file.text();
  return { exists: true, content };
}

/**
 * 用 `Bun.spawn` 跑「短命令名 + 简单参数」拿版本号。
 *
 * 注意：`command.split(" ")` 不能处理含空格的二进制路径或 quoted args。
 * 当前所有调用方都是 `<tool> --version` / 简单形式，不触发此问题。
 * **不要传 `'/path with space/tool --version'` 这种**——会被 split 误切。
 *
 * Bun 在 Win 上 `Bun.spawn` 自动 PATHEXT 解析（`.exe` / `.cmd` / `.bat` 都能命中），
 * 所以 `["claude", "--version"]` 在 Win 上能找到 `claude.exe` / `claude.cmd`。
 */
export async function getToolVersion(command: string): Promise<string> {
  try {
    const proc = Bun.spawn(command.split(" "), {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    const match = output.match(/[\d]+\.[\d]+(?:\.[\d]+)?/);
    return match ? match[0] : "unknown";
  } catch {
    return "not installed";
  }
}
