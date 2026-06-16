import { describe, expect, it } from "bun:test";
import { shouldIncludePath, isSensitiveKey, isSensitiveFile } from "./backup-rules.ts";

describe("shouldIncludePath", () => {
  it("常见顶层配置文件命中", () => {
    expect(shouldIncludePath("CLAUDE.md")).toBe(true);
    expect(shouldIncludePath("settings.json")).toBe(true);
    expect(shouldIncludePath("AGENTS.md")).toBe(true);
    expect(shouldIncludePath("config.toml")).toBe(true);
    expect(shouldIncludePath(".mcp.json")).toBe(true);
    expect(shouldIncludePath("auth.json")).toBe(true);
    expect(shouldIncludePath("credentials.json")).toBe(true);
  });

  it("常见配置目录递归命中", () => {
    expect(shouldIncludePath("templates/changelog.template.md")).toBe(true);
    expect(shouldIncludePath("SOPs/file-size-guardrail.md")).toBe(true);
    expect(shouldIncludePath("plans/abc.md")).toBe(true);
    expect(shouldIncludePath("providers/sonnet.json")).toBe(true);
    expect(shouldIncludePath("plugins/installed_plugins.json")).toBe(true);
    expect(shouldIncludePath("plugins/cache/foo/0.1.0/bar.js")).toBe(true);
    expect(shouldIncludePath("plugins/local/codex-custom/agents/x.md")).toBe(true);
    expect(shouldIncludePath("skills/myskill/SKILL.md")).toBe(true);
  });

  it("未知配置资产默认纳入，避免新工具或用户自定义文件漏备份", () => {
    expect(shouldIncludePath("random-file.txt")).toBe(true);
    expect(shouldIncludePath("random/dir/file.md")).toBe(true);
    expect(shouldIncludePath("custom-tool/config.yaml")).toBe(true);
    expect(shouldIncludePath("marketplaces/custom-market.json")).toBe(true);
  });

  it("projects/<cwd>/memory/ 命中，运行态/历史文件不命中（黑名单优先）", () => {
    expect(shouldIncludePath("projects/-Users-apple-foo/memory/MEMORY.md")).toBe(true);
    expect(shouldIncludePath("projects/-Users-apple-foo/memory/feedback.md")).toBe(true);
    expect(shouldIncludePath("projects/-Users-apple-foo/abc.jsonl")).toBe(false);
    expect(shouldIncludePath("projects/-Users-apple-foo/foo.txt")).toBe(true);
  });

  it("EXCLUDE 黑名单命中", () => {
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

  it("数据库与 sidecar 文件不命中", () => {
    expect(shouldIncludePath("history.db")).toBe(false);
    expect(shouldIncludePath("history.DB")).toBe(false);
    expect(shouldIncludePath("state.db")).toBe(false);
    expect(shouldIncludePath("nested/cache.db")).toBe(false);
    expect(shouldIncludePath("usage.db-wal")).toBe(false);
    expect(shouldIncludePath("usage.DB-WAL")).toBe(false);
    expect(shouldIncludePath("usage.db-shm")).toBe(false);
    expect(shouldIncludePath("usage.db-journal")).toBe(false);
    expect(shouldIncludePath("data.sqlite3")).toBe(false);
    expect(shouldIncludePath("data.SQLITE3-SHM")).toBe(false);
    expect(shouldIncludePath("data.sqlite3-wal")).toBe(false);
  });

  it("私钥 / 证书 / keystore 文件不命中，避免默认 placeholder 备份泄漏不可脱敏凭据", () => {
    expect(shouldIncludePath(".netrc")).toBe(false);
    expect(shouldIncludePath(".NETRC")).toBe(false);
    expect(shouldIncludePath("ssh/id_ed25519")).toBe(false);
    expect(shouldIncludePath("ssh/ID_ED25519")).toBe(false);
    expect(shouldIncludePath(".ssh/config")).toBe(false);
    expect(shouldIncludePath(".SSH/config")).toBe(false);
    expect(shouldIncludePath("certs/client.key")).toBe(false);
    expect(shouldIncludePath("certs/client.KEY")).toBe(false);
    expect(shouldIncludePath("certs/client.pem")).toBe(false);
    expect(shouldIncludePath("certs/client.PEM")).toBe(false);
    expect(shouldIncludePath("certs/client.p12")).toBe(false);
    expect(shouldIncludePath("certs/client.P12")).toBe(false);
    expect(shouldIncludePath("certs/client.pfx")).toBe(false);
    expect(shouldIncludePath("java/truststore.jks")).toBe(false);
    expect(shouldIncludePath("java/truststore.JKS")).toBe(false);
    expect(shouldIncludePath("java/client.keystore")).toBe(false);
    expect(shouldIncludePath("java/client.KEYSTORE")).toBe(false);
  });

  it("显式排除的根级维护文件不命中", () => {
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
    expect(isSensitiveFile("AUTH.JSON")).toBe(true);
    expect(isSensitiveFile("Credentials.JSON")).toBe(true);
  });

  it("其他 .json 不命中", () => {
    expect(isSensitiveFile("settings.json")).toBe(false);
    expect(isSensitiveFile(".mcp.json")).toBe(false);
  });
});

describe("目录语义下的运行态目录排除范围", () => {
  it("`templates/.cache/foo.json` 子树内 `.cache` 命中黑名单", () => {
    expect(shouldIncludePath("templates/.cache/foo.json")).toBe(false);
  });

  it("`agents/myagent/.tmp/scratch` 子树内 `.tmp` 命中", () => {
    expect(shouldIncludePath("agents/myagent/.tmp/scratch")).toBe(false);
  });

  it("普通 runtime 目录名只排 configDir 根级", () => {
    expect(shouldIncludePath("sessions/abc.json")).toBe(false);
    expect(shouldIncludePath("debug/abc.txt")).toBe(false);
    expect(shouldIncludePath("state/defaults.json")).toBe(false);
    expect(shouldIncludePath("tasks/template.md")).toBe(false);
    expect(shouldIncludePath("memories/example.md")).toBe(false);
  });

  it("自定义配置子树里的同名目录默认保留，避免漏备份用户资产", () => {
    expect(shouldIncludePath("skills/planner/tasks/template.md")).toBe(true);
    expect(shouldIncludePath("skills/planner/memories/example.md")).toBe(true);
    expect(shouldIncludePath("agents/coder/state/defaults.json")).toBe(true);
    expect(shouldIncludePath("providers/state/openai.json")).toBe(true);
    expect(shouldIncludePath("commands/tasks/sync.md")).toBe(true);
    expect(shouldIncludePath("plugins/local/foo/debug/x.txt")).toBe(true);
  });

  it("通用文件后缀排除仍跨深度生效", () => {
    expect(shouldIncludePath("agents/x/log/run.log")).toBe(false);
    expect(shouldIncludePath("skills/planner/tasks/history.db")).toBe(false);
  });

  it("例外: `cache/**` 只排 root cache,不误伤普通子目录名", () => {
    expect(shouldIncludePath("plugins/cache/foo/0.1.0/bar.js")).toBe(true);
  });
});
