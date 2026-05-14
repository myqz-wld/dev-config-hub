import { test, expect, describe } from "bun:test";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { IS_WIN } from "./platform.ts";

/**
 * REVIEW_8 Group B（H6 / M9 / M10 / M11）端到端回归。
 *
 * 真 spawn `bun src/cli.ts profile <args> --json` 子进程，验证：
 * - B1 (H6)：未捕获异常在 json 模式下 stdout 输出 `{error: "..."}` 而不是 console.error
 * - B2 (H6)：cmdRemove --json 不带 --yes 立即报错（不能 hang stdin）
 * - B3 (H6)：cmdUse / cmdRestore 在 result.ok=false 时 exit 1 而不是 0
 * - B5 (M10)：`--desc --json` 中作为 desc 值的 --json 不应被剥离 → 正确收为 desc 值
 * - B6 (M11)：未知 flag (--no-share typo) 直接 throw → exit 1 + stdout JSON error
 *
 * Win 不跑（应用 macOS-only + 现有 e2e 一致放行）。
 */

const REPO_ROOT = resolve(import.meta.dir, "..");
const CLI_PATH = join(REPO_ROOT, "src/cli.ts");

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function setupTmpHome(profiles: Array<{ id: string; configDir: string; isDefault?: boolean; preSwitch?: string }>): Promise<{ home: string }> {
  const home = await mkdtemp(join(tmpdir(), "dch-jsonproto-"));
  const dchDir = join(home, ".dch");
  await mkdir(dchDir, { recursive: true });

  // 给每个 profile 建对应 configDir，preSwitch hook 注入到 hooks
  for (const p of profiles) {
    await mkdir(join(home, p.configDir.replace(/^~\//, "")), { recursive: true });
  }
  // ~/.claude → 第一个 default profile 的 configDir
  const defaultProfile = profiles.find((p) => p.isDefault) ?? profiles[0]!;
  await symlink(join(home, defaultProfile.configDir.replace(/^~\//, "")), join(home, ".claude"));

  const store = {
    version: 1,
    profiles: profiles.map((p) => ({
      id: p.id,
      tool: "claude",
      configDir: p.configDir,
      isDefault: p.isDefault,
      ...(p.preSwitch ? { hooks: { preSwitch: p.preSwitch } } : {}),
    })),
    active: { claude: defaultProfile.id, codex: null },
    preferences: { hookTimeoutMs: 500 },
  };
  await writeFile(join(dchDir, "profiles.json"), JSON.stringify(store, null, 2));
  return { home };
}

async function runCli(home: string, args: string[]): Promise<SpawnResult> {
  const proc = Bun.spawn(["bun", CLI_PATH, ...args], {
    env: { ...process.env, HOME: home },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const timer = setTimeout(() => { try { proc.kill(); } catch {} }, 10_000);
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  clearTimeout(timer);
  return {
    exitCode: proc.exitCode ?? -1,
    stdout,
    stderr,
  };
}

describe.skipIf(IS_WIN)("cli json protocol (REVIEW_8 Group B e2e)", () => {
  // ─── B1：H6 main().catch json mode ──────────────────────────────────
  test("B1: show --json 不存在 id → exit 1 + stdout {error}", async () => {
    const { home } = await setupTmpHome([
      { id: "default", configDir: "~/.claude-default", isDefault: true },
    ]);
    try {
      const r = await runCli(home, ["profile", "show", "nonexistent", "--json"]);
      expect(r.exitCode).toBe(1);
      const parsed = JSON.parse(r.stdout.trim());
      expect(typeof parsed.error).toBe("string");
      expect(parsed.error).toMatch(/不存在|not found|nonexistent/i);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 15_000);

  // ─── B2：H6 cmdRemove json 短路 prompt ──────────────────────────────
  test("B2: remove --json 不带 --yes → exit 1 + 立即 stdout {error}（不 hang stdin）", async () => {
    const { home } = await setupTmpHome([
      { id: "default", configDir: "~/.claude-default", isDefault: true },
      { id: "test-rm", configDir: "~/.claude-rm" },
    ]);
    try {
      const r = await runCli(home, ["profile", "remove", "test-rm", "--json"]);
      expect(r.exitCode).toBe(1);
      const parsed = JSON.parse(r.stdout.trim());
      expect(parsed.error).toMatch(/--yes/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 15_000);

  test("B2: remove --json --yes → exit 0 + ok json", async () => {
    const { home } = await setupTmpHome([
      { id: "default", configDir: "~/.claude-default", isDefault: true },
      { id: "test-rm", configDir: "~/.claude-rm" },
    ]);
    try {
      const r = await runCli(home, ["profile", "remove", "test-rm", "--json", "--yes"]);
      expect(r.exitCode).toBe(0);
      const parsed = JSON.parse(r.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.removed).toBe("test-rm");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 15_000);

  // ─── B3：H6 use ok=false → exit 1 ───────────────────────────────────
  test("B3: use --json + preSwitch hook fail → exit 1 + ok:false JSON", async () => {
    const { home } = await setupTmpHome([
      { id: "default", configDir: "~/.claude-default", isDefault: true },
      { id: "fail-target", configDir: "~/.claude-fail", preSwitch: "exit 7" },
    ]);
    try {
      const r = await runCli(home, ["profile", "use", "fail-target", "--json"]);
      // 旧路径：jsonOut 后 return → dispatcher exit(0) → bridge 误判成功
      // 新路径（B3）：jsonOut 后立刻 process.exit(1)
      expect(r.exitCode).toBe(1);
      const parsed = JSON.parse(r.stdout.trim());
      expect(parsed.ok).toBe(false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 15_000);

  // ─── B5：M10 --json filter VALUE_FLAGS-aware ────────────────────────
  test("B5: add --desc --json （--json 是 desc 值）→ json mode 不应启用", async () => {
    const { home } = await setupTmpHome([
      { id: "default", configDir: "~/.claude-default", isDefault: true },
    ]);
    try {
      // --desc 是 VALUE_FLAGS，下一个 arg "--json" 应当作 desc 值收下，而不是 strip 走开 json mode。
      // 旧实现 args.includes("--json") 误判 json mode + filter 把 desc 值 strip 掉。
      // 新实现 extractJsonFlag 在 VALUE_FLAGS 后跳过下一个 arg → 正确把 "--json" 留在 args 里。
      const r = await runCli(home, [
        "profile", "add", "claude", "test-desc",
        "--dir", join(home, ".claude-x"),
        "--desc", "--json",
      ]);
      // 非 json 模式：stdout 是文本（含 ✓ / 提示），不是 JSON
      expect(r.exitCode).toBe(0);
      // 不应是 JSON 输出（json mode 关掉）
      let parsed: { ok?: boolean; profile?: { description?: string } } | null = null;
      try { parsed = JSON.parse(r.stdout.trim()); } catch { parsed = null; }
      expect(parsed).toBeNull();
      // stdout 应含 description 已记录 — 间接验证 desc 没被 strip
      // （文本 ok 输出含 profile id；进一步 verify 通过 list --json 查看 profile）
      const list = await runCli(home, ["profile", "list", "--json"]);
      expect(list.exitCode).toBe(0);
      const lp = JSON.parse(list.stdout.trim());
      const found = lp.profiles.find((p: { id: string; description?: string }) => p.id === "test-desc");
      expect(found?.description).toBe("--json");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 20_000);

  // ─── B6：M11 未知 flag throw ────────────────────────────────────────
  test("B6: backup --no-share (typo) → exit 1 + JSON error 含 '未知 flag'", async () => {
    const { home } = await setupTmpHome([
      { id: "default", configDir: "~/.claude-default", isDefault: true },
    ]);
    try {
      const r = await runCli(home, ["profile", "backup", "--no-share", "--json", "--yes"]);
      expect(r.exitCode).toBe(1);
      const parsed = JSON.parse(r.stdout.trim());
      expect(parsed.error).toMatch(/未知 flag --no-share/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 15_000);

  test("B6: add --typo (typo) → exit 1 + JSON error 含 '未知 flag'", async () => {
    const { home } = await setupTmpHome([
      { id: "default", configDir: "~/.claude-default", isDefault: true },
    ]);
    try {
      const r = await runCli(home, ["profile", "add", "claude", "x", "--typo", "value", "--json"]);
      expect(r.exitCode).toBe(1);
      const parsed = JSON.parse(r.stdout.trim());
      expect(parsed.error).toMatch(/未知 flag --typo/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 15_000);
});
