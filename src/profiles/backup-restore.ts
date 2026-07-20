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

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PROFILE_TOOL_IDS, type Profile, type ToolKind } from "./types.ts";
import { loadStore, expandHome, collapseHome, HOME, DCH_DIR, STORE_PATH } from "./store.ts";
import { addProfile, ID_RE } from "./manager.ts";
import {
  FORMAT_VERSION,
  fileExists, tsForFilename, spawnSimple,
  defaultSuffix, copyDirRecursive, applySharedFile,
  type Manifest, type PlaceholderEntry,
  type ConflictAction, type SharedActionResult,
} from "./backup-shared.ts";
import {
  RESTORED_BASE,
  safeJoinUnderRoot,
  validateRestorePath,
  normalizePath,
} from "./backup-restore-paths.ts";

// caller 仍 `import { validateRestorePath } from "./backup-restore.ts"` 不变
// (e.g. backup-safety.test.ts)
export { validateRestorePath } from "./backup-restore-paths.ts";

// **REVIEW_9 follow-up F2**: ConflictAction 类型挪到 backup-shared.ts(与 applySharedFile
// 同源),这里 re-export 让 backup.ts → backup-restore.ts → backup-shared.ts re-export chain
// 不断,caller 仍 `import type { ConflictAction } from "./backup.ts"` 不变。
export type { ConflictAction } from "./backup-shared.ts";

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
  // **REVIEW_9 follow-up F2**: 与 backup-shared.ts:applySharedFile 返回类型同源 alias,
  // 通过 type 单一定义点防漂移(改 alias 两侧自动一致)。
  action: SharedActionResult;
}

export interface ApplyBackupResult {
  appliedProfiles: AppliedProfile[];
  sharedActions: SharedAction[];
  placeholders: PlaceholderEntry[];
  errors: string[];
}

// **REVIEW_9 follow-up F2**: defaultSuffix / fileSha256 / copyDirRecursive / applySharedFile
// 4 个 helper 已挪到 backup-shared.ts(让本文件回到 ≤ 500 LOC 护栏)。caller 仍 `import {
// applyBackup, ... } from "./backup.ts"` 不变 — 通过 backup-shared 单 SSOT 让 helper 单一
// 实现点不会双向 import。

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
  // **REVIEW_9 B-INFO-1 / B-claude I1**: prefix 全局参数,循环外 once 校验。旧实现放循环内
  // N profiles 时 errors.push N 条同款报错(noisy + 让 caller 看不出真错在哪)。
  if (prefix !== undefined && prefix !== "" && !/^[a-zA-Z0-9_-]+$/.test(prefix)) {
    throw new Error(`prefix=${JSON.stringify(prefix)} 非法（仅允许字母数字 _ -）`);
  }

  const store = await loadStore();
  const existingIds = new Set(store.profiles.map((p) => p.id));
  const existingDirs = new Set(store.profiles.map((p) => normalizePath(expandHome(p.configDir))));

  const suffix = defaultSuffix();
  const applied: AppliedProfile[] = [];
  const placeholders: PlaceholderEntry[] = [];
  const errors: string[] = [];

  for (const mp of manifest.profiles) {
    if (!PROFILE_TOOL_IDS.includes(mp.tool as ToolKind)) {
      errors.push(`profile tool 非法: ${JSON.stringify(mp.tool)}`);
      continue;
    }
    // REVIEW_8 R2 R2-3 / R3 G1：early ID_RE 校验。恶意 .dchpack 在 manifest.profiles[].id
    // 写 `../.ssh` → finalId 也是 `../.ssh` → join(RESTORED_BASE, "../.ssh") = "$HOME/.ssh"
    // → mkdir / copyDirRecursive 写到 ~/.ssh + addProfile 失败 catch 走 rm -rf 删 ~/.ssh。
    // ID_RE 与 manager.addProfile 同源（仅字母数字 _ -），早期拒绝避免 join 之前发生 traversal。
    if (!ID_RE.test(mp.id)) {
      errors.push(`profile id 非法 (含 / \\ .. 等危险字符): ${JSON.stringify(mp.id)}`);
      continue;
    }
    // renameMap 也校验（caller 控制但仍走防御性校验，避免 CLI / UI 误传 .. 进来）
    if (renameMap[mp.id] && !ID_RE.test(renameMap[mp.id]!)) {
      errors.push(`renameMap[${mp.id}]=${JSON.stringify(renameMap[mp.id])} 非法 id`);
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

    // **REVIEW_9 B-HIGH-2 / B-claude H2 [NEW REGRESSION post-G3]**: applied[] /
    // placeholders[] / existingIds.add / existingDirs.add 假阳性。旧实现在 dryRun=false 路径
    // 也早 push,然后 try/catch 仅 errors.push 不 splice,addProfile / mkdir / copyDirRecursive
    // 失败时 result.appliedProfiles 仍含 finalId(实际未注册) + result.placeholders[] 仍含
    // 该 profile 的 entries(hostPath 写到 finalDirAbs 但实际没创建)→ caller 拿到 result 误以为
    // 部分成功 / fan-out fill 把 secret 写到不存在的 host 路径报 ENOENT。
    //
    // 新实现按 dryRun 分流:
    //   dryRun=true → 早 push(本来就是算 plan,plan 必含 applied + placeholders)
    //   dryRun=false → 进 try 后,addProfile 成功才 push,失败仅 errors.push 不污染 applied/placeholders
    //
    // existingIds.add / existingDirs.add 也按同款分流(dryRun 时算 plan 累计;实写失败时仍累计
    // 让后续 profile 撞名继续 + suffix 避免错误地认为「这个 id 又可用了」给后面 profile 撞同名)。
    // 决策:实写失败时仍 add(避免 N profile 全失败时 second 被分配同款 finalId 又失败)。
    // 收集占位符 helper(dryRun + try 块都用)
    const collectPlaceholders = () => {
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
    };

    if (dryRun) {
      applied.push({ originalId: mp.id, finalId, configDir: collapseHome(finalDirAbs), conflict });
      existingIds.add(finalId);
      existingDirs.add(normalizePath(finalDirAbs));
      collectPlaceholders();
      continue;
    }

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
      // **REVIEW_9 B-HIGH-2**: addProfile 成功才 push 真值进 applied / placeholders
      applied.push({ originalId: mp.id, finalId, configDir: collapseHome(finalDirAbs), conflict });
      existingIds.add(finalId);
      existingDirs.add(normalizePath(finalDirAbs));
      collectPlaceholders();
    } catch (e) {
      const stage = appliedSuccessfully ? "post-add" : "pre/in-add";
      errors.push(`profile ${mp.id} 还原失败 (${stage}): ${e instanceof Error ? e.message : String(e)}`);
      // **REVIEW_9 B-HIGH-2**: 失败时不污染 applied/placeholders,但 existingIds/existingDirs
      // 仍 add 让后续 profile 撞同名时拿到不同 suffix(避免 N profile 全失败时 secondary 被
      // 分配同款 finalId 重蹈覆辙)
      existingIds.add(finalId);
      existingDirs.add(normalizePath(finalDirAbs));
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
  //
  // **REVIEW_9 B-HIGH-1 / B-claude H1 + B-codex H1**: 每个 applySharedFile 包 try/catch +
  // errors.push + continue。旧实现 applySharedFile 内部 throw(disk full / EACCES / fileSha256
  // bytes() OOM / Promise.all rejection)直接逃出 applyBackup 外层 → 后续 shared 项全部不执行
  // + caller 拿到 throw 而非结构化 errors[]。+ element-level `typeof rel === "string"` 校验
  // 防 manifest.shared.*[i] 是 number/null/object 的坏包退化成 join 报错。
  const sharedActions: SharedAction[] = [];
  const runSharedItem = async (
    category: SharedAction["category"],
    rel: unknown,
    rootForSafeJoin: string,
    srcRoot: string,
    label: string,
  ): Promise<void> => {
    if (typeof rel !== "string") {
      errors.push(`${label} 项必须是字符串(实际 ${typeof rel}): ${JSON.stringify(rel)}`);
      return;
    }
    const safeDst = safeJoinUnderRoot(rootForSafeJoin, rel);
    if (safeDst === null) {
      errors.push(`${label} 项被拒（path traversal / 绝对路径 / null byte）: ${JSON.stringify(rel)}`);
      return;
    }
    const src = join(srcRoot, rel);
    try {
      const action = await applySharedFile(src, safeDst, opts.sharedConflict, dryRun);
      sharedActions.push({ category, relPath: rel, hostPath: safeDst, action });
    } catch (e) {
      errors.push(
        `${label} 项 ${JSON.stringify(rel)} 应用失败: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };
  if (manifest.shared.dch_scripts.length > 0) {
    const dchScriptsRoot = join(DCH_DIR, "scripts");
    const srcRoot = join(tmpDir, "dch", "scripts");
    for (const rel of manifest.shared.dch_scripts) {
      await runSharedItem("dch_script", rel, dchScriptsRoot, srcRoot, "manifest.shared.dch_scripts");
    }
  }
  if (manifest.shared.agents_paths.length > 0) {
    const agentsRoot = join(HOME, ".agents");
    const srcRoot = join(tmpDir, "shared", "agents");
    for (const rel of manifest.shared.agents_paths) {
      await runSharedItem("agents", rel, agentsRoot, srcRoot, "manifest.shared.agents_paths");
    }
  }

  // **REVIEW_9 B-MED-1 / B-claude M1**: 还原 ui-prefs.json。backup.ts:276 写 `tmpDir/dch/ui-prefs.json`,
  // 但 restore 旧实现完全不读 → 跨机器 restore 静默丢失全部 UI 偏好(列宽 / 排序 / 主题等)。
  // 用 backup-then-overwrite 策略与 shared assets 一致;dryRun 仅产 SharedAction 不写 fs。
  // 同 B-HIGH-1 包 try/catch 让 applySharedFile 异常不阻塞返回。
  const uiPrefsTmpPath = join(tmpDir, "dch", "ui-prefs.json");
  if (await fileExists(uiPrefsTmpPath)) {
    const uiPrefsHostPath = join(DCH_DIR, "ui-prefs.json");
    try {
      const action = await applySharedFile(uiPrefsTmpPath, uiPrefsHostPath, opts.sharedConflict, dryRun);
      sharedActions.push({ category: "dch_script", relPath: "ui-prefs.json", hostPath: uiPrefsHostPath, action });
    } catch (e) {
      errors.push(`ui-prefs.json 应用失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { appliedProfiles: applied, sharedActions, placeholders, errors };
}

// ─── applyBackupWithSecrets ─────────────────────────────────────────────
// CHANGELOG_18：在原 applyBackup 写盘后追加一步，按 manifest.secrets_index 把
// 用户填的真值 fan-out 到所有 location 的 host fs 路径。原 applyBackup 路径不变，
// 旧 dchpack（无 secrets_index）/ 没传 secretsMap → 走 fall back 等价 applyBackup。
//
// REVIEW_9 G6 拆模块: 实现挪到 backup-restore-secrets.ts(让本文件 ≤ 500 LOC)。
//
// **REVIEW_9 B-LOW-2 / B-claude L1**: 旧版本文件 re-export `applyBackupWithSecrets` 让
// caller 仍 `import {applyBackupWithSecrets} from "./backup-restore.ts"` 不变。但
// backup-restore-secrets.ts 内部 `import { applyBackup } from "./backup-restore.ts"` →
// 形成模块循环 import。改 facade backup.ts 直接 re-export 自 backup-restore-secrets.ts;
// 本文件不再 import / re-export secrets 模块,单向依赖干净:
//   backup.ts ── re-export ──► backup-restore.ts (parseBackup/applyBackup)
//   backup.ts ── re-export ──► backup-restore-secrets.ts (applyBackupWithSecrets)
//   backup-restore-secrets.ts ── import ──► backup-restore.ts (single direction)
