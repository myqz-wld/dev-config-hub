import { describe, expect, it } from "bun:test";
import {
  buildConfigToolDefinitions,
  profileToolRoot,
  type ConfigEnvironment,
} from "./config-locations.ts";
import { loadConfigTools, type ToolVersionMap } from "./config-loader.ts";

const MAC_ENV: ConfigEnvironment = {
  home: "/Users/test",
  platform: "darwin",
  fishInstalled: false,
  powerShellProfiles: [],
};

const VERSIONS: ToolVersionMap = {
  shell: "5.9",
  claude: "2.1",
  codex: "0.144",
  grok: "0.2",
  cursor: "3.11",
};

describe("user-level config catalog", () => {
  it("contains only user-level files and no project/local locations", () => {
    const definitions = buildConfigToolDefinitions(MAC_ENV);
    const files = definitions.flatMap((tool) => tool.files);
    expect(files.every((file) => file.level === "user")).toBe(true);
    const paths = files.map((file) => file.filePath).join("\n");
    expect(paths).not.toContain("settings.local.json");
    expect(paths).not.toContain("/.cursor/rules");
  });

  it("Claude exposes exactly settings.json and global CLAUDE.md", () => {
    const claude = buildConfigToolDefinitions(MAC_ENV).find((tool) => tool.id === "claude")!;
    expect(claude.files.map((file) => file.label)).toEqual([
      "~/.claude/settings.json",
      "~/.claude/CLAUDE.md",
    ]);
  });

  it("Grok Build exposes global instructions and documented user-level TOML layers", () => {
    const grok = buildConfigToolDefinitions(MAC_ENV).find((tool) => tool.id === "grok")!;
    expect(grok.name).toBe("Grok Build");
    expect(grok.files.map((file) => file.label)).toEqual([
      "~/.grok/config.toml",
      "~/.grok/AGENTS.md",
      "~/.grok/managed_config.toml",
      "~/.grok/requirements.toml",
    ]);
  });

  it("Cursor only exposes ~/.cursor/cli-config.json", () => {
    const cursor = buildConfigToolDefinitions(MAC_ENV).find((tool) => tool.id === "cursor")!;
    expect(cursor.files.map((file) => file.label)).toEqual([
      "~/.cursor/cli-config.json",
    ]);
  });

  it("CODEX_HOME / GROK_HOME and ZDOTDIR override their default roots", () => {
    const env: ConfigEnvironment = {
      ...MAC_ENV,
      codexHome: "~/configs/codex",
      grokHome: "/Users/test/configs/grok",
      zdotdir: "~/.config/zsh",
    };
    expect(profileToolRoot(env, "codex")).toBe("/Users/test/configs/codex");
    expect(profileToolRoot(env, "grok")).toBe("/Users/test/configs/grok");
    const grok = buildConfigToolDefinitions(env).find((tool) => tool.id === "grok")!;
    expect(grok.files[1]?.filePath).toBe("/Users/test/configs/grok/AGENTS.md");
    const shell = buildConfigToolDefinitions(env).find((tool) => tool.id === "shell")!;
    expect(shell.files[0]?.filePath).toBe("/Users/test/.config/zsh/.zshenv");
  });

  it("Windows uses discovered PowerShell profiles and ~/.cursor CLI config", () => {
    const env: ConfigEnvironment = {
      home: "C:\\Users\\test",
      platform: "win32",
      appData: "C:\\Users\\test\\AppData\\Roaming",
      fishInstalled: false,
      powerShellProfiles: [
        { label: "PowerShell 7 · CurrentUserAllHosts", path: "C:\\Profiles\\profile.ps1" },
        { label: "PowerShell 7 · CurrentUserCurrentHost", path: "C:\\Profiles\\host.ps1" },
      ],
    };
    const definitions = buildConfigToolDefinitions(env);
    const shell = definitions.find((tool) => tool.id === "shell")!;
    expect(shell.files.map((file) => file.filePath)).toEqual([
      "C:\\Profiles\\profile.ps1",
      "C:\\Profiles\\host.ps1",
    ]);
    const cursor = definitions.find((tool) => tool.id === "cursor")!;
    expect(cursor.files[0]?.filePath).toBe(
      "C:\\Users\\test\\.cursor\\cli-config.json",
    );
  });
});

describe("compact display selection", () => {
  it("hides missing optional files and selects AGENTS.override.md when it exists", async () => {
    const exists = new Set([
      "/Users/test/.codex/AGENTS.override.md",
      "/Users/test/.grok/managed_config.toml",
    ]);
    const tools = await loadConfigTools(MAC_ENV, VERSIONS, async (path) => ({
      exists: exists.has(path),
      content: exists.has(path) ? "present" : "",
    }));
    const codex = tools.find((tool) => tool.name === "Codex CLI")!;
    expect(codex.scopes.map((scope) => scope.label)).toEqual([
      "~/.codex/config.toml",
      "~/.codex/AGENTS.override.md",
    ]);
    const grok = tools.find((tool) => tool.name === "Grok Build")!;
    expect(grok.scopes.map((scope) => scope.label)).toContain("~/.grok/AGENTS.md");
    expect(grok.scopes.map((scope) => scope.label)).toContain("~/.grok/managed_config.toml");
    expect(grok.scopes.map((scope) => scope.label)).not.toContain("~/.grok/requirements.toml");
    const cursor = tools.find((tool) => tool.name === "Cursor")!;
    expect(cursor.scopes.map((scope) => scope.label)).toEqual(["~/.cursor/cli-config.json"]);
  });

  it("falls back to AGENTS.md when override is absent", async () => {
    const tools = await loadConfigTools(MAC_ENV, VERSIONS, async () => ({ exists: false, content: "" }));
    const codex = tools.find((tool) => tool.name === "Codex CLI")!;
    expect(codex.scopes.map((scope) => scope.label)).toEqual([
      "~/.codex/config.toml",
      "~/.codex/AGENTS.md",
    ]);
  });

  it("ignores an empty AGENTS.override.md in favor of a non-empty AGENTS.md", async () => {
    const tools = await loadConfigTools(MAC_ENV, VERSIONS, async (path) => {
      if (path.endsWith("AGENTS.override.md")) return { exists: true, content: "\n" };
      if (path.endsWith("AGENTS.md")) return { exists: true, content: "real instructions" };
      return { exists: false, content: "" };
    });
    const codex = tools.find((tool) => tool.name === "Codex CLI")!;
    expect(codex.scopes.map((scope) => scope.label)).toContain("~/.codex/AGENTS.md");
    expect(codex.scopes.map((scope) => scope.label)).not.toContain("~/.codex/AGENTS.override.md");
  });
});
