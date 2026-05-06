import { describe, expect, it } from "bun:test";
import { detectScope, getSchemaForScope, listRegisteredSchemas } from "./registry.ts";

const HOME = "/Users/test";

describe("detectScope", () => {
  const cases: Array<[string, ReturnType<typeof detectScope>]> = [
    [".claude/settings.json", "claude-settings"],
    [".claude/settings.local.json", "claude-settings-local"],
    [".claude/.mcp.json", "claude-mcp"],
    [".claude/CLAUDE.md", "claude-md"],
    [".codex/config.toml", "codex-config"],
    [".config/opencode/opencode.json", "opencode-config"],
    [".dch/profiles.json", "dch-store"],
    [".zshrc", "shell-rc"],
    [".zprofile", "shell-rc"],
    [".bashrc", "shell-rc"],
  ];
  for (const [rel, expected] of cases) {
    it(`${rel} → ${expected}`, () => {
      expect(detectScope(`${HOME}/${rel}`, HOME)).toBe(expected);
    });
  }

  it("绝对路径不在 home 下且非已知 basename → null", () => {
    expect(detectScope("/etc/foo.json", HOME)).toBeNull();
  });

  it("settings.local.json 必须先于 settings.json 匹配（防前缀误吃）", () => {
    expect(detectScope(`${HOME}/.claude/settings.local.json`, HOME)).toBe("claude-settings-local");
    expect(detectScope(`${HOME}/.claude/settings.json`, HOME)).toBe("claude-settings");
  });

  // ─── REVIEW_3 R_1·C5 / C13 回归 ───
  it("REVIEW_3 R_1·C5: home 前缀子串误判 — /Users/test_other/.zshrc + home=/Users/test → null", () => {
    // 修复前：startsWith("/Users/test") 命中 /Users/test_other → stripHome 剩 _other/.zshrc
    //         → baseName=".zshrc" → 错归 shell-rc
    // 修复后：必须 home + "/" 边界比对，相邻前缀不再误吃，home 外路径直接 null
    expect(detectScope("/Users/test_other/.zshrc", HOME)).toBeNull();
    expect(detectScope("/Users/test123/.bashrc", HOME)).toBeNull();
  });

  it("REVIEW_3 R_1·C5: home 前缀子串误判 — /foo.claude/settings.json + home=/foo → null", () => {
    // codex repro：仅差一个 . 字符的相邻路径
    expect(detectScope("/foo.claude/settings.json", "/foo")).toBeNull();
  });

  it("REVIEW_3 R_1·C5: absPath 恰等于 home → 无 basename 命中 → null", () => {
    expect(detectScope(HOME, HOME)).toBeNull();
  });

  it("REVIEW_3 R_1·C5: home 末尾带斜杠 → 与不带斜杠等价", () => {
    expect(detectScope("/Users/test/.zshrc", "/Users/test/")).toBe("shell-rc");
    expect(detectScope("/Users/test/.claude/settings.json", "/Users/test/")).toBe("claude-settings");
  });

  it("REVIEW_3 R_1·C5: home 外路径（含 /tmp/.zshrc）一律 null — 严格 home 内才识别 scope", () => {
    // detectScope 语义是「这个路径在我的 home 配置体系中属于哪个 scope」，
    // 不是「这个 basename 看起来像哪种配置」。
    // 之前「绝对路径不在 home 下但 basename 是 shell rc → 视为 shell-rc」的宽松语义
    // 与 C5 安全语义冲突，去掉。如确需测试用例，调用方自行 setHome 到测试目录。
    expect(detectScope("/tmp/.zshrc", HOME)).toBeNull();
    expect(detectScope("/var/log/.zshrc", HOME)).toBeNull();
  });

  it("REVIEW_3 R_1·C13: Win 反斜杠路径 normalize", () => {
    // 修复前：detectScope 顶部 === 全等比对 ".claude/settings.json"，rel 含 \ → miss
    // 修复后：stripHome 把 \ 全部替换成 /
    expect(detectScope("C:\\Users\\test\\.claude\\settings.json", "C:\\Users\\test")).toBe("claude-settings");
    expect(detectScope("C:\\Users\\test\\.codex\\config.toml", "C:\\Users\\test")).toBe("codex-config");
    expect(detectScope("C:\\Users\\test\\.zshrc", "C:\\Users\\test")).toBe("shell-rc");
  });
});

describe("getSchemaForScope", () => {
  it("已注册 → 返 ToolSchema", () => {
    const s = getSchemaForScope("claude-settings");
    expect(s).not.toBeNull();
    expect(s?.scopeKind).toBe("claude-settings");
    expect(s?.$id).toBe("claude-settings@1");
  });

  it("PR-E 三个新注册：claude-mcp / codex-config / opencode-config", () => {
    expect(getSchemaForScope("claude-mcp")?.scopeKind).toBe("claude-mcp");
    expect(getSchemaForScope("codex-config")?.scopeKind).toBe("codex-config");
    expect(getSchemaForScope("opencode-config")?.scopeKind).toBe("opencode-config");
  });

  it("PR-I 新注册：dch-store", () => {
    expect(getSchemaForScope("dch-store")?.scopeKind).toBe("dch-store");
  });

  it("未注册 → null", () => {
    expect(getSchemaForScope("shell-rc")).toBeNull();
    expect(getSchemaForScope("claude-md")).toBeNull();
  });
});

describe("listRegisteredSchemas", () => {
  it("PR-I 后包含 5 份（claude-settings / claude-mcp / codex-config / opencode-config / dch-store）", () => {
    const all = listRegisteredSchemas();
    expect(all.length).toBe(5);
    const kinds = all.map((s) => s.scopeKind).sort();
    expect(kinds).toEqual(["claude-mcp", "claude-settings", "codex-config", "dch-store", "opencode-config"]);
  });
});
