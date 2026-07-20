import { HOME } from "./platform.ts";

export { HOME };

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
 * 用 `Bun.spawn` 跑短命令拿版本号。优先传 argv 数组，以支持含空格的二进制路径；
 * string 形式仅为旧调用方兼容，会按空格做简单切分。
 *
 * Bun 在 Win 上 `Bun.spawn` 自动 PATHEXT 解析（`.exe` / `.cmd` / `.bat` 都能命中），
 * 所以 `["claude", "--version"]` 在 Win 上能找到 `claude.exe` / `claude.cmd`。
 */
export async function getToolVersion(command: string | string[]): Promise<string> {
  try {
    const argv = typeof command === "string" ? command.split(" ") : command;
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
