/**
 * 备份**还原**核心：parseBackup / cleanupParsed / applyBackup。
 *
 * 与 createBackup 同源 manifest schema（types 在 backup.ts 定义并 re-export）。
 *
 * 流程：
 * 1. parseBackup：tar -xzf 到临时目录 → 读 manifest → 校验 format_version
 * 2. applyBackup（dryRun = true）：算 final id / configDir（撞名加后缀 / renameMap） + 算共享文件 diff，不写 fs
 * 3. applyBackup（dryRun = false）：拷 configDir + addProfile（复用 manager 撞名校验）+ 处理共享文件
 *
 * 关键设计：
 * - 还原**不**触动 active 状态（占位符未填，贸然 use 会让 claude/codex 启动失败）
 * - 还原**不**整体覆盖 ~/.dch/profiles.json（按单条 addProfile，复用 manager 的撞名校验）
 * - shared/dch/scripts/* 与 shared/agents/** 按文件 sha256 比对决定 skip / overwrite / backup-then-overwrite
 * - 占位符位置精准记录，UI 可定位到 final configDir 的 host 路径
 */

import { mkdir, mkdtemp, rm, copyFile } from "node:fs/promises";
import { join, dirname, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import type { Profile } from "./types.ts";
import { loadStore, expandHome, collapseHome, HOME, DCH_DIR, STORE_PATH } from "./store.ts";
import { addProfile } from "./manager.ts";
import {
  FORMAT_VERSION,
  walkFiles, fileExists, tsForFilename, spawnSimple,
  type Manifest, type PlaceholderEntry,
} from "./backup.ts";

/**
 * REVIEW_8 H5 / Group D3：默认强制把还原写到 `~/.dch-restored/<finalId>/` 下，忽略 manifest
 * 携带的 configDir_original。
 *
 * 攻击模型：恶意 .dchpack 在 manifest.profiles[].configDir_original 写 `/etc/cron.d` /
 * `~/.ssh` / `~/Library/LaunchAgents/...`，restore 走 `expandHome(mp.configDir_original)` 当
 * 目标 → addProfile 注册 + tar 解压副本写过去 → 持久化执行 / 凭据替换。
 *
 * 修复：
 * 1. 默认 ALWAYS 用 `~/.dch-restored/<finalId>/` —— 与现有 .dchpack 不向后兼容（review
 *    之前没有 release）
 * 2. `--allow-original-path` opt-in 才允许尊重 manifest 的 configDir_original，但**仍**强制
 *    `validateRestorePath`：必须 HOME 下、不含 `..`、不在敏感黑名单（~/.ssh / ~/.gnupg /
 *    ~/Library/Application Support / ~/Library/LaunchAgents）
 */
const RESTORED_BASE = join(HOME, ".dch-restored");
const RESTORE_BLACKLIST = [
  ".ssh",
  ".gnupg",
  "Library/LaunchAgents",
  "Library/LaunchDaemons",
  "Library/Application Support/com.apple.TCC", // 隐私权限 DB
];

/**
 * 校验 path 是否允许写入。返回 null = 允许；返回 string = reject 原因。
 *
 * 1. 必须绝对路径（caller 应该已 expandHome 过）
 * 2. 必须 startsWith HOME（拒 /etc/* /tmp/* /System/* 等）
 * 3. 不含 `..` 段（防 `~/foo/../../etc` 字符串绕过）
 * 4. 不能在 RESTORE_BLACKLIST 任何子树下（即便在 HOME 内）
 */
export function validateRestorePath(absPath: string): string | null {
  if (!absPath || !isAbsolute(absPath)) return `路径不是绝对路径: ${absPath}`;
  // 字符串子串扫描 .. 段（跨 / 与 \ 分隔，覆盖 fs 拼接 corner case）
  if (absPath.split(/[/\\]/).some((seg) => seg === "..")) {
    return `路径含 '..' 段: ${absPath}`;
  }
  if (!(absPath === HOME || absPath.startsWith(HOME + "/"))) {
    return `路径不在 HOME 下: ${absPath}`;
  }
  const rel = absPath.slice(HOME.length + 1); // strip "HOME/"
  for (const bad of RESTORE_BLACKLIST) {
    if (rel === bad || rel.startsWith(bad + "/")) {
      return `路径在 RESTORE_BLACKLIST 内: ${absPath}（黑名单段: ${bad}）`;
    }
  }
  return null;
}

export interface ParseBackupResult {
  manifest: Manifest;
  packPath: string;
  /** 解压临时目录；caller 调 applyBackup 后由 applyBackup 自己 cleanup。dryRun 后请手动 cleanup */
  tmpDir: string;
}

export async function parseBackup(packFile: string): Promise<ParseBackupResult> {
  if (!(await fileExists(packFile))) {
    throw new Error(`备份文件不存在: ${packFile}`);
  }
  const tmpDir = await mkdtemp(join(tmpdir(), "dch-restore-"));
  const r = await spawnSimple(["tar", "-xzf", packFile, "-C", tmpDir]);
  if (!r.ok) {
    await rm(tmpDir, { recursive: true, force: true });
    throw new Error(`解压备份失败（不是有效的 .dchpack？）: ${r.stderr}`);
  }
  const manifestPath = join(tmpDir, "manifest.json");
  if (!(await fileExists(manifestPath))) {
    await rm(tmpDir, { recursive: true, force: true });
    throw new Error("备份内未找到 manifest.json，包格式不正确");
  }
  const manifest = await Bun.file(manifestPath).json() as Manifest;
  if (manifest.format_version !== FORMAT_VERSION) {
    await rm(tmpDir, { recursive: true, force: true });
    throw new Error(`不兼容的 format_version: ${manifest.format_version}（本版本仅支持 ${FORMAT_VERSION}）`);
  }
  return { manifest, packPath: packFile, tmpDir };
}

export async function cleanupParsed(parsed: ParseBackupResult): Promise<void> {
  await rm(parsed.tmpDir, { recursive: true, force: true });
}

export type ConflictAction = "skip" | "overwrite" | "backup-then-overwrite";

export interface ApplyBackupOptions {
  parsed: ParseBackupResult;
  prefix?: string;
  renameMap?: Record<string, string>;
  /** dryRun = true 只算 plan，不写 fs */
  dryRun?: boolean;
  /** shared 文件冲突默认策略：相同 → skip，不同 → backup-then-overwrite */
  sharedConflict?: ConflictAction;
  /**
   * REVIEW_8 H5 / D3：opt-in 才允许尊重 manifest.profiles[].configDir_original。默认 false →
   * 一律落 `~/.dch-restored/<finalId>/`，杜绝恶意 manifest 把还原写到任意路径。
   * 即使 opt-in 也走 validateRestorePath 二道防线。
   */
  allowOriginalPath?: boolean;
}

export interface AppliedProfile {
  originalId: string;
  finalId: string;
  configDir: string;
  conflict: "none" | "renamed-id" | "renamed-dir" | "renamed-both";
}

export interface SharedAction {
  category: "dch_script" | "agents";
  relPath: string;
  hostPath: string;
  action: "created" | "skipped-same" | "overwritten" | "backed-up-then-overwritten";
}

export interface ApplyBackupResult {
  appliedProfiles: AppliedProfile[];
  sharedActions: SharedAction[];
  placeholders: PlaceholderEntry[];
  errors: string[];
}

function defaultSuffix(): string {
  return `-restored-${tsForFilename()}`;
}

async function fileSha256(path: string): Promise<string | null> {
  try {
    const bytes = await Bun.file(path).bytes();
    const h = new Bun.CryptoHasher("sha256");
    h.update(bytes);
    return h.digest("hex");
  } catch {
    return null;
  }
}

async function copyDirRecursive(srcDir: string, dstDir: string): Promise<void> {
  for await (const f of walkFiles(srcDir)) {
    const dst = join(dstDir, f.relPath);
    await mkdir(dirname(dst), { recursive: true });
    await copyFile(f.absPath, dst);
  }
}

function normalizePath(p: string): string {
  if (!p) return "";
  let abs = p;
  if (!isAbsolute(abs)) abs = expandHome(abs);
  return abs.replace(/\/+/g, "/").replace(/\/+$/, "") || "/";
}

export async function applyBackup(opts: ApplyBackupOptions): Promise<ApplyBackupResult> {
  const { manifest, tmpDir } = opts.parsed;
  const dryRun = !!opts.dryRun;
  const renameMap = opts.renameMap ?? {};
  const prefix = opts.prefix;

  const store = await loadStore();
  const existingIds = new Set(store.profiles.map((p) => p.id));
  const existingDirs = new Set(store.profiles.map((p) => normalizePath(expandHome(p.configDir))));

  const suffix = defaultSuffix();
  const applied: AppliedProfile[] = [];
  const placeholders: PlaceholderEntry[] = [];
  const errors: string[] = [];

  for (const mp of manifest.profiles) {
    let finalId: string;
    let idConflict = false;
    if (renameMap[mp.id]) {
      finalId = renameMap[mp.id]!;
    } else if (prefix) {
      finalId = `${mp.id}${prefix}`;
    } else if (existingIds.has(mp.id)) {
      finalId = `${mp.id}${suffix}`;
      idConflict = true;
    } else {
      finalId = mp.id;
    }
    if (existingIds.has(finalId)) {
      errors.push(`final id 仍冲突: ${finalId}（请手动 --rename ${mp.id}=...)`);
      continue;
    }

    const originalDirAbs = expandHome(mp.configDir_original);
    // REVIEW_8 H5 / D3：默认强制 ~/.dch-restored/<finalId>/，忽略 manifest 携带的 path。
    // opt-in 才用 originalDirAbs，且仍走 validateRestorePath 二道防线（拒非 HOME / .. / 黑名单）。
    let baseDirAbs: string;
    if (opts.allowOriginalPath) {
      const reason = validateRestorePath(originalDirAbs);
      if (reason !== null) {
        errors.push(`profile ${mp.id} 的 configDir_original 被拒（${reason}），fallback 到 ~/.dch-restored/${finalId}/`);
        baseDirAbs = join(RESTORED_BASE, finalId);
      } else {
        baseDirAbs = originalDirAbs;
      }
    } else {
      baseDirAbs = join(RESTORED_BASE, finalId);
    }
    let finalDirAbs = baseDirAbs;
    let dirConflict = false;
    // dir 撞名时：优先用用户传的 prefix（与 finalId 的后缀语义一致），否则 default suffix
    const dirSuffix = prefix ?? suffix;
    if (existingDirs.has(normalizePath(baseDirAbs))) {
      finalDirAbs = `${baseDirAbs}${dirSuffix}`;
      dirConflict = true;
      while (existingDirs.has(normalizePath(finalDirAbs))) {
        finalDirAbs = `${baseDirAbs}-${tsForFilename()}-${Math.random().toString(36).slice(2, 6)}`;
      }
    }

    const conflict =
      idConflict && dirConflict ? "renamed-both"
      : idConflict ? "renamed-id"
      : dirConflict ? "renamed-dir"
      : "none";

    applied.push({ originalId: mp.id, finalId, configDir: collapseHome(finalDirAbs), conflict });
    existingIds.add(finalId);
    existingDirs.add(normalizePath(finalDirAbs));

    // 收集占位符（重写 hostPath 为 final 路径）
    for (const ph of manifest.placeholders) {
      const prefixOfThisProfile = `profiles/${mp.id}/`;
      if (!ph.packPath.startsWith(prefixOfThisProfile)) continue;
      const after = ph.packPath.slice(prefixOfThisProfile.length);
      let hostPath: string | undefined;
      if (after === "_meta.json") {
        hostPath = STORE_PATH; // env 段在 profiles.json
      } else if (after.startsWith("configDir/")) {
        hostPath = join(finalDirAbs, after.slice("configDir/".length));
      }
      placeholders.push({ ...ph, hostPath });
    }

    if (dryRun) continue;

    // 真还原：copy configDir + addProfile（直接 mkdir + walk，不预 stat 目录）
    const srcConfigDir = join(tmpDir, "profiles", mp.id, "configDir");
    await mkdir(finalDirAbs, { recursive: true });
    await copyDirRecursive(srcConfigDir, finalDirAbs);
    const metaPath = join(tmpDir, "profiles", mp.id, "_meta.json");
    let meta: Profile;
    if (await fileExists(metaPath)) {
      meta = await Bun.file(metaPath).json() as Profile;
    } else {
      meta = {
        id: finalId, tool: mp.tool, configDir: collapseHome(finalDirAbs),
        description: mp.description, hooks: mp.hooks,
      };
    }
    const newProfile: Profile = {
      ...meta,
      id: finalId,
      configDir: collapseHome(finalDirAbs),
      isDefault: false,
    };
    try {
      await addProfile(newProfile);
    } catch (e) {
      errors.push(`addProfile(${finalId}) 失败: ${e instanceof Error ? e.message : String(e)}`);
      // REVIEW_8 M1 / Group D4：addProfile 失败时回滚刚刚创建的 configDir，避免留 stranded
      // files 让用户下次 restore 同 id 撞 EEXIST。finalDirAbs 永远是本次新建（前文 existingDirs
      // 撞名检测 + suffix），rm 安全。回滚自身失败也只 push errors 不阻塞后续 profile。
      try {
        await rm(finalDirAbs, { recursive: true, force: true });
      } catch (rollbackErr) {
        errors.push(
          `回滚 ${finalDirAbs} 失败: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`,
        );
      }
    }
  }

  // shared 资源
  const sharedActions: SharedAction[] = [];
  if (manifest.shared.dch_scripts.length > 0) {
    for (const rel of manifest.shared.dch_scripts) {
      const src = join(tmpDir, "dch", "scripts", rel);
      const dst = join(DCH_DIR, "scripts", rel);
      const action = await applySharedFile(src, dst, opts.sharedConflict, dryRun);
      sharedActions.push({ category: "dch_script", relPath: rel, hostPath: dst, action });
    }
  }
  if (manifest.shared.agents_paths.length > 0) {
    for (const rel of manifest.shared.agents_paths) {
      const src = join(tmpDir, "shared", "agents", rel);
      const dst = join(HOME, ".agents", rel);
      const action = await applySharedFile(src, dst, opts.sharedConflict, dryRun);
      sharedActions.push({ category: "agents", relPath: rel, hostPath: dst, action });
    }
  }

  return { appliedProfiles: applied, sharedActions, placeholders, errors };
}

async function applySharedFile(
  src: string,
  dst: string,
  preferred: ConflictAction | undefined,
  dryRun: boolean,
): Promise<SharedAction["action"]> {
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
