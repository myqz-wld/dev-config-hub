import { test, expect, describe } from "bun:test";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { IS_WIN } from "./platform.ts";

/**
 * REVIEW_7 H6 端到端回归：spawn 真实 `bun src/cli.ts profile use ...` 子进程，
 * 测进程退出时间 + stdout 不截断 + JSON 可 parse。
 *
 * **覆盖的 root cause**：
 * - **H1**：`process.exit(0)` 在 Bun stdout=pipe 场景下截断 ≥ 65537 byte 到 65536（macOS pipe buffer）
 * - **H7**：`runHook` 内 Promise.race 输掉的 setTimeout 仍保活 bun event loop，让 bun 多挂 ~1s
 * - **REVIEW_2 H1**：hook detach 子进程（`(sleep N &)`）继承 bun stdio pipe FD 让 bun 永挂
 *
 * 现有 `src/profiles/hooks.test.ts:108` 只测 `runHook` 函数返回时间，**完全没测 bun 进程退出时间**
 * → 上述 root cause 的回归无声漏检。本文件 lock「bun 子进程必须 N 秒内退出 + stdout 完整」。
 *
 * 测试用临时 HOME 隔离 `~/.dch/profiles.json` / `~/.claude` symlink，不污染真实环境。
 *
 * Win 平台没有 `(... &)` detach 语法 + 不走 setsid/killpg；不在本回归覆盖范围。
 */

const REPO_ROOT = resolve(import.meta.dir, "..");
const CLI_PATH = join(REPO_ROOT, "src/cli.ts");

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

async function setupTmpHome(profileHooks: { preSwitch?: string; postSwitch?: string }): Promise<{ home: string; profileId: string }> {
  const home = await mkdtemp(join(tmpdir(), "dch-exit-time-"));
  const dchDir = join(home, ".dch");
  await mkdir(dchDir, { recursive: true });

  // 准备 claude configDir + symlink（init 已做的等价操作，避免 useProfile 跑 initToolDir）
  const defaultDir = join(home, ".claude-default");
  const targetDir = join(home, ".claude-test");
  await mkdir(defaultDir, { recursive: true });
  await mkdir(targetDir, { recursive: true });
  // ~/.claude → defaultDir 的 symlink（switchSymlink 会原子 swap 它）
  await symlink(defaultDir, join(home, ".claude"));

  const profileId = "test-target";
  const store = {
    version: 1,
    profiles: [
      {
        id: "test-default",
        tool: "claude",
        configDir: "~/.claude-default",
        isDefault: true,
      },
      {
        id: profileId,
        tool: "claude",
        configDir: "~/.claude-test",
        hooks: profileHooks,
      },
    ],
    active: { claude: "test-default", codex: null },
    preferences: { hookTimeoutMs: 500 },  // 短 timeout 让 detach 测试快收敛
  };
  await writeFile(join(dchDir, "profiles.json"), JSON.stringify(store, null, 2));
  return { home, profileId };
}

async function spawnProfileUse(home: string, profileId: string, opts: { extraTimeoutSec?: number } = {}): Promise<SpawnResult> {
  const start = Date.now();
  const proc = Bun.spawn(["bun", CLI_PATH, "profile", "use", profileId, "--json"], {
    env: { ...process.env, HOME: home },
    stdout: "pipe",
    stderr: "pipe",
  });
  // hard cap：避免测试本身被卡住挂 CI；远大于断言上限。
  const hardCapSec = opts.extraTimeoutSec ?? 15;
  const timer = setTimeout(() => { try { proc.kill(); } catch {} }, hardCapSec * 1000);
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
    durationMs: Date.now() - start,
  };
}

describe.skipIf(IS_WIN)("cli-profile.exit-time (REVIEW_7 H6 e2e)", () => {
  // === case A：detach hook 不应卡住 bun 进程（REVIEW_2 H1 + REVIEW_7 H7 联合回归）===
  test("detach hook (sleep 30 &) → bun 子进程 < 3s 退出", async () => {
    const { home, profileId } = await setupTmpHome({
      preSwitch: `(sleep 30 &); echo immediate-stdout; exit 0`,
    });
    try {
      const r = await spawnProfileUse(home, profileId);
      // 旧实现（未修复）：bun 进程会卡 30s（≈ sleep 30 寿命）
      // 修复后（PR-1 process.exit）：< 3s（hookTimeoutMs 500ms + hardCap GRACE + bun exit 余量）
      // **核心断言**：bun 子进程必须快速退出（detach 孙子持 pipe FD 不应拖死 bun event loop）
      expect(r.durationMs).toBeLessThan(3000);
      // JSON 必须可 parse — 即使 hook 因 detach 被 hardCap 当 timedOut 处理（ok=false）也无所谓，
      // 关键是 stdout 是合法 JSON 而不是被 process.exit 截断。
      // CLI cmdUse 失败走 err() 退 1；成功走 jsonOut 退 0。
      const parsed = JSON.parse(r.stdout);
      // 不强求 parsed.ok：detach hook 会被 hardCap 当 timedOut（exit=-1, ok=false）—— 这是 REVIEW_2 H1
      // 设计的「hook 内不能用 detach 后台进程」语义。本 case 测的是「bun 进程不卡死」+「stdout 完整」。
      expect(parsed).toBeTruthy();
      expect(typeof parsed.ok === "boolean" || typeof parsed.error === "string").toBe(true);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 20_000);

  // === case B：hook=echo ok 即时结束（H7 race timer 回归）===
  test("echo ok hook → bun 子进程 < 2s 退出（H7 race timer 回归）", async () => {
    const { home, profileId } = await setupTmpHome({
      preSwitch: `echo ok; exit 0`,
    });
    try {
      const r = await spawnProfileUse(home, profileId);
      // H7 旧实现：bun 进程会被 race 输掉的 setTimeout 拖到 hookTimeoutMs+1000ms（500+1000=1500ms+）
      // 修复后（PR-1 process.exit）：bun 立刻退（CLI 主流程跑完 ≤ 几百 ms）
      expect(r.durationMs).toBeLessThan(2000);
      expect(r.exitCode).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.ok).toBe(true);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 10_000);

  // === case C：hook 输出 200KB → JSON 完整不截断（H1 65536 边界回归）===
  test("hook stdout 200KB → JSON 完整不被截断到 65536 byte", async () => {
    // 用 yes 'x' | head 构造稳定 200KB（POSIX 通用）
    const { home, profileId } = await setupTmpHome({
      preSwitch: `yes 'x' | head -c 200000; echo; exit 0`,
    });
    try {
      const r = await spawnProfileUse(home, profileId);
      expect(r.exitCode).toBe(0);
      // 关键断言：stdout 字节数应远大于 macOS pipe buffer 上限 65536（如果被截就是 65536）
      // jsonOut 包了 JSON.stringify，所以 stdout ≈ 200000 字符 + JSON 包装开销
      expect(r.stdout.length).toBeGreaterThan(180_000);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.ok).toBe(true);
      // hooks[0].stdout 应包含完整 200KB 'x'（runHook 内 hardCap 也可能 truncate，但 hookTimeoutMs=500ms
      // 对 yes|head 是足够的；这里主断言是 stdout 不被 process.exit 截到 65536）
      expect(parsed.hooks).toHaveLength(1);
      expect(parsed.hooks[0].stdout.length).toBeGreaterThan(150_000);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 15_000);
});
