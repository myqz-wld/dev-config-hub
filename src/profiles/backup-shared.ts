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

import { readdir, stat, mkdir, copyFile } from "node:fs/promises";
import { join, dirname } from "node:path";
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

// ─── REVIEW_9 follow-up F2: backup-restore 拆模块 ────────────────────────────
// 4 helper + 2 type alias 抽出自 backup-restore.ts(515 → 顶 500 LOC 护栏)。
// caller 仍走 facade `import { ... } from "./backup.ts"` 不变。

/**
 * shared 文件冲突 caller 偏好策略:与冲突解决一一对应。
 * - skip: 直接跳过(等价 skipped-same)
 * - overwrite: 直接覆盖(不留备份)
 * - backup-then-overwrite: 备份 dst → `<dst>.dch-backup-<TS>` 再覆盖(默认)
 *
 * 原 backup-restore.ts:113 定义,F2 挪过来与 applySharedFile 同源。
 */
export type ConflictAction = "skip" | "overwrite" | "backup-then-overwrite";

/**
 * applySharedFile 返回的实际 action 结果:与 SharedAction.action 字段同款。
 *
 * 单独 type alias 让 backup-restore.ts 的 SharedAction.action 与 applySharedFile 返回类型
 * 通过 alias 同源(改 alias 两侧自动一致),不会 type 漂移。
 */
export type SharedActionResult =
  | "created"
  | "skipped-same"
  | "overwritten"
  | "backed-up-then-overwritten";

/**
 * 撞名后缀 helper:`-restored-<本地时间戳>`。
 * configDir 撞已有 / id 撞 store 现有 profile 时统一拿这个后缀。
 */
export function defaultSuffix(): string {
  return `-restored-${tsForFilename()}`;
}

/**
 * 计算文件 sha256(hex 长串);path 读不到返 null 让 caller 判 conflict 时降级处理。
 * applySharedFile 用 srcSha == dstSha 判同 → skipped-same。
 */
export async function fileSha256(path: string): Promise<string | null> {
  try {
    const bytes = await Bun.file(path).bytes();
    const h = new Bun.CryptoHasher("sha256");
    h.update(bytes);
    return h.digest("hex");
  } catch {
    return null;
  }
}

/**
 * 递归 copy `srcDir` 树下所有文件到 `dstDir`(同款相对结构),复用 walkFiles 跳 symlink。
 *
 * 用于 restore 把 dchpack 内的 `profiles/<id>/configDir/**` 拷到 host fs `finalDirAbs/`。
 * walkFiles 已 H2 跳 symlink → 不会跨 configDir 边界 walk(REVIEW_8 H2 / Group D1 同款)。
 */
export async function copyDirRecursive(srcDir: string, dstDir: string): Promise<void> {
  for await (const f of walkFiles(srcDir)) {
    const dst = join(dstDir, f.relPath);
    await mkdir(dirname(dst), { recursive: true });
    await copyFile(f.absPath, dst);
  }
}

/**
 * 应用单个 shared 文件:dst 不存在 → created;存在且 sha 同 → skipped-same;不同则按
 * `preferred` 走 skip / overwrite / backup-then-overwrite(default)。
 *
 * dryRun=true 时算 plan 不写 fs(返同款 action 让 caller 拿到 plan);为 false 才真写。
 *
 * 内部 throw(disk full / EACCES / fileSha256 OOM 等)由 caller 包 try/catch 转 errors[],
 * 不让单个 shared 项异常整段 abort 后续 shared 项(REVIEW_9 B-HIGH-1 同款守护)。
 */
export async function applySharedFile(
  src: string,
  dst: string,
  preferred: ConflictAction | undefined,
  dryRun: boolean,
): Promise<SharedActionResult> {
  const dstExists = await fileExists(dst);
  if (!dstExists) {
    if (!dryRun) {
      await mkdir(dirname(dst), { recursive: true });
      await copyFile(src, dst);
    }
    return "created";
  }
  const [srcSha, dstSha] = await Promise.all([fileSha256(src), fileSha256(dst)]);
  if (srcSha && dstSha && srcSha === dstSha) {
    return "skipped-same";
  }
  const policy: ConflictAction = preferred ?? "backup-then-overwrite";
  if (policy === "skip") return "skipped-same";
  if (!dryRun) {
    if (policy === "backup-then-overwrite") {
      const bak = `${dst}.dch-backup-${tsForFilename()}`;
      await copyFile(dst, bak);
    }
    await copyFile(src, dst);
  }
  return policy === "backup-then-overwrite" ? "backed-up-then-overwritten" : "overwritten";
}
