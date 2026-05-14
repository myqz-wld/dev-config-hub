/**
 * 备份**管理**：列表 / 删除 / 置顶。
 *
 * 数据模型：
 * - 默认位（category: "default"）：~/.dch/backups/latest.dchpack（每次 dch profile backup 覆盖）
 * - 置顶（category: "pinned"）：任何带 sidecar `<file>.pinned`（空文件存在 = 置顶）
 * - 历史（category: "history"）：~/.dch/backups/dch-backup-<TS>.dchpack（dch profile backup --keep 创建）
 *
 * 「置顶 latest」语义：复制 latest.dchpack → dch-backup-<TS>.dchpack + 加 .pinned sidecar，
 * 原 latest.dchpack 仍在（继续会被下次 backup 覆盖）。这样置顶后用户珍藏的版本不会丢，
 * latest 仍然代表"最新一次 backup"。
 *
 * Manifest 摘要：每个 .dchpack 跑 tar -xzOf path ./manifest.json 拿统计（profile / 占位符 /
 * 来源主机 / 时间），N 个备份 = N 次 tar exec ≈ 50-100ms / 个，列表场景可接受。
 *
 * Sidecar `.pinned` 设计：内容空（不存任何字段）；存在 = pinned，不存在 = 不置顶。简单粗暴
 * 跨进程一致，无需 .index.json 中央索引（避免并发写状态分裂）。
 */

import { readdir, mkdir, rm, copyFile, stat, writeFile } from "node:fs/promises";
import { join, dirname, basename, isAbsolute, resolve } from "node:path";
import { DCH_DIR, expandHome } from "./store.ts";

export const BACKUP_DIR = join(DCH_DIR, "backups");
export const DEFAULT_FILENAME = "latest.dchpack";
export const DEFAULT_PATH = join(BACKUP_DIR, DEFAULT_FILENAME);

const PINNED_SUFFIX = ".pinned";

export interface BackupManifestSummary {
  formatVersion: number;
  createdAt: string;
  sourceUser: string;
  sourceHost: string;
  dchVersion: string;
  profileCount: number;
  profileIds: string[];
  placeholderCount: number;
  noPlaceholder: boolean;
  includeShared: boolean;
}

export interface BackupSummary {
  /** 绝对路径 */
  path: string;
  filename: string;
  category: "default" | "pinned" | "history";
  mtimeMs: number;
  bytes: number;
  pinned: boolean;
  /** manifest 关键统计；若 .dchpack 损坏 / 老格式 → null + manifestError */
  manifest: BackupManifestSummary | null;
  manifestError?: string;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readManifestSummary(packPath: string): Promise<{
  manifest: BackupManifestSummary | null;
  manifestError?: string;
}> {
  // 用 ./manifest.json 路径（备份 tar 内部都是 ./prefix）。BSD tar / GNU tar 都接受 ./ 前缀。
  const proc = Bun.spawn(["tar", "-xzOf", packPath, "./manifest.json"], {
    stdout: "pipe", stderr: "pipe",
  });
  const [stdoutText, stderrText] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0) {
    return { manifest: null, manifestError: stderrText.trim() || `tar exit ${code}` };
  }
  try {
    const m = JSON.parse(stdoutText) as Record<string, unknown>;
    const profiles = (m.profiles ?? []) as Array<{ id: string }>;
    const placeholders = (m.placeholders ?? []) as unknown[];
    const options = (m.options ?? {}) as { no_placeholder?: boolean; include_shared?: boolean };
    return {
      manifest: {
        formatVersion: (m.format_version as number) ?? 0,
        createdAt: (m.created_at as string) ?? "",
        sourceUser: (m.source_user as string) ?? "",
        sourceHost: (m.source_host as string) ?? "",
        dchVersion: (m.dch_version as string) ?? "",
        profileCount: profiles.length,
        profileIds: profiles.map((p) => p.id),
        placeholderCount: placeholders.length,
        noPlaceholder: options.no_placeholder ?? false,
        includeShared: options.include_shared ?? true,
      },
    };
  } catch (e) {
    return { manifest: null, manifestError: `JSON parse: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * 解析 caller 给的 path：支持 basename（默认相对 BACKUP_DIR）/ ~/ 形态 / 绝对路径。
 * 这是 CLI / UI 都用的通用 helper —— 用户在 CLI 写 `backup-rm latest.dchpack` 应等价于
 * 写绝对路径。
 *
 * **REVIEW_9 B-MED-2 / B-codex M2 [NEW REGRESSION post-G3]**: 末尾 `resolve(abs)` 规范化
 * `..` 段。旧实现绝对路径原样返回 / `join` 不消化 `..` → caller 传
 * `${BACKUP_DIR}/../../../etc/passwd` 时 abs.startsWith(BACKUP_DIR + "/") 成立(字符串前缀
 * 匹配)但实际指向 BACKUP_DIR 外。`resolve` 把 `..` 段折叠掉,后续 startsWith 边界检查才有效。
 * 注意 `resolve` 仅字符串 normalize 不解 symlink(symlink 防御靠操作系统沙箱 + Tauri capability,
 * 不在本层管)。
 */
export function resolveBackupPath(p: string): string {
  if (!p) throw new Error("路径不能为空");
  let abs = expandHome(p);
  if (!isAbsolute(abs) && !abs.includes("/")) {
    abs = join(BACKUP_DIR, abs);
  } else if (!isAbsolute(abs)) {
    abs = join(process.cwd(), abs);
  }
  return resolve(abs);
}

export async function listBackups(): Promise<BackupSummary[]> {
  if (!(await fileExists(BACKUP_DIR))) return [];
  const names = await readdir(BACKUP_DIR);
  const packs = names.filter((n) => n.endsWith(".dchpack"));
  const pinnedSet = new Set(
    names.filter((n) => n.endsWith(PINNED_SUFFIX)).map((n) => n.slice(0, -PINNED_SUFFIX.length)),
  );

  // 并发处理每个 pack：stat + tar -xzOf manifest 一起跑（N 个备份 N 次 tar，从串行 N×100ms
  // → 并发 ~100ms 总和）。listBackups 是 UI 备份历史 modal 的 hot path，必须并发。
  //
  // **REVIEW_9 B-codex L1**: 不无脑 Promise.all(packs.map(...)) — N=200 备份会 spawn 200 个
  // tar 子进程,fd 耗尽 / spawn 风暴。用 mapWithConcurrency 限并发上限 8 (4 并发 ~25ms /
  // 200 packs 6 批 ~150ms 仍快;200 并发拉爆 fd 有 EMFILE 风险)。
  const results = await mapWithConcurrency(packs, 8, async (name) => {
    const path = join(BACKUP_DIR, name);
    const s = await stat(path).catch(() => null);
    if (!s) return null;
    const isDefault = name === DEFAULT_FILENAME;
    const pinned = pinnedSet.has(name);
    const category: BackupSummary["category"] =
      isDefault ? "default" : pinned ? "pinned" : "history";
    const { manifest, manifestError } = await readManifestSummary(path);
    return {
      path,
      filename: name,
      category,
      mtimeMs: s.mtimeMs,
      bytes: s.size,
      pinned,
      manifest,
      manifestError,
    } as BackupSummary;
  });

  const out = results.filter((x): x is BackupSummary => x !== null);
  // 排序：default 永远第一；其后 pinned 按 mtime 倒序；history 按 mtime 倒序
  out.sort((a, b) => {
    const order = { default: 0, pinned: 1, history: 2 } as const;
    if (order[a.category] !== order[b.category]) return order[a.category] - order[b.category];
    return b.mtimeMs - a.mtimeMs;
  });
  return out;
}

/**
 * 并发上限 N 的 map(worker pool 模式)。N 个 worker 同时跑,每个 worker 取下一个 item 处理直到
 * items 跑完。比 Promise.all(items.map) 更克制 — items.length 大时不会一次 spawn N 个并发。
 *
 * REVIEW_9 B-codex L1: listBackups 用 8 个 worker 上限 (避免 N=200 备份一次 spawn 200 tar)。
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await fn(items[i]!);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/**
 * 删除 .dchpack + 同名 .pinned sidecar(若存在)。allow 删默认位(回到无默认位状态)。
 *
 * **REVIEW_9 B-codex M2**: 加 `.dchpack` 后缀必检 + BACKUP_DIR 边界默认 enforce。旧实现
 * `resolveBackupPath` 允许绝对路径原样返回 + 无 suffix check → CLI/bridge 误传任意绝对路径
 * 就 `rm(abs)`(凭据 / LaunchAgents / 任意用户文件)。`.dchpack` 后缀 + BACKUP_DIR 边界双道
 * 保险阻挡。
 *
 * `allowOutsideBackupDir: true` opt-out 给单元测试用(test 在 mkdtemp 出来的临时目录建 fake
 * .dchpack,无法在真 ~/.dch/backups 下做)。production callers(CLI cmdBackupRm / bridge.backupRm)
 * **不**传此 opt,默认走严格模式。
 */
export async function deleteBackup(
  path: string,
  opts?: { allowOutsideBackupDir?: boolean },
): Promise<void> {
  const abs = resolveBackupPath(path);
  if (!abs.endsWith(".dchpack")) {
    throw new Error(`拒绝删除非 .dchpack 文件: ${abs}(suffix check 防御误删任意路径)`);
  }
  if (!opts?.allowOutsideBackupDir) {
    if (abs !== BACKUP_DIR && !abs.startsWith(BACKUP_DIR + "/")) {
      throw new Error(`拒绝删除 BACKUP_DIR 外的文件: ${abs}(BACKUP_DIR 边界 check)`);
    }
  }
  if (!(await fileExists(abs))) {
    throw new Error(`备份不存在: ${abs}`);
  }
  await rm(abs, { force: true });
  await rm(`${abs}${PINNED_SUFFIX}`, { force: true });
}

export interface PinBackupResult {
  /** 实际写入 .pinned sidecar 的路径（pin=latest 时是新复制的时间戳路径，非 latest 自身） */
  pinnedPath: string;
  /** 是否触发了"复制 latest → 时间戳文件"的派生 */
  copiedFromLatest: boolean;
}

function tsForFilename(d: Date = new Date()): string {
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
 * 置顶 / 取消置顶。
 *
 * - pin=true + 默认位（latest.dchpack）：复制到 dch-backup-<TS>.dchpack + 加 sidecar，
 *   原 latest.dchpack 不动（仍是默认位会被下次 backup 覆盖）。返回 pinnedPath = 复制后的新路径
 * - pin=true + 非默认位：原地 touch sidecar
 * - pin=false：rm sidecar（如果传的是 latest.dchpack，没有 sidecar 可删—— pin=false 操作
 *   对默认位没有意义，silently no-op）
 *
 * **REVIEW_9 B-MED-1 / B-claude H1 + B-codex L1**: 加 `.dchpack` 后缀必检 + BACKUP_DIR 边界
 * 默认 enforce(同 deleteBackup 双道保险)。旧实现仅 `resolveBackupPath` 不校验后缀 + 边界 →
 * caller 误传任意路径(凭据 / LaunchAgents)就 `writeFile(path + ".pinned", "")` 任意写空文件。
 * `allowOutsideBackupDir: true` opt-out 给单元测试用(同 deleteBackup)。production callers
 * (CLI cmdBackupPin / bridge.backupPin)**不**传此 opt,默认走严格模式。
 */
export async function pinBackup(
  path: string,
  pin: boolean,
  opts?: { allowOutsideBackupDir?: boolean },
): Promise<PinBackupResult> {
  const abs = resolveBackupPath(path);
  if (!abs.endsWith(".dchpack")) {
    throw new Error(`拒绝置顶非 .dchpack 文件: ${abs}(suffix check 防御误写任意路径 sidecar)`);
  }
  if (!opts?.allowOutsideBackupDir) {
    if (abs !== BACKUP_DIR && !abs.startsWith(BACKUP_DIR + "/")) {
      throw new Error(`拒绝置顶 BACKUP_DIR 外的文件: ${abs}(BACKUP_DIR 边界 check)`);
    }
  }
  if (!(await fileExists(abs))) {
    throw new Error(`备份不存在: ${abs}`);
  }
  const isDefault = basename(abs) === DEFAULT_FILENAME;

  if (!pin) {
    // 取消置顶：删 sidecar（若存在）
    await rm(`${abs}${PINNED_SUFFIX}`, { force: true });
    return { pinnedPath: abs, copiedFromLatest: false };
  }

  if (isDefault) {
    // 置顶默认位：复制到带时间戳的副本 + 加 sidecar
    await mkdir(dirname(abs), { recursive: true });
    let target = join(BACKUP_DIR, `dch-backup-${tsForFilename()}.dchpack`);
    let tries = 0;
    while (await fileExists(target)) {
      tries++;
      target = join(BACKUP_DIR, `dch-backup-${tsForFilename()}-${tries}.dchpack`);
    }
    await copyFile(abs, target);
    await writeFile(`${target}${PINNED_SUFFIX}`, "");
    return { pinnedPath: target, copiedFromLatest: true };
  }

  // 置顶非默认位：原地 touch sidecar
  await writeFile(`${abs}${PINNED_SUFFIX}`, "");
  return { pinnedPath: abs, copiedFromLatest: false };
}
