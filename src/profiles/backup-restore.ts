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
    let finalDirAbs = originalDirAbs;
    let dirConflict = false;
    // dir 撞名时：优先用用户传的 prefix（与 finalId 的后缀语义一致），否则 default suffix
    const dirSuffix = prefix ?? suffix;
    if (existingDirs.has(normalizePath(originalDirAbs))) {
      finalDirAbs = `${originalDirAbs}${dirSuffix}`;
      dirConflict = true;
      while (existingDirs.has(normalizePath(finalDirAbs))) {
        finalDirAbs = `${originalDirAbs}-${tsForFilename()}-${Math.random().toString(36).slice(2, 6)}`;
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
