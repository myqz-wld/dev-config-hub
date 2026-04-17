import { homedir } from "os";
import { join } from "path";

export const HOME = homedir();

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
