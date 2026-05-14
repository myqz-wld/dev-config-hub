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
 *
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
 *
 * REVIEW_8 R2 R2-3/R2-4/R2-6/R2-9/R2-10 / Round 3 G1（path safety hardening）：
 * - mp.id / finalId early ID_RE 校验（早于 join，杜绝 `..` 注入逃逸 RESTORED_BASE）
 * - manifest.shared.{dch_scripts,agents_paths}[i] rel 走 safeJoinUnderRoot 防御 `../../.ssh/...`
 * - validateRestorePath 加「黑名单祖先」检查（`$HOME/Library` 是 `Library/LaunchAgents` 的祖先 → 拒）
 * - validateRestorePath 大小写不敏感（macOS APFS / HFS+ 默认 case-insensitive，`.SSH` == `.ssh`）
 * - addProfile 失败 rm rollback pre-stat：finalDirAbs 在 restore 之前已存在时**不**rm，避免
 *   --allow-original-path 撞已有非备份目录误删用户数据
 *
 * **REVIEW_9 G6 拆模块**: path safety helpers (RESTORED_BASE / RESTORE_BLACKLIST /
 * safeJoinUnderRoot / validateRestorePath / normalizePath) 抽出 `backup-restore-paths.ts`,
 * 让 backup-restore.ts 顶 500 LOC 护栏。caller 仍 `import {validateRestorePath} from
 * "./backup-restore.ts"` 不变 — 本文件 re-export 透传。
 */

import { mkdir, mkdtemp, rm, copyFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import type { Profile } from "./types.ts";
import { loadStore, expandHome, collapseHome, HOME, DCH_DIR, STORE_PATH } from "./store.ts";
import { addProfile, ID_RE } from "./manager.ts";
import {
  FORMAT_VERSION,
  walkFiles, fileExists, tsForFilename, spawnSimple,
  type Manifest, type PlaceholderEntry,
} from "./backup.ts";
import {
  RESTORED_BASE,
  safeJoinUnderRoot,
  validateRestorePath,
  normalizePath,
} from "./backup-restore-paths.ts";

// caller 仍 `import { validateRestorePath } from "./backup-restore.ts"` 不变
// (e.g. backup-safety.test.ts)
export { validateRestorePath } from "./backup-restore-paths.ts";

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
  // **REVIEW_9 B-HIGH-2 / B-claude H2**: 把 mkdtemp 之后所有可能抛错的步骤包在 try/catch
  // 内,catch 内统一 cleanup tmpDir 后 rethrow。旧实现 `Bun.file(manifestPath).json()` 不在
  // try/catch,manifest 损坏(空 / 非 JSON / null access)时直接 throw 让 tmpDir leak;实测
  // 用户开发机已堆 44 个 `dch-restore-*` 泄漏目录,每个 MB 级 dchpack 内容。
  try {
    const r = await spawnSimple(["tar", "-xzf", packFile, "-C", tmpDir]);
    if (!r.ok) {
      throw new Error(`解压备份失败（不是有效的 .dchpack？）: ${r.stderr}`);
    }
    const manifestPath = join(tmpDir, "manifest.json");
    if (!(await fileExists(manifestPath))) {
      throw new Error("备份内未找到 manifest.json，包格式不正确");
    }
    let manifest: Manifest;
    try {
      manifest = await Bun.file(manifestPath).json() as Manifest;
    } catch (e) {
      throw new Error(`备份内 manifest.json 解析失败: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (manifest.format_version !== FORMAT_VERSION) {
      throw new Error(`不兼容的 format_version: ${manifest.format_version}（本版本仅支持 ${FORMAT_VERSION}）`);
    }
    return { manifest, packPath: packFile, tmpDir };
  } catch (e) {
    // 任意异常路径都 cleanup tmpDir(rm 失败仅 swallow 避免遮蔽原 error)
    try { await rm(tmpDir, { recursive: true, force: true }); } catch {}
    throw e;
  }
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

export async function applyBackup(opts: ApplyBackupOptions): Promise<ApplyBackupResult> {
  const { manifest, tmpDir } = opts.parsed;
  // **REVIEW_9 B-codex M3**: lightweight schema validation。旧实现仅校验 format_version,
  // 后续直接 `manifest.profiles` / `manifest.shared.dch_scripts` 解引用 — 坏包(profiles 缺
  // 字段 / shared 不是 object / placeholders 非数组)从结构化 errors[] 退化成 TypeError,JSON
  // 协议只剩 `{error}` dry-run 拿不到 plan。加最小字段 + 类型 check 防 undefined access。
  if (!Array.isArray(manifest.profiles)) {
    throw new Error("manifest.profiles 必须是数组");
  }
  if (!manifest.shared || typeof manifest.shared !== "object") {
    throw new Error("manifest.shared 必须是 object");
  }
  if (!Array.isArray(manifest.shared.dch_scripts)) {
    throw new Error("manifest.shared.dch_scripts 必须是数组");
  }
  if (!Array.isArray(manifest.shared.agents_paths)) {
    throw new Error("manifest.shared.agents_paths 必须是数组");
  }
  if (!Array.isArray(manifest.placeholders)) {
    throw new Error("manifest.placeholders 必须是数组");
  }

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
    // REVIEW_8 R2 R2-3 / R3 G1：early ID_RE 校验。恶意 .dchpack 在 manifest.profiles[].id
    // 写 `../.ssh` → finalId 也是 `../.ssh` → join(RESTORED_BASE, "../.ssh") = "$HOME/.ssh"
    // → mkdir / copyDirRecursive 写到 ~/.ssh + addProfile 失败 catch 走 rm -rf 删 ~/.ssh。
    // ID_RE 与 manager.addProfile 同源（仅字母数字 _ -），早期拒绝避免 join 之前发生 traversal。
    if (!ID_RE.test(mp.id)) {
      errors.push(`profile id 非法 (含 / \\ .. 等危险字符): ${JSON.stringify(mp.id)}`);
      continue;
    }
    // renameMap 与 prefix 也校验（caller 控制但仍走防御性校验，避免 CLI / UI 误传 .. 进来）
    if (renameMap[mp.id] && !ID_RE.test(renameMap[mp.id]!)) {
      errors.push(`renameMap[${mp.id}]=${JSON.stringify(renameMap[mp.id])} 非法 id`);
      continue;
    }
    if (prefix !== undefined && prefix !== "" && !/^[a-zA-Z0-9_-]+$/.test(prefix)) {
      errors.push(`prefix=${JSON.stringify(prefix)} 非法（仅允许字母数字 _ -）`);
      continue;
    }

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
    // R2-3 二道防线：finalId 派生后再用 ID_RE 拒（含 prefix/suffix 拼接也可能违规）
    if (!ID_RE.test(finalId)) {
      errors.push(`派生的 finalId 非法: ${JSON.stringify(finalId)}（mp.id+prefix/suffix 拼接出危险字符）`);
      continue;
    }
    if (existingIds.has(finalId)) {
      errors.push(`final id 仍冲突: ${finalId}（请手动 --rename ${mp.id}=...)`);
      continue;
    }

    const originalDirAbs = expandHome(mp.configDir_original);
    // REVIEW_8 H5 / D3：默认强制 ~/.dch-restored/<finalId>/，忽略 manifest 携带的 path。
    // opt-in 才用 originalDirAbs，且仍走 validateRestorePath 二道防线（拒非 HOME / .. / 黑名单 / 黑名单祖先）。
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
    // R2-3 三道防线：baseDirAbs 必须在 RESTORED_BASE 子树（默认模式）或 HOME 子树（opt-in 模式）。
    // 即便 ID_RE 已挡 mp.id 危险字符，加 startsWith 兜底（防御性 + future-proof：万一 ID_RE 放宽了）。
    const expectedRoot = opts.allowOriginalPath ? HOME : RESTORED_BASE;
    if (baseDirAbs !== expectedRoot && !baseDirAbs.startsWith(expectedRoot + "/")) {
      errors.push(`baseDirAbs ${baseDirAbs} 逃逸预期 root ${expectedRoot}（path traversal 防御）`);
      continue;
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

    // REVIEW_8 R2 R2-9 / R3 G1：rm rollback pre-stat 检查。`--allow-original-path` 模式 +
    // finalDirAbs 撞已有非备份目录时，addProfile 失败 catch 走 `rm -rf finalDirAbs` 会**删整个
    // 用户原有目录**（包括 copyDirRecursive 没动到的用户原文件 — copyFile 只覆盖同名 file）。
    // 修：mkdir 之前先 stat 看是否已存在（含非空），存在则记 dirPreExisted=true；addProfile 失败
    // 时**不**rm，改 errors.push 显式告知 caller 手动检查。
    //
    // **REVIEW_9 B-HIGH-4 / B-claude H4**: 把 mkdir + copyDirRecursive + 读 meta + addProfile
    // 整段进同一 try/catch。旧实现仅 addProfile 进 try,前面 3 个裸 await(mkdir / copyDirRecursive
    // / `Bun.file(metaPath).json()`)半路抛错(ENOSPC / EACCES / 损坏 meta JSON 等)→ stranded
    // files 留 finalDirAbs / 后续 profiles 全部不还原 / shared assets 整段不执行。新实现 catch
    // 内复用 dirPreExisted 同款 rollback 逻辑(已存在跳过 rm,新建则 rm),让单个 profile 失败
    // 不阻塞主流程,errors.push + continue 让 shared assets 阶段仍能跑。
    const srcConfigDir = join(tmpDir, "profiles", mp.id, "configDir");
    const dirPreExisted = await fileExists(finalDirAbs);
    let appliedSuccessfully = false;
    try {
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
      await addProfile(newProfile);
      appliedSuccessfully = true;
    } catch (e) {
      const stage = appliedSuccessfully ? "post-add" : "pre/in-add";
      errors.push(`profile ${mp.id} 还原失败 (${stage}): ${e instanceof Error ? e.message : String(e)}`);
      // dirPreExisted=true 时**不**rm（避免 --allow-original-path 撞已有非备份目录误删用户数据）。
      if (dirPreExisted) {
        errors.push(
          `目录 ${finalDirAbs} 在 restore 之前已存在用户文件，跳过 rollback rm 避免误删；` +
          `如需清理 restore 写入的副本请手动检查。`,
        );
      } else {
        // dirPreExisted=false 时 rm 安全(只会清掉本次 restore 自己 mkdir + copyDirRecursive 写的)
        try {
          await rm(finalDirAbs, { recursive: true, force: true });
        } catch (rollbackErr) {
          errors.push(
            `回滚 ${finalDirAbs} 失败: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`,
          );
        }
      }
      // continue 让主循环跑下一个 profile + shared assets 阶段仍能执行(B-HIGH-4 关键修复点)
    }
  }

  // shared 资源
  // REVIEW_8 R2 R2-4 / R3 G1：每条 rel 走 safeJoinUnderRoot，杜绝 `../../.ssh/authorized_keys`
  // 这种逃逸 ~/.dch/scripts 或 ~/.agents 子树的攻击。攻击模型：恶意 .dchpack 在 manifest.shared.*
  // 数组里塞 `../../.ssh/authorized_keys`，applySharedFile 调 copyFile 把 .dchpack 内的恶意文件
  // 直接覆盖到敏感路径（凭据 / LaunchAgents 持久化）。
  const sharedActions: SharedAction[] = [];
  if (manifest.shared.dch_scripts.length > 0) {
    const dchScriptsRoot = join(DCH_DIR, "scripts");
    for (const rel of manifest.shared.dch_scripts) {
      const safeDst = safeJoinUnderRoot(dchScriptsRoot, rel);
      if (safeDst === null) {
        errors.push(`manifest.shared.dch_scripts 项被拒（path traversal / 绝对路径 / null byte）: ${JSON.stringify(rel)}`);
        continue;
      }
      const src = join(tmpDir, "dch", "scripts", rel);
      const action = await applySharedFile(src, safeDst, opts.sharedConflict, dryRun);
      sharedActions.push({ category: "dch_script", relPath: rel, hostPath: safeDst, action });
    }
  }
  if (manifest.shared.agents_paths.length > 0) {
    const agentsRoot = join(HOME, ".agents");
    for (const rel of manifest.shared.agents_paths) {
      const safeDst = safeJoinUnderRoot(agentsRoot, rel);
      if (safeDst === null) {
        errors.push(`manifest.shared.agents_paths 项被拒（path traversal / 绝对路径 / null byte）: ${JSON.stringify(rel)}`);
        continue;
      }
      const src = join(tmpDir, "shared", "agents", rel);
      const action = await applySharedFile(src, safeDst, opts.sharedConflict, dryRun);
      sharedActions.push({ category: "agents", relPath: rel, hostPath: safeDst, action });
    }
  }

  // **REVIEW_9 B-MED-1 / B-claude M1**: 还原 ui-prefs.json。backup.ts:276 写 `tmpDir/dch/ui-prefs.json`,
  // 但 restore 旧实现完全不读 → 跨机器 restore 静默丢失全部 UI 偏好(列宽 / 排序 / 主题等)。
  // 用 backup-then-overwrite 策略与 shared assets 一致;dryRun 仅产 SharedAction 不写 fs。
  const uiPrefsTmpPath = join(tmpDir, "dch", "ui-prefs.json");
  if (await fileExists(uiPrefsTmpPath)) {
    const uiPrefsHostPath = join(DCH_DIR, "ui-prefs.json");
    const action = await applySharedFile(uiPrefsTmpPath, uiPrefsHostPath, opts.sharedConflict, dryRun);
    sharedActions.push({ category: "dch_script", relPath: "ui-prefs.json", hostPath: uiPrefsHostPath, action });
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

// ─── applyBackupWithSecrets ─────────────────────────────────────────────
// CHANGELOG_18：在原 applyBackup 写盘后追加一步，按 manifest.secrets_index 把
// 用户填的真值 fan-out 到所有 location 的 host fs 路径。原 applyBackup 路径不变，
// 旧 dchpack（无 secrets_index）/ 没传 secretsMap → 走 fall back 等价 applyBackup。
//
// REVIEW_9 G6 拆模块: 实现挪到 backup-restore-secrets.ts(让本文件 ≤ 500 LOC)。
// caller 仍 `import {applyBackupWithSecrets / ApplyBackupWithSecretsOptions / Result}
// from "./backup-restore.ts"` 不变。
export type {
  ApplyBackupWithSecretsOptions,
  ApplyBackupWithSecretsResult,
} from "./backup-restore-secrets.ts";
export { applyBackupWithSecrets } from "./backup-restore-secrets.ts";
