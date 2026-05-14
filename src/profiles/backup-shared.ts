/**
 * 备份**共享 layer**: types + 通用 fs / 子进程 helper。从 backup.ts 拆出
 * (REVIEW_9 G6 拆模块,消除 backup.ts ↔ backup-restore.ts + secrets-index.ts ↔ backup.ts
 * 双向 import,让 backup-restore / secrets-index 直接 import 自这里不再走 backup.ts 间接桥)。
 *
 * caller 仍 `import { ... } from "./backup.ts"` 不变 — backup.ts 顶部 re-export 透传。
 *
 * 4 个 type:
 * - `FORMAT_VERSION` manifest 顶层 schema 版本
 * - `ManifestProfile` / `PlaceholderEntry` / `Manifest` dchpack manifest schema 三件套
 *
 * 4 个 helper:
 * - `tsForFilename(d?)` 文件名时间戳格式化(本地时间 YYYYMMDD-HHmmss)
 * - `walkFiles(rootAbs, relBase?)` 异步生成器递归遍历目录,跳过 symlink (REVIEW_8 H2 / Group D1)
 * - `fileExists(p)` stat 包装 boolean 返
 * - `spawnSimple(cmd, cwd?, opts?)` Bun.spawn 包装,自动 drain stdout / stderr 防 pipe 满阻塞
 *   child + 可选 timeoutMs (REVIEW_9 B-MED-2 / B-claude M2)
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ToolKind, ProfileHooks } from "./types.ts";
import type { SecretsIndex } from "./secrets-index.ts";

export const FORMAT_VERSION = 1 as const;

export interface ManifestProfile {
  id: string;
  tool: ToolKind;
  configDir_original: string;
  description?: string;
  hooks?: ProfileHooks;
  env_keys: string[];
  active_in_source: boolean;
}

export interface PlaceholderEntry {
  /** dchpack 内相对 path（如 `profiles/claude-pro/configDir/.mcp.json`） */
  packPath: string;
  fieldPath: string;
  fieldName: string;
  hint: string;
  /** restore 后实际 host fs 上的绝对路径（dryRun 时根据 final configDir 计算） */
  hostPath?: string;
}

export interface Manifest {
  format_version: typeof FORMAT_VERSION;
  created_at: string;
  source_host: string;
  source_user: string;
  dch_version: string;
  options: {
    include_shared: boolean;
    no_placeholder: boolean;
    profile_ids: string[];
  };
  profiles: ManifestProfile[];
  shared: {
    dch_scripts: string[];
    agents_paths: string[];
  };
  placeholders: PlaceholderEntry[];
  /**
   * 按真值 hash 全局合并的 logical key 索引（CHANGELOG_18）。
   * 仅当 `!no_placeholder` 且实际存在敏感命中时挂出；旧 dchpack（无此字段）由 restore
   * 端 fall back 到 `placeholders[]` 走逐文件 dump 清单（兼容路径）。
   */
  secrets_index?: SecretsIndex;
  security_warnings: string[];
}

export function tsForFilename(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "-" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

/**
 * 递归遍历目录，yield 每个真文件的相对 path + 绝对 path。
 *
 * REVIEW_8 H2 / Group D1：**严禁跟 symlink 走**（dir 也好 file 也好）。
 * 旧实现用 `e.isSymbolicLink() && isDirSafe(abs)` 走 stat 判断 symlink 目标类型，stat
 * follows symlink → 用户在 configDir 放 `bad → /etc` 这种 dir symlink 会让 backup 把
 * /etc 整个递归打包；symlink file 也会被 yield 后让 tar -ch deref 写入恶意目标内容。
 *
 * Dirent.isSymbolicLink() 用 lstat 语义判断「entry 本身是否 symlink」（与 target 类型无关）—
 * 直接 continue 跳过 symlink 即可，不需要再 lstat。
 *
 * 副作用：用户在 configDir 用 symlink 链接外部模板（罕见）会被忽略；建议改用复制。
 * 可接受 trade-off — backup 安全 > 边缘 symlink 用例。
 */
export async function* walkFiles(
  rootAbs: string,
  relBase = "",
): AsyncGenerator<{ relPath: string; absPath: string }> {
  let entries;
  try {
    entries = await readdir(rootAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) {
      // H2：dir / file symlink 一律跳过，杜绝跨 configDir 边界的 fs walk
      continue;
    }
    const abs = join(rootAbs, e.name);
    const rel = relBase ? `${relBase}/${e.name}` : e.name;
    if (e.isDirectory()) {
      yield* walkFiles(abs, rel);
    } else if (e.isFile()) {
      yield { relPath: rel, absPath: abs };
    }
  }
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Spawn 子进程跑 shell 命令,返回 ok + stderr。
 *
 * **REVIEW_9 B-MED-2 / B-claude M2**: footgun 修复。
 * - 旧实现 stdout=pipe 但**不消费**:当前 5 个 caller(tar / mv / verify)都不出 stdout 不会
 *   立刻 hang,但未来加任何会出 stdout 的命令(如 `tar -czf - | gzip` 不带 redirect)立刻
 *   死锁(pipe buffer 64KB 满了 child 阻塞 write,父 wait exited 永远不返)。
 * - 旧实现无 timeout:tar / mv 卡死(NFS / 磁盘 hang)直接挂父进程不退出。
 *
 * 修法:
 * 1. **stdout 也并发 consume**(空读丢弃),与 stderr 同样走 Response(stream).text() 防止
 *    pipe buffer 满阻塞 child;
 * 2. **可选 timeoutMs** + AbortController 超时 kill。caller 显式传 ms,默认 undefined = 不
 *    设超时(maintain 旧行为防误伤 createBackup tar 100s+ 大档场景)。
 *
 * 显式让 stdout="ignore" 可以更便宜(skip pipe 创建)但语义不同,当前 caller 不需要 stdout
 * 输出,future-proof 走 pipe + drain 而非 ignore — pipe 让 caller 想读时随时改 drain → 留
 * 接口没掉。
 */
export async function spawnSimple(
  cmd: string[],
  cwd?: string,
  opts?: { timeoutMs?: number },
): Promise<{ ok: boolean; stderr: string }> {
  const ac = opts?.timeoutMs ? new AbortController() : undefined;
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    ...(ac ? { signal: ac.signal } : {}),
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (ac && opts?.timeoutMs) {
    timer = setTimeout(() => ac.abort(), opts.timeoutMs);
  }
  try {
    // 并发 drain 两个 pipe 防 buffer 满阻塞 child(stdout 内容丢弃 不消费)
    const [, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    return { ok: code === 0, stderr };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
