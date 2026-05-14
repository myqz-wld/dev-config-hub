import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { IS_WIN } from "../platform.ts";
import { validateRestorePath } from "./backup-restore.ts";

/**
 * REVIEW_8 Group D7 — backup/restore safety roundtrip。
 *
 * 关键约束：所有改 store / 创建 backup 的测试必须 spawn 子进程 + `env: HOME=tmp` 隔离。
 * In-process 改 process.env.HOME 不起作用 — `homedir()` 在 platform.ts module load 时已缓存，
 * STORE_PATH 走 module 常量 → 直接 saveStore(store, STORE_PATH) 会污染真实 ~/.dch/profiles.json。
 *
 * - H2 (D1)：configDir 内含 symlink dir 不被 walkFiles 跟进
 * - H4 (D2)：tar 写到 .tmp + verify + mv，成功路径无 .dch-tmp-* 残留
 * - H5 (D3)：恶意 manifest configDir_original 默认 fall back 到 ~/.dch-restored/<finalId>/
 * - M2 (D5)：markdown 含 sk-ant 被 regex 替换 placeholder
 *
 * Win 不跑（应用 macOS-only 一致放行）。
 */

const REPO_ROOT = resolve(import.meta.dir, "../..");
const CLI_PATH = join(REPO_ROOT, "src/cli.ts");

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCli(home: string, args: string[]): Promise<CliResult> {
  const proc = Bun.spawn(["bun", CLI_PATH, ...args], {
    env: { ...process.env, HOME: home },
    stdout: "pipe", stderr: "pipe", stdin: "ignore",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  return { exitCode: proc.exitCode ?? -1, stdout, stderr };
}

async function setupTmpHomeWithProfiles(opts: {
  profiles: Array<{ id: string; configDir: string; files?: Record<string, string> }>;
}): Promise<{ home: string }> {
  const home = await mkdtemp(join(tmpdir(), "dch-d7-"));
  await mkdir(join(home, ".dch/backups"), { recursive: true });
  // ~/.claude / ~/.codex symlink 设默认（init 后状态等价）
  for (const p of opts.profiles) {
    const dir = p.configDir.replace(/^~\//, `${home}/`);
    await mkdir(dir, { recursive: true });
    if (p.files) {
      for (const [name, content] of Object.entries(p.files)) {
        await writeFile(join(dir, name), content);
      }
    }
  }
  // 把首个 profile 当 default 建 symlink，让 dch profile current 不挂
  const first = opts.profiles[0]!;
  const firstDir = first.configDir.replace(/^~\//, `${home}/`);
  await symlink(firstDir, join(home, `.${first.id.startsWith("codex") ? "codex" : "claude"}`));

  const store = {
    version: 1,
    profiles: opts.profiles.map((p) => ({
      id: p.id,
      tool: p.id.startsWith("codex") ? "codex" : "claude",
      configDir: p.configDir,
      isDefault: p === first,
    })),
    active: { claude: first.id, codex: null },
    preferences: { hookTimeoutMs: 30_000 },
  };
  await writeFile(join(home, ".dch/profiles.json"), JSON.stringify(store, null, 2));
  return { home };
}

describe.skipIf(IS_WIN)("backup safety roundtrip (REVIEW_8 Group D)", () => {
  // ── D3 path validator unit（in-process 安全：纯函数，不读 STORE_PATH）─────
  describe("validateRestorePath (D3)", () => {
    const HOME = process.env.HOME!;

    test("拒绝绝对路径外 HOME", () => {
      expect(validateRestorePath("/etc/cron.d")).toMatch(/HOME/);
      expect(validateRestorePath("/usr/local/bin")).toMatch(/HOME/);
    });

    test("拒绝含 .. 段", () => {
      expect(validateRestorePath(`${HOME}/foo/../etc`)).toMatch(/'\.\.'/);
    });

    test("拒绝 ~/.ssh / ~/.gnupg / Library 黑名单", () => {
      expect(validateRestorePath(`${HOME}/.ssh`)).toMatch(/BLACKLIST/);
      expect(validateRestorePath(`${HOME}/.ssh/authorized_keys`)).toMatch(/BLACKLIST/);
      expect(validateRestorePath(`${HOME}/.gnupg/secring.gpg`)).toMatch(/BLACKLIST/);
      expect(validateRestorePath(`${HOME}/Library/LaunchAgents/x.plist`)).toMatch(/BLACKLIST/);
    });

    test("HOME 内合法路径通过", () => {
      expect(validateRestorePath(`${HOME}/.claude-test`)).toBeNull();
      expect(validateRestorePath(`${HOME}/.dch-restored/test-id`)).toBeNull();
      expect(validateRestorePath(HOME)).toBeNull();
    });

    test("空路径 / 相对路径拒", () => {
      expect(validateRestorePath("")).toMatch(/绝对路径/);
      expect(validateRestorePath("./foo")).toMatch(/绝对路径/);
    });
  });

  // ── D1 walkFiles symlink skip：spawn 子进程隔离 ──────────────────────────
  test("D1: backup 不跟 symlink dir（备份不含 /etc 内容）", async () => {
    const { home } = await setupTmpHomeWithProfiles({
      profiles: [{
        id: "victim",
        configDir: "~/.claude-victim",
        files: { "settings.json": JSON.stringify({ theme: "dark" }) },
      }],
    });
    try {
      // 配置 evil-link：~/.claude-victim/evil-link → /etc
      await symlink("/etc", join(home, ".claude-victim", "evil-link"));

      const outFile = join(home, ".dch/backups/test.dchpack");
      const r = await runCli(home, ["profile", "backup", "--out", outFile, "--no-shared", "--yes", "--json"]);
      expect(r.exitCode).toBe(0);

      // 列 archive 看不含 /etc 内容也不含 evil-link
      const proc = Bun.spawn(["tar", "-tzf", outFile], { stdout: "pipe" });
      const list = await new Response(proc.stdout).text();
      await proc.exited;
      expect(list).not.toMatch(/etc\//);
      expect(list).not.toMatch(/passwd|hosts/);
      expect(list).not.toMatch(/evil-link/);
      expect(list).toContain("settings.json");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 60_000);

  // ── D2 atomic write：成功路径无 .dch-tmp-* 残留 ──────────────────────────
  test("D2: backup 成功后不残留 .dch-tmp-* 文件", async () => {
    const { home } = await setupTmpHomeWithProfiles({
      profiles: [{
        id: "test",
        configDir: "~/.claude-test",
        files: { "settings.json": "{}" },
      }],
    });
    try {
      const outFile = join(home, ".dch/backups/atomic.dchpack");
      const r = await runCli(home, ["profile", "backup", "--out", outFile, "--no-shared", "--yes", "--json"]);
      expect(r.exitCode).toBe(0);

      const stats = await stat(outFile);
      expect(stats.size).toBeGreaterThan(0);
      // ls 同目录无 dch-tmp-* 残留
      const lsProc = Bun.spawn(["sh", "-c", `ls ${join(home, ".dch/backups")} | grep dch-tmp || true`], { stdout: "pipe" });
      const tmpList = await new Response(lsProc.stdout).text();
      await lsProc.exited;
      expect(tmpList.trim()).toBe("");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 60_000);

  // ── M2 markdown sk-ant 被 redact ────────────────────────────────────────
  test("M2/D5: backup CLAUDE.md 含 sk-ant → archive 不含明文", async () => {
    const secret = "sk-ant-api03-XYZ987654321ABCDEFGHIJ";
    const { home } = await setupTmpHomeWithProfiles({
      profiles: [{
        id: "md-test",
        configDir: "~/.claude-md-test",
        files: { "CLAUDE.md": `# CLAUDE\n\nMy key: ${secret}\n` },
      }],
    });
    try {
      const outFile = join(home, ".dch/backups/m2.dchpack");
      const r = await runCli(home, ["profile", "backup", "--out", outFile, "--no-shared", "--yes", "--json"]);
      expect(r.exitCode).toBe(0);

      // 解压看 CLAUDE.md 内容
      const tmpExtract = await mkdtemp(join(tmpdir(), "dch-m2-extract-"));
      try {
        const proc = Bun.spawn(["tar", "-xzf", outFile, "-C", tmpExtract]);
        await proc.exited;
        const md = await readFile(join(tmpExtract, "profiles/md-test/configDir/CLAUDE.md"), "utf-8");
        expect(md).not.toContain(secret);
        expect(md).toContain("<<DCH_PLACEHOLDER:ANTHROPIC_API_KEY>>");
      } finally {
        await rm(tmpExtract, { recursive: true, force: true });
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 60_000);

  // ── H5/D3 默认 restore 落 ~/.dch-restored/<finalId>/，忽略 manifest 路径 ───
  test("H5/D3: restore 默认走 ~/.dch-restored/<finalId>/（不含 --allow-original-path）", async () => {
    // 准备一个 backup（在 src home 内做完，再用同 home restore — 模拟跨机器）
    const { home } = await setupTmpHomeWithProfiles({
      profiles: [{
        id: "src",
        configDir: "~/.claude-source",
        files: { "settings.json": JSON.stringify({ theme: "x" }) },
      }],
    });
    try {
      const outFile = join(home, ".dch/backups/d3.dchpack");
      const bk = await runCli(home, ["profile", "backup", "--out", outFile, "--no-shared", "--yes", "--json"]);
      expect(bk.exitCode).toBe(0);

      // 清空 store 模拟跨机器
      const emptyStore = {
        version: 1, profiles: [],
        active: { claude: null, codex: null },
        preferences: { hookTimeoutMs: 30_000 },
      };
      await writeFile(join(home, ".dch/profiles.json"), JSON.stringify(emptyStore));
      // 删 source dir
      await rm(join(home, ".claude-source"), { recursive: true, force: true });

      // 默认 restore（不带 --allow-original-path）
      const rs = await runCli(home, ["profile", "restore", outFile, "--yes", "--json"]);
      expect(rs.exitCode).toBe(0);
      const result = JSON.parse(rs.stdout.trim());
      expect(result.ok).toBe(true);
      expect(result.appliedProfiles).toHaveLength(1);
      const ap = result.appliedProfiles[0];
      // configDir 应指向 ~/.dch-restored，不是原 ~/.claude-source
      expect(ap.configDir).toContain(".dch-restored");
      expect(ap.configDir).not.toContain(".claude-source");
      // 实际目录已创建
      const restoredAbs = join(home, ".dch-restored", ap.finalId);
      const settingsExists = await stat(join(restoredAbs, "settings.json")).then(() => true).catch(() => false);
      expect(settingsExists).toBe(true);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 60_000);
});
