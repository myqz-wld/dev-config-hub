import { test, expect, describe } from "bun:test";
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { IS_WIN } from "../platform.ts";

/**
 * REVIEW_8 H3 / Group C4 端到端：长 hook 持锁不被并发 useProfile / addProfile stale 抢占。
 *
 * 旧 bug：withStoreLock 默认 staleMs=60_000。useProfile 持锁期间跑 preSwitch+postSwitch
 * 最坏 2 × hookTimeoutMs；hookTimeoutMs 配上限 600_000ms（10 min）→ useProfile 可持锁
 * 1200s，远 > 60s 默认 staleMs → 并发 dch profile add/remove/use 看 lockfile 时间戳判 stale
 * → unlink + 抢占 → multi-process lost update 回归（PR-5 修过的同根问题）。
 *
 * 新行为：manager.withProfileLock 取所有方案的最大 hookTimeoutMs，再计算 staleMs =
 * 2 × max(hookTimeoutMs) + 5_000。所有写操作走同一 helper → acquirer 视角 staleMs ≥
 * holder 视角的最大持锁时长不变量成立。
 *
 * 测试场景：用极小 staleMs（设置一个超小 hookTimeoutMs，让旧 path 在快速 acquirer 观察就
 * 判 stale）→ 反证新 path 不会抢占。
 *
 * Win 不跑（应用 macOS-only 一致放行）。
 */

const REPO_ROOT = resolve(import.meta.dir, "../..");
const CLI_PATH = join(REPO_ROOT, "src/cli.ts");

interface SetupOpts {
  hookTimeoutMs: number;
  preSwitchSleepSec?: number;
}

async function setupTmpHome(opts: SetupOpts): Promise<{ home: string }> {
  const home = await mkdtemp(join(tmpdir(), "dch-stale-"));
  await mkdir(join(home, ".dch"), { recursive: true });

  const dirA = join(home, ".claude-default");
  const dirB = join(home, ".claude-target");
  await mkdir(dirA, { recursive: true });
  await mkdir(dirB, { recursive: true });
  await symlink(dirA, join(home, ".claude"));

  const store = {
    version: 2,
    profiles: [
      {
        id: "default", tool: "claude", configDir: "~/.claude-default",
        isDefault: true, hookTimeoutMs: opts.hookTimeoutMs,
      },
      {
        id: "slow-target",
        tool: "claude",
        configDir: "~/.claude-target",
        hookTimeoutMs: opts.hookTimeoutMs,
        ...(opts.preSwitchSleepSec ? { hooks: { preSwitch: `sleep ${opts.preSwitchSleepSec}; exit 0` } } : {}),
      },
    ],
    active: { claude: "default", codex: null },
    backup: { toolPolicies: {} },
  };
  await writeFile(join(home, ".dch/profiles.json"), JSON.stringify(store, null, 2));
  return { home };
}

async function spawnCli(home: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
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

describe.skipIf(IS_WIN)("manager stale-lock concurrency (REVIEW_8 H3 e2e)", () => {
  // ── 核心回归：长 hook 持锁期间，并发 addProfile 必须等待，不应判 stale 抢占 ──
  test("长 preSwitch hook 持锁 ~3s + 并发 addProfile：addProfile 等待，store 无 lost update", async () => {
    // hookTimeoutMs=10_000ms (10s)；旧默认 staleMs=60_000 仍能保护 — 但用 sleep 3 验证基础并发不冲突。
    // 关键回归：addProfile 必须等 useProfile 释放锁后才执行（不抢占）。
    const { home } = await setupTmpHome({ hookTimeoutMs: 10_000, preSwitchSleepSec: 3 });
    try {
      // A: 启动 useProfile slow-target (持锁 ~3s)
      const aProm = spawnCli(home, ["profile", "use", "slow-target", "--json"]);

      // 等 ~500ms 确保 A 拿到锁 + 进入 sleep 阶段
      await new Promise((r) => setTimeout(r, 500));

      // B: 并发 addProfile — 必须等 A 释放
      const bStart = Date.now();
      const bProm = spawnCli(home, [
        "profile", "add", "claude", "added-during-hook",
        "--dir", join(home, ".claude-added"),
        "--json",
      ]);

      const [aResult, bResult] = await Promise.all([aProm, bProm]);
      const bElapsed = Date.now() - bStart;

      // A 应成功
      expect(aResult.exitCode).toBe(0);
      const aJson = JSON.parse(aResult.stdout.trim());
      expect(aJson.ok).toBe(true);

      // B 应成功（等到锁释放后）
      expect(bResult.exitCode).toBe(0);
      // B 应该等了 ~2.5s 左右（A 跑完 3s 减去 B 启动延迟 0.5s）
      // 旧 bug 路径：B 看 lockfile 太新没 stale → wait → 同样会等
      // 这里主要保证「不 lost update」
      expect(bElapsed).toBeGreaterThan(1500);

      // store 应同时有 added-during-hook（B 加的）+ active=slow-target（A 切的）
      const finalStore = JSON.parse(await readFile(join(home, ".dch/profiles.json"), "utf-8"));
      const ids = finalStore.profiles.map((p: { id: string }) => p.id);
      expect(ids).toContain("added-during-hook");  // B 的 add 没丢
      expect(ids).toContain("default");
      expect(ids).toContain("slow-target");
      expect(finalStore.active.claude).toBe("slow-target");  // A 切了
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 30_000);

  // ── stale 抢占防御：手工伪造一个「70s 前的 lockfile」，验证 acquirer 不会立刻抢占 ──
  // hookTimeoutMs 设很大 → 新 staleMs = 2*hookTimeoutMs+5s；旧 default staleMs=60s。
  // 70s 前的 lockfile：旧路径会立刻判 stale 抢占（错误地以为前一个 useProfile 死了）；
  // 新路径不会。验证方式：spawn addProfile，观察 lockfile 是否被立即删（被抢占）。
  test("staleMs 动态：hookTimeoutMs=200_000 + 70s-old lockfile → addProfile 等待而不立即抢占", async () => {
    const { home } = await setupTmpHome({ hookTimeoutMs: 200_000 });  // staleMs = 2*200000+5000 = 405_000ms
    try {
      const lockPath = join(home, ".dch/profiles.json.lock");
      const fakeLockTs = Date.now() - 70_000;
      await writeFile(lockPath, `99999\n${fakeLockTs}\n`);

      // 起 addProfile，给 < 5s 让它探测 lock 状态。新行为应等待（lock 不被认为 stale），
      // 旧行为会立即抢占（unlink lockfile 后继续）。
      // 我们 setTimeout 在 ~3s 后手工删 lockfile 模拟 holder 释放，让 addProfile 完成。
      const releaseTimer = setTimeout(async () => {
        try { await unlink(lockPath); } catch {}
      }, 3_000);

      const start = Date.now();
      const r = await spawnCli(home, [
        "profile", "add", "claude", "test-add",
        "--dir", join(home, ".claude-test"),
        "--json",
      ]);
      const elapsed = Date.now() - start;
      clearTimeout(releaseTimer);

      // 旧 stale path：addProfile 立即 steal → 几百 ms 完成。
      // 新动态 staleMs：应等到 ~3s 后我们手工 unlink lockfile 才进。
      expect(r.exitCode).toBe(0);
      expect(elapsed).toBeGreaterThan(2_000);  // 至少等了 ~2s
      // store 应有 test-add（add 成功）
      const finalStore = JSON.parse(await readFile(join(home, ".dch/profiles.json"), "utf-8"));
      const ids = finalStore.profiles.map((p: { id: string }) => p.id);
      expect(ids).toContain("test-add");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 30_000);
});
