import { HOME } from "./platform.ts";

export { HOME };

export async function readFileIfExists(
  filePath: string,
): Promise<{ exists: boolean; content: string; loadedMtimeUs: number | null }> {
  const file = Bun.file(filePath);
  const exists = await file.exists();
  if (!exists) return { exists: false, content: "", loadedMtimeUs: null };
  const content = await file.text();
  const stats = await file.stat();
  return { exists: true, content, loadedMtimeUs: Math.trunc(stats.mtimeMs * 1000) };
}

/**
 * 用 `Bun.spawn` 跑短命令拿版本号。传 argv 数组，以支持含空格的二进制路径；
 *
 * Bun 在 Win 上 `Bun.spawn` 自动 PATHEXT 解析（`.exe` / `.cmd` / `.bat` 都能命中），
 * 所以 `["claude", "--version"]` 在 Win 上能找到 `claude.exe` / `claude.cmd`。
 */
export async function getToolVersion(argv: string[]): Promise<string> {
  try {
    const proc = Bun.spawn(argv, {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const match = `${stdout}${stderr}`.match(/[\d]+\.[\d]+(?:\.[\d]+)?/);
    return match ? match[0] : "unknown";
  } catch {
    return "not installed";
  }
}
