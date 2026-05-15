/**
 * REVIEW_9 follow-up F3 回归 — createBackup --keep TOCTOU(B-LOW-1 / B-codex MED-3 *未验证* 降)。
 *
 * 旧实现 fileExists(candidate) check 与后续 mv tmpOut→outFile 之间存在窗口:同秒并发
 * createBackup --keep 进程 A/B 同时 fileExists 都返 false → 都选同名 candidate → A mv 完
 * 后 B mv 直接覆盖 A 的备份 → 数据丢失。
 *
 * 修法:fs.open(path, 'wx') = O_CREAT|O_EXCL,candidate 选定时立刻原子占位 0 字节 placeholder,
 * 并发进程下次 wx 见 EEXIST 自动走下一个 suffix。失败 path 主 try/finally + mvSucceeded
 * flag 触发 placeholder cleanup 防 leak 0 字节文件。
 *
 * 本 test spawn 10 个并发 `dch profile backup --keep` 进程,验证:
 * 1. 全部 exit 0(没有撞名导致一个失败让 caller 不知道)
 * 2. ~/.dch/backups/dch-backup-*.dchpack 文件数 = 10(全部独立 outFile)
 * 3. 每个 archive size > 0(0 字节 placeholder 没被 leak 当成最终备份)
 * 4. 每个 archive `tar -tzf` 通过(完整 valid dchpack)
 *
 * Win 不跑(dch 应用 macOS-only;tar / mv 走 sh 在 Win 不可用)。
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, symlink, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { IS_WIN } from "../platform.ts";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const CLI_PATH = join(REPO_ROOT, "src/cli.ts");

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runCli(home: string, args: string[]): {
  exitCode: Promise<number>;
  stdout: Promise<string>;
  stderr: Promise<string>;
} {
  const proc = Bun.spawn(["bun", CLI_PATH, ...args], {
    env: { ...process.env, HOME: home },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  return {
    exitCode: proc.exited.then(() => proc.exitCode ?? -1),
    stdout: new Response(proc.stdout).text(),
    stderr: new Response(proc.stderr).text(),
  };
}

async function awaitCli(p: ReturnType<typeof runCli>): Promise<CliResult> {
  const [exitCode, stdout, stderr] = await Promise.all([p.exitCode, p.stdout, p.stderr]);
  return { exitCode, stdout, stderr };
}

async function setupTmpHomeForBackup(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "dch-f3-toctou-"));
  await mkdir(join(home, ".dch", "backups"), { recursive: true });
  // 最小 profile:configDir 内放一个文件让 backup 不空
  const configDir = join(home, ".claude-test");
  await mkdir(configDir, { recursive: true });
  await writeFile(join(configDir, "settings.json"), JSON.stringify({ test: true }, null, 2));
  // dch profile 期望 ~/.claude symlink
  await symlink(configDir, join(home, ".claude"));

  const store = {
    version: 1,
    profiles: [
      {
        id: "claude-test",
        tool: "claude",
        configDir: "~/.claude-test",
        isDefault: true,
      },
    ],
    active: { claude: "claude-test", codex: null },
    preferences: { hookTimeoutMs: 30_000 },
  };
  await writeFile(join(home, ".dch", "profiles.json"), JSON.stringify(store, null, 2));
  return home;
}

describe.skipIf(IS_WIN)("REVIEW_9 follow-up F3 — createBackup --keep TOCTOU 回归", () => {
  test("10 个并发 backup --keep 全部独立成功不撞名 + 不 leak 0 字节 placeholder", async () => {
    const home = await setupTmpHomeForBackup();

    // 同时 spawn 10 个 backup --keep,Promise.all 让进程几乎同瞬启动 → 高概率撞同秒 baseTs
    const N = 10;
    const procs = Array.from({ length: N }, () =>
      runCli(home, ["profile", "backup", "--keep", "--no-shared", "--no-placeholder", "--yes"])
    );
    const results = await Promise.all(procs.map(awaitCli));

    // 1. 全部 exit 0
    for (let i = 0; i < N; i++) {
      const r = results[i]!;
      // (debug)stderr 应空,真有错就打出来便于查 — 必须先 console 再 expect 否则失败信息丢
      if (r.exitCode !== 0) {
        console.error(`backup ${i} exit=${r.exitCode}`);
        console.error(`backup ${i} stderr:`, r.stderr);
        console.error(`backup ${i} stdout:`, r.stdout);
      }
      expect(r.exitCode).toBe(0);
    }

    // 2. ~/.dch/backups/dch-backup-*.dchpack 数 === N(全部独立 outFile)
    const backupsDir = join(home, ".dch", "backups");
    const entries = await readdir(backupsDir);
    const dchpacks = entries.filter((f) => /^dch-backup-.+\.dchpack$/.test(f));
    expect(dchpacks.length).toBe(N);

    // 3. 每个文件 size > 0(0 字节 placeholder 没 leak 出来当作最终备份)
    for (const f of dchpacks) {
      const st = await stat(join(backupsDir, f));
      expect(st.size).toBeGreaterThan(0);
    }

    // 4. 每个 archive tar -tzf 通过(完整 dchpack 不是半写文件)
    for (const f of dchpacks) {
      const verify = Bun.spawn(["tar", "-tzf", join(backupsDir, f)], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = await verify.exited;
      const stderr = await new Response(verify.stderr).text();
      expect(exitCode).toBe(0);
      // tar -tzf 会列出 archive 内所有 entry 应不报错;这里只校 exit code 即可
      if (exitCode !== 0) {
        console.error(`tar verify ${f} stderr:`, stderr);
      }
    }

    // 5. (诊断)统计 baseTs 分布 — race 真触发的话至少 2 个文件 share 同款 <YYYYMMDD-HHmmss>
    //    baseTs。若 baseTs 全独立(各跨秒)race 没触发但 N 文件全独立 outFile 仍验证 fs.open(wx)
    //    工作正常 — 不让 test fail,只 stdout 输出便于排查机器太慢导致没撞同秒的情况。
    const baseTsCounts = new Map<string, number>();
    for (const f of dchpacks) {
      const m = f.match(/^dch-backup-(\d{8}-\d{6})/);
      if (!m) continue;
      baseTsCounts.set(m[1]!, (baseTsCounts.get(m[1]!) ?? 0) + 1);
    }
    const maxShared = Math.max(...baseTsCounts.values());
    console.log(
      `[F3 toctou] N=${N} | 唯一 baseTs=${baseTsCounts.size} | 最大撞秒数=${maxShared}` +
      ` | 分布: ${JSON.stringify(Object.fromEntries(baseTsCounts))}`,
    );
  }, 60_000);
});
