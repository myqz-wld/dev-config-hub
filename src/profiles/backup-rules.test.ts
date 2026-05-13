import { describe, expect, it } from "bun:test";
import { shouldIncludePath, isSensitiveKey, isSensitiveFile } from "./backup-rules.ts";

describe("shouldIncludePath", () => {
  it("INCLUDE 顶层文件命中", () => {
    expect(shouldIncludePath("CLAUDE.md")).toBe(true);
    expect(shouldIncludePath("settings.json")).toBe(true);
    expect(shouldIncludePath("AGENTS.md")).toBe(true);
    expect(shouldIncludePath("config.toml")).toBe(true);
    expect(shouldIncludePath(".mcp.json")).toBe(true);
    expect(shouldIncludePath("auth.json")).toBe(true);
    expect(shouldIncludePath("credentials.json")).toBe(true);
  });

  it("INCLUDE 目录递归命中", () => {
    expect(shouldIncludePath("templates/changelog.template.md")).toBe(true);
    expect(shouldIncludePath("SOPs/file-size-guardrail.md")).toBe(true);
    expect(shouldIncludePath("plans/abc.md")).toBe(true);
    expect(shouldIncludePath("providers/sonnet.json")).toBe(true);
    expect(shouldIncludePath("plugins/installed_plugins.json")).toBe(true);
    expect(shouldIncludePath("plugins/cache/foo/0.1.0/bar.js")).toBe(true);
    expect(shouldIncludePath("plugins/local/codex-custom/agents/x.md")).toBe(true);
    expect(shouldIncludePath("skills/myskill/SKILL.md")).toBe(true);
  });

  it("projects/<cwd>/memory/ 命中，但 *.jsonl 兄弟文件不命中（黑名单优先）", () => {
    expect(shouldIncludePath("projects/-Users-apple-foo/memory/MEMORY.md")).toBe(true);
    expect(shouldIncludePath("projects/-Users-apple-foo/memory/feedback.md")).toBe(true);
    expect(shouldIncludePath("projects/-Users-apple-foo/abc.jsonl")).toBe(false);
    expect(shouldIncludePath("projects/-Users-apple-foo/foo.txt")).toBe(false);
  });

  it("EXCLUDE 黑名单命中（即使父目录在白名单也排除）", () => {
    expect(shouldIncludePath("history.jsonl")).toBe(false);
    expect(shouldIncludePath("plans/abc.jsonl")).toBe(false);
    expect(shouldIncludePath("debug/abc.txt")).toBe(false);
    expect(shouldIncludePath("file-history/abc/v1.txt")).toBe(false);
    expect(shouldIncludePath("session-env/foo.json")).toBe(false);
    expect(shouldIncludePath("sessions/abc.json")).toBe(false);
    expect(shouldIncludePath("shell-snapshots/abc.sh")).toBe(false);
    expect(shouldIncludePath("shell_snapshots/abc.sh")).toBe(false);
    expect(shouldIncludePath("paste-cache/x.txt")).toBe(false);
    expect(shouldIncludePath(".cache/x")).toBe(false);
    expect(shouldIncludePath("cache/changelog.md")).toBe(false);
    expect(shouldIncludePath("backups/x.json")).toBe(false);
    expect(shouldIncludePath("ide/foo.lock")).toBe(false);
    expect(shouldIncludePath("statsig/x")).toBe(false);
    expect(shouldIncludePath("log/codex-tui.log")).toBe(false);
    expect(shouldIncludePath("logs.sqlite")).toBe(false);
    expect(shouldIncludePath("plugins/install-counts-cache.json")).toBe(false);
    expect(shouldIncludePath(".claude.json")).toBe(false);
  });

  it("没在白名单 + 没在黑名单 → false（默认排除）", () => {
    expect(shouldIncludePath("random-file.txt")).toBe(false);
    expect(shouldIncludePath("random/dir/file.md")).toBe(false);
    expect(shouldIncludePath(".last-cleanup")).toBe(false);
  });

  it("通用黑名单 *.lock / *.log / *.bak.* 在任何位置都拦", () => {
    expect(shouldIncludePath("templates/foo.lock")).toBe(false);
    expect(shouldIncludePath("plugins/cache/foo.log")).toBe(false);
    expect(shouldIncludePath(".mcp.json.bak.20260101")).toBe(false);
  });
});

describe("isSensitiveKey", () => {
  it.each([
    ["api_key", true],
    ["API_KEY", true],
    ["ANTHROPIC_API_KEY", true],
    ["OPENAI_API_KEY", true],
    ["INTERN_TOKEN", true],
    ["my_token", true],
    ["password", true],
    ["secret", true],
    ["bearer_token", true],
    ["Authorization", true],
    ["credential", true],
    ["HTTP_PROXY", false],
    ["model", false],
    ["url", false],
    ["READ_ONLY", false],
    ["timeoutMs", false],
    // 路径类后缀豁免（值是路径不是凭据本身）
    ["credentials_path", false],
    ["secret_file", false],
    ["token_url", false],
    ["api_endpoint", false],
    ["password_dir", false],
    ["bearer_directory", false],
    // 但 *_token / *_key 仍命中（不是路径后缀）
    ["session_token", true],
    ["my_secret_key", true],
  ])("%s → %s", (k, expected) => {
    expect(isSensitiveKey(k)).toBe(expected);
  });
});

describe("isSensitiveFile", () => {
  it("auth.json / credentials.json 命中", () => {
    expect(isSensitiveFile("auth.json")).toBe(true);
    expect(isSensitiveFile("credentials.json")).toBe(true);
  });

  it("其他 .json 不命中", () => {
    expect(isSensitiveFile("settings.json")).toBe(false);
    expect(isSensitiveFile(".mcp.json")).toBe(false);
  });
});
