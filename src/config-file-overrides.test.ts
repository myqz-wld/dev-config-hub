import { describe, expect, it } from "bun:test";
import {
  addConfigFileOverride,
  applyConfigFileOverrides,
  configFileOverridesPath,
  displayConfigPath,
  emptyConfigFileOverrides,
  configPathKey,
  hasConfigFileOverrides,
  inferConfigFileFormat,
  parseConfigFileOverrides,
  removeConfigFileOverride,
  resetConfigFileOverrides,
  serializeConfigFileOverrides,
  type ConfigFileOverridesV1,
} from "./config-file-overrides.ts";
import {
  buildConfigToolDefinitions,
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

describe("config file override store", () => {
  it("serializes a deterministic versioned store and parses it back", () => {
    const next = addConfigFileOverride(
      emptyConfigFileOverrides(),
      MAC_ENV,
      "claude",
      "/Users/test/projects/demo/settings.jsonc",
    );
    const text = serializeConfigFileOverrides(next);
    expect(text.endsWith("\n")).toBeTrue();
    expect(JSON.parse(text).version).toBe(1);
    expect(parseConfigFileOverrides(text, "darwin")).toEqual(next);
    expect(configFileOverridesPath(MAC_ENV)).toBe("/Users/test/.dch/config-files.json");
  });

  it("rejects malformed or unsupported stores instead of silently overwriting them", () => {
    expect(() => parseConfigFileOverrides("{bad", "darwin")).toThrow(/无法解析/);
    expect(() => parseConfigFileOverrides('{"version":2,"tools":{}}', "darwin"))
      .toThrow(/仅支持 version 1/);
    expect(() => parseConfigFileOverrides(
      '{"version":1,"tools":{"claude":{"added":[],"removed":[42]}}}',
      "darwin",
    )).toThrow(/claude\.removed/);
  });

  it("infers editor formats and keeps the original path casing in labels", () => {
    expect(inferConfigFileFormat("a.jsonc")).toBe("jsonc");
    expect(inferConfigFileFormat("a.toml")).toBe("toml");
    expect(inferConfigFileFormat("README.md")).toBe("markdown");
    expect(inferConfigFileFormat("profile.ps1")).toBe("powershell");
    expect(inferConfigFileFormat(".env")).toBe("dotfile");
    expect(displayConfigPath("C:\\Users\\Test\\MyConfig.JSON", {
      ...MAC_ENV,
      home: "C:\\Users\\Test",
      platform: "win32",
    })).toBe("~/MyConfig.JSON");
    expect(configPathKey("/Users/test/name\\with-backslash", "darwin"))
      .toBe("/Users/test/name\\with-backslash");
    expect(displayConfigPath("/Users/test/name\\with-backslash", MAC_ENV))
      .toBe("~/name\\with-backslash");
  });

  it("removes a factory file without mutating the original store, then restores defaults", () => {
    const original = emptyConfigFileOverrides();
    const removed = removeConfigFileOverride(
      original,
      MAC_ENV,
      "claude",
      "/Users/test/.claude/settings.json",
    );
    expect(original).toEqual({ version: 1, tools: {} });
    expect(hasConfigFileOverrides(removed, "claude")).toBeTrue();

    const definitions = applyConfigFileOverrides(
      buildConfigToolDefinitions(MAC_ENV),
      removed,
      MAC_ENV,
    );
    const claude = definitions.find((tool) => tool.id === "claude")!;
    expect(claude.files.map((file) => file.label)).toEqual(["~/.claude/CLAUDE.md"]);
    expect(resetConfigFileOverrides(removed, "claude")).toEqual(original);
  });

  it("adds a HOME file to one tool and ignores tampered arbitrary outside-HOME paths", () => {
    const inside = addConfigFileOverride(
      emptyConfigFileOverrides(),
      MAC_ENV,
      "grok",
      "/Users/test/projects/demo/tool.yaml",
    );
    const tampered: ConfigFileOverridesV1 = {
      version: 1,
      tools: {
        ...inside.tools,
        cursor: { added: [{ filePath: "/etc/hosts", format: "dotfile" }], removed: [] },
      },
    };
    const definitions = applyConfigFileOverrides(
      buildConfigToolDefinitions(MAC_ENV),
      tampered,
      MAC_ENV,
    );
    const grok = definitions.find((tool) => tool.id === "grok")!;
    expect(grok.files.at(-1)).toMatchObject({
      label: "~/projects/demo/tool.yaml",
      filePath: "/Users/test/projects/demo/tool.yaml",
      format: "dotfile",
    });
    const cursor = definitions.find((tool) => tool.id === "cursor")!;
    expect(cursor.files.some((file) => file.filePath === "/etc/hosts")).toBeFalse();
  });

  it("pins a manually selected factory alternative so both Codex instruction files show", async () => {
    const overrides = addConfigFileOverride(
      emptyConfigFileOverrides(),
      MAC_ENV,
      "codex",
      "/Users/test/.codex/AGENTS.md",
    );
    const tools = await loadConfigTools(MAC_ENV, VERSIONS, async (path) => ({
      exists: path.endsWith("AGENTS.override.md") || path.endsWith("AGENTS.md"),
      content: "instructions",
    }), overrides);
    const codex = tools.find((tool) => tool.id === "codex")!;
    expect(codex.scopes.map((scope) => scope.label)).toEqual([
      "~/.codex/config.toml",
      "~/.codex/AGENTS.override.md",
      "~/.codex/AGENTS.md",
    ]);
  });
});
