// Backup / restore bridge: 与 dch CLI `profile {backup,restore,backups,backup-rm,backup-pin}`
// 子命令对应的 webview 包装。从 bridge.ts 拆出（CHANGELOG_18 / Step 6）让 bridge.ts 顶在
// 500 行护栏下，并把 secrets-dedup 新加的 restore secrets commands 落到这里。
//
// caller import 路径不变：bridge.ts 用 `export *` 把本文件全部 surface 透传出去。

import { invoke } from "@tauri-apps/api/core";
import {
  type DchCommandResult,
  runDch,
  TIMEOUT_FAST_MS,
  TIMEOUT_BACKUP_MS,
} from "./bridge.ts";
import type {
  Manifest, AppliedProfile, SharedAction, PlaceholderEntry, ApplyBackupResult,
} from "../profiles/backup.ts";
import type {
  BackupSummary, BackupManifestSummary, PinBackupResult,
} from "../profiles/backup-manage.ts";
import type {
  ApplyBackupWithSecretsResult,
} from "../profiles/backup-restore.ts";
import type {
  SecretLogicalEntry, SecretLocation, SecretsIndex,
} from "../profiles/secrets-index.ts";

export type {
  Manifest, AppliedProfile, SharedAction, PlaceholderEntry, ApplyBackupResult,
  BackupSummary, BackupManifestSummary, PinBackupResult,
  ApplyBackupWithSecretsResult,
  SecretLogicalEntry, SecretLocation, SecretsIndex,
};

/**
 * **REVIEW_9 D-HIGH-1 升 HIGH+**: partial restore 错误。CLI `dch profile restore` JSON 模式
 * `errors.length > 0` 时 stdout 是合法 result JSON 含 manifest + appliedProfiles +
 * sharedActions + errors[],但 process.exit(1) 让 bridge runDch 旧实现把它当 throw error 处理
 * → modal 拿不到 result → 报告页 / `onReloadProfile()` 全跳过(state 紊乱:profiles.json 已加
 * N-1 个 + ~/.dch-restored/ 已写 N-1 个 + UI 卡 step 3 + secret 99 个还在 React state)。
 *
 * 修法:用 PartialRestoreError 区分「部分还原」(stdout 是 result JSON + code 1)与「彻底失败」
 * (stdout 是 jsonErr `{error}` 或空)。Modal catch instanceof 分支:partial → setResult(e.result)
 * + onToast 部分还原 + await onReloadProfile;彻底失败 → 现状 toast。
 */
export class PartialRestoreError<R extends ApplyBackupResult | ApplyBackupWithSecretsResult> extends Error {
  constructor(
    public readonly result: R,
    public readonly manifest: Manifest,
  ) {
    super(
      `部分还原: ${result.errors.length} 错误,已应用 ${result.appliedProfiles.length} profile / ` +
      `${result.sharedActions.length} shared`,
    );
    this.name = "PartialRestoreError";
  }
}

/**
 * 收 DchCommandResult,识别 partial restore + truncated + 普通 error,返回完整 restore result
 * (含 manifest)。供 restoreApply / restoreApplyWithSecrets 共用,避免重复维护两套错误处理。
 *
 * 识别 partial restore 的 4 道条件:
 *   1. r.code !== 0(CLI process.exit(1))
 *   2. r.stdout 是合法 JSON
 *   3. parsed.manifest 字段存在
 *   4. parsed.errors 是 array (非空 → partial; 空 → CLI 出 bug 也按 partial 处理)
 *
 * 任一不满足 → 抛 plain Error(走旧 jsonErr / stderr 路径)。
 */
function consumeRestoreResult<R extends ApplyBackupResult | ApplyBackupWithSecretsResult>(
  r: DchCommandResult,
  timeoutLabel: string,
): { manifest: Manifest } & R {
  if (r.code === -2) {
    throw new Error(`命令超时被强制终止 (timeout=${timeoutLabel}ms)。检查 hook 脚本是否阻塞`);
  }
  if (r.truncated) {
    throw new Error(
      `dch 输出超 5MB 上限被截断 (timeout=${timeoutLabel}ms)，无法完整解析 JSON。请缩减 restore scope / 拆批操作`,
    );
  }

  let parsed: Partial<{ manifest: Manifest; errors: string[]; error: string }> & Record<string, unknown> = {};
  if (r.stdout.trim()) {
    try { parsed = JSON.parse(r.stdout) as typeof parsed; } catch {}
  }

  // partial restore: code !== 0 + stdout 是含 manifest + errors 的 result JSON
  if (r.code !== 0 && parsed.manifest && Array.isArray(parsed.errors)) {
    throw new PartialRestoreError(parsed as unknown as R, parsed.manifest);
  }

  if (r.code !== 0) {
    throw new Error(parsed.error || r.stderr.trim() || `exit ${r.code}`);
  }
  if (!r.stdout.trim()) {
    throw new Error("dch profile restore 返回空 stdout");
  }
  if (!parsed.manifest) {
    throw new Error("dch profile restore stdout 缺 manifest 字段");
  }
  return parsed as { manifest: Manifest } & R;
}

export interface BackupOpts {
  outFile?: string;
  profileIds?: string[];
  noShared?: boolean;
  noPlaceholder?: boolean;
  yes?: boolean;
  /** keep=true → 写带时间戳的历史副本；false（默认）→ 覆盖 ~/.dch/backups/latest.dchpack */
  keep?: boolean;
}

export interface RestoreApplyOpts {
  prefix?: string;
  renameMap?: Record<string, string>;
  /**
   * REVIEW_8 H5 / D3：opt-in 才尊重 manifest 携带的 configDir_original。默认 false →
   * 一律落 ~/.dch-restored/<finalId>/。UI 默认不暴露此 flag — 跨机器迁移用安全默认；
   * 如有「原地还原」诉求另起 advanced UI 走 opt-in。
   */
  allowOriginalPath?: boolean;
}

export interface RestoreApplyWithSecretsOpts extends RestoreApplyOpts {
  /**
   * `logical_key → realValue` 映射，key 来自 `manifest.secrets_index.entries[].name`
   * （形如 `ANTHROPIC_AUTH_TOKEN-1`）。空 / 缺 key 走 user-skip 语义；map 多 key warn 不 fail。
   */
  secretsMap: Record<string, string>;
}

// 与 restoreApply 一致的 manifest+result 联合 shape，用 ApplyBackupWithSecretsResult 替代 ApplyBackupResult
export type RestoreApplyWithSecretsResponse = {
  ok: boolean;
  manifest: Manifest;
} & ApplyBackupWithSecretsResult;

// 现有 restorePreview 已经在 manifest.secrets_index 里返回 entries；此 helper 只是把
// 「manifest 有 secrets_index 且 entries 非空」flatten 成「null | { entries }」，让
// RestoreBackupModal step 3 判断 / 渲染更平。**不**触发新 IPC，复用 restorePreview 结果即可。
export interface RestorePreviewSecretsResult {
  entries: SecretLogicalEntry[];
}

const restorePreview = (packFile: string) =>
  runDch<{ ok: true; dryRun: true; manifest: Manifest; plan: ApplyBackupResult }>(
    ["restore", packFile, "--dry-run"], TIMEOUT_BACKUP_MS,
  );

export const dchBackup = {
  /**
   * 备份 profile + 共享资源到 .dchpack。
   * - keep=false（默认）：覆盖默认位 ~/.dch/backups/latest.dchpack
   * - keep=true：写带时间戳的历史副本 ~/.dch/backups/dch-backup-<TS>.dchpack
   * - outFile 显式指定：以 outFile 为准（最高优先级）
   * - noShared: 不打 ~/.dch/scripts/ + ~/.agents/（默认带）
   * - noPlaceholder: 保留原始 token / API key（强制 yes，避免脚本误用泄露）
   */
  backup: (opts: BackupOpts = {}) => {
    const args: string[] = ["backup"];
    if (opts.outFile) args.push("--out", opts.outFile);
    if (opts.profileIds && opts.profileIds.length > 0) args.push("--profiles", opts.profileIds.join(","));
    if (opts.noShared) args.push("--no-shared");
    if (opts.noPlaceholder) args.push("--no-placeholder");
    if (opts.keep) args.push("--keep");
    if (opts.yes || opts.noPlaceholder) args.push("--yes");
    return runDch<{ ok: true; outFile: string; bytes: number; manifest: Manifest }>(args, TIMEOUT_BACKUP_MS);
  },

  /**
   * dry-run 还原：只解析 .dchpack 拿 manifest + 算冲突 plan，不动 fs。
   * UI 用这个数据渲染冲突 / 改名 / 占位符清单 modal。
   * manifest.secrets_index 含 dedup 后的 logical key 总览（CHANGELOG_18）。
   */
  restorePreview,

  /**
   * 真还原：写 configDir + addProfile + 处理共享资源。
   * UI 在用户点「确认还原」后调，传 renameMap 把改过名的传回。
   * **不填 secrets** → 占位符原样保留，用户事后按 readme 清单手改。
   *
   * **REVIEW_9 D-HIGH-1**: 走 consumeRestoreResult helper,partial restore 抛
   * `PartialRestoreError(result, manifest)` 让 modal catch instanceof 分支拿到 result 渲染
   * 部分还原报告 + reload profile,而不是当 plain error 跳过。
   */
  restoreApply: async (packFile: string, opts: RestoreApplyOpts = {}): Promise<{
    ok: boolean;
    manifest: Manifest;
  } & ApplyBackupResult> => {
    const args: string[] = ["profile", "restore", packFile, "--yes", "--json"];
    if (opts.prefix) args.push("--prefix", opts.prefix);
    if (opts.allowOriginalPath) args.push("--allow-original-path");
    if (opts.renameMap && Object.keys(opts.renameMap).length > 0) {
      args.push("--rename", Object.entries(opts.renameMap).map(([k, v]) => `${k}=${v}`).join(","));
    }
    const r = await invoke<DchCommandResult>("run_dch_command", { args, timeoutMs: TIMEOUT_BACKUP_MS });
    return consumeRestoreResult<{ ok: boolean } & ApplyBackupResult>(r, String(TIMEOUT_BACKUP_MS));
  },

  /**
   * 还原 + 自动 fan-out 用户填的 secrets（CHANGELOG_18）。
   * 等价 CLI `--secrets-json <file>` 自动化模式，但 secret 通过 OS tempfile 走（mode 0600 +
   * Rust drop guard 强制清理），不污染 webview 调用栈也不写到 HOME。
   *
   * 走 Tauri command `run_dch_with_secrets_temp`：Rust 端建 tempfile + spawn dch + 删 tempfile，
   * secret 只在一次 IPC 入参里出现，**不**经第二次 IPC 也**不**落 webview localStorage / log。
   *
   * **REVIEW_9 D-HIGH-1**: 同 restoreApply 走 consumeRestoreResult helper 抛 PartialRestoreError。
   */
  restoreApplyWithSecrets: async (
    packFile: string,
    opts: RestoreApplyWithSecretsOpts,
  ): Promise<RestoreApplyWithSecretsResponse> => {
    const args: string[] = ["profile", "restore", packFile, "--yes", "--json"];
    if (opts.prefix) args.push("--prefix", opts.prefix);
    if (opts.allowOriginalPath) args.push("--allow-original-path");
    if (opts.renameMap && Object.keys(opts.renameMap).length > 0) {
      args.push("--rename", Object.entries(opts.renameMap).map(([k, v]) => `${k}=${v}`).join(","));
    }
    const r = await invoke<DchCommandResult>("run_dch_with_secrets_temp", {
      args,
      secretsJson: JSON.stringify(opts.secretsMap),
      timeoutMs: TIMEOUT_BACKUP_MS,
    });
    return consumeRestoreResult<RestoreApplyWithSecretsResponse>(r, String(TIMEOUT_BACKUP_MS));
  },

  /**
   * preview 阶段拿 dedup 后的 K 个 logical key 总览（不触发新 IPC，复用 restorePreview）。
   * 旧 dchpack 无 secrets_index 或 entries 为空 → null（让 caller 跳过 step 3「填 secret」UI）。
   */
  restorePreviewSecrets: async (packFile: string): Promise<RestorePreviewSecretsResult | null> => {
    const r = await restorePreview(packFile);
    const entries = r.manifest.secrets_index?.entries;
    if (!entries || entries.length === 0) return null;
    return { entries };
  },

  /**
   * 列出 ~/.dch/backups/ 下所有 .dchpack（按 default / pinned / history 三类分组）。
   * 每条含 manifest 摘要（profile / 占位符 / 来源主机 / 时间）。
   */
  backups: () =>
    runDch<{ ok: true; backupDir: string; items: BackupSummary[] }>(["backups"], TIMEOUT_BACKUP_MS),

  /** 删除指定备份（绝对路径或 basename）+ 同名 .pinned sidecar */
  backupRm: (path: string) =>
    runDch<{ ok: true; removed: string }>(["backup-rm", path, "--yes"], TIMEOUT_FAST_MS),

  /**
   * 置顶 / 取消置顶。
   * - pin=true + 默认位（latest.dchpack）：复制到带时间戳新文件 + 加 sidecar，原 latest.dchpack 不动
   * - pin=true + 非默认位：原地 touch sidecar
   * - pin=false：rm sidecar
   */
  backupPin: (path: string, pin: boolean) => {
    const args = ["backup-pin", path];
    if (!pin) args.push("--unpin");
    return runDch<{ ok: true; pin: boolean; pinnedPath: string; copiedFromLatest: boolean }>(args, TIMEOUT_FAST_MS);
  },
};
