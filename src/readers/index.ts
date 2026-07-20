import { existsSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_TOOL_IDS, type ConfigToolId } from "../config-locations.ts";
import { getNodeConfigEnvironment } from "../config-environment.ts";
import { loadConfigTools, type ToolVersionMap } from "../config-loader.ts";
import { getToolVersion, readFileIfExists } from "../utils.ts";

async function shellVersion(platform: NodeJS.Platform): Promise<string> {
  if (platform === "win32") {
    return getToolVersion([
      Bun.which("pwsh") ?? Bun.which("powershell") ?? "powershell",
      "-NoProfile",
      "-Command",
      "$PSVersionTable.PSVersion.ToString()",
    ]);
  }
  const shell = process.env.SHELL || Bun.which("zsh") || Bun.which("bash") || "/bin/sh";
  return getToolVersion([shell, "--version"]);
}

async function cursorVersion(): Promise<string> {
  for (const binary of ["cursor-agent", "cursor"]) {
    const cli = Bun.which(binary);
    if (!cli) continue;
    const version = await getToolVersion([cli, "--version"]);
    if (version !== "unknown" && version !== "not installed") return version;
  }

  if (process.platform === "darwin") {
    const candidates = [
      "/Applications/Cursor.app/Contents/Info",
      join(process.env.HOME ?? "", "Applications", "Cursor.app", "Contents", "Info"),
    ];
    for (const plist of candidates) {
      if (!existsSync(`${plist}.plist`)) continue;
      const version = await getToolVersion(["/usr/bin/defaults", "read", plist, "CFBundleShortVersionString"]);
      if (version !== "unknown" && version !== "not installed") return version;
    }
  }

  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    const exe = local ? join(local, "Programs", "cursor", "Cursor.exe") : "";
    if (exe && existsSync(exe)) return getToolVersion([exe, "--version"]);
  }
  return "not installed";
}

async function loadVersions(): Promise<ToolVersionMap> {
  const entries = await Promise.all([
    shellVersion(process.platform),
    getToolVersion(["claude", "--version"]),
    getToolVersion(["codex", "--version"]),
    getToolVersion(["grok", "--version"]),
    cursorVersion(),
  ]);
  return Object.fromEntries(CONFIG_TOOL_IDS.map((id, index) => [id, entries[index]!])) as ToolVersionMap;
}

export async function readAllToolConfigs() {
  const [env, versions] = await Promise.all([
    getNodeConfigEnvironment(),
    loadVersions(),
  ]);
  return loadConfigTools(env, versions, readFileIfExists);
}

export function toolIndex(tool: ConfigToolId): number {
  return CONFIG_TOOL_IDS.indexOf(tool);
}
