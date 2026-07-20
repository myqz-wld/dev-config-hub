import { join } from "node:path";
import { existsSync } from "node:fs";
import { HOME } from "./platform.ts";
import type {
  ConfigEnvironment,
  PowerShellProfileLocation,
  SupportedPlatform,
} from "./config-locations.ts";

function platform(): SupportedPlatform {
  if (process.platform === "win32") return "win32";
  if (process.platform === "darwin") return "darwin";
  return "linux";
}

function baseEnvironment(): ConfigEnvironment {
  return {
    home: HOME,
    platform: platform(),
    codexHome: process.env.CODEX_HOME ?? null,
    grokHome: process.env.GROK_HOME ?? null,
    zdotdir: process.env.ZDOTDIR ?? null,
    xdgConfigHome: process.env.XDG_CONFIG_HOME ?? null,
    appData: process.env.APPDATA ?? null,
    fishInstalled: Boolean(Bun.which("fish")),
    powerShellProfiles: [],
  };
}

async function queryPowerShellProfiles(
  binary: string,
  productLabel: string,
): Promise<PowerShellProfileLocation[]> {
  if (!Bun.which(binary)) return [];
  try {
    const script = [
      "$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()",
      "Write-Output $PROFILE.CurrentUserAllHosts",
      "Write-Output $PROFILE.CurrentUserCurrentHost",
    ].join("; ");
    const proc = Bun.spawn([binary, "-NoProfile", "-NonInteractive", "-Command", script], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const paths = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (paths.length < 2) return [];
    return [
      { label: `${productLabel} · CurrentUserAllHosts`, path: paths[0]! },
      { label: `${productLabel} · CurrentUserCurrentHost`, path: paths[1]! },
    ];
  } catch {
    return [];
  }
}

function fallbackWindowsProfiles(): PowerShellProfileLocation[] {
  return [
    {
      label: "Windows PowerShell · CurrentUserAllHosts",
      path: join(HOME, "Documents", "WindowsPowerShell", "profile.ps1"),
    },
    {
      label: "Windows PowerShell · CurrentUserCurrentHost",
      path: join(HOME, "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1"),
    },
  ];
}

function existingProfiles(
  productLabel: string,
  directory: string,
): PowerShellProfileLocation[] {
  return [
    { label: `${productLabel} · CurrentUserAllHosts`, path: join(directory, "profile.ps1") },
    {
      label: `${productLabel} · CurrentUserCurrentHost`,
      path: join(directory, "Microsoft.PowerShell_profile.ps1"),
    },
  ].filter((profile) => existsSync(profile.path));
}

export function getNodeConfigEnvironmentSync(): ConfigEnvironment {
  return baseEnvironment();
}

export async function getNodeConfigEnvironment(): Promise<ConfigEnvironment> {
  const env = baseEnvironment();
  if (env.platform === "win32") {
    const [windowsPowerShell, powerShell7] = await Promise.all([
      queryPowerShellProfiles("powershell", "Windows PowerShell"),
      queryPowerShellProfiles("pwsh", "PowerShell 7"),
    ]);
    env.powerShellProfiles = [
      ...(windowsPowerShell.length > 0 ? windowsPowerShell : fallbackWindowsProfiles()),
      ...(powerShell7.length > 0
        ? powerShell7
        : existingProfiles("PowerShell 7", join(HOME, "Documents", "PowerShell"))),
    ];
  } else {
    const powerShell = await queryPowerShellProfiles("pwsh", "PowerShell");
    env.powerShellProfiles = powerShell.length > 0
      ? powerShell
      : existingProfiles("PowerShell", join(HOME, ".config", "powershell"));
  }
  return env;
}
