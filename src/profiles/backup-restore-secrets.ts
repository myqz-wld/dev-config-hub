/**
 * applyBackupWithSecrets — restore + 自动 fan-out 用户填的 secrets。
 *
 * REVIEW_9 G6 拆模块: 从 backup-restore.ts 拆出(顶 500 LOC 护栏)。caller 仍
 * `import {applyBackupWithSecrets / ApplyBackupWithSecretsOptions / Result} from
 * "./backup-restore.ts"` 不变 — backup-restore.ts 顶部 re-export 透传。
 *
 * 流程：
 * 1. 调原 `applyBackup(opts)` 完成 configDir 拷贝 + addProfile + shared 资源（含 placeholders 的 hostPath 重写）
 * 2. 取 `manifest.secrets_index`（无 → 直接返回 base result + secretsApplied: 0）
 * 3. 用 `baseResult.placeholders` 构建 `packPath → hostPath` Map（**排除 _meta.json 段** ——
 *    详 `secrets-index.ts:28-32` docstring：env 段 fieldPath `$.env.K` 与 profiles.json 顶层结构
 *    不对齐，强行 set 必失败；让它们保留为占位符，用户后续手改 profiles.json）
 * 4. 调 `applyFilledSecrets(idx, secretsMap, resolveHostPath)` 按文件 batch 写盘
 * 5. fillResult.errors 镜像 push 到 baseResult.errors，加前缀 `secrets-fill: ` 区分来源
 *
 * `dryRun: true` → 完全跳过 fill 阶段（语义：dryRun 不写 fs）。
 */

import { applyBackup, type ApplyBackupOptions, type ApplyBackupResult } from "./backup-restore.ts";
import { applyFilledSecrets } from "./secrets-index.ts";

export interface ApplyBackupWithSecretsOptions extends ApplyBackupOptions {
  /**
   * logical_key → realValue 映射（来自 `manifest.secrets_index.entries[].name`，
   * 形如 `ANTHROPIC_AUTH_TOKEN-1`）。
   *
   * - **缺 key**：跳过，记入 `secretsSkipped`（user-skip 语义，对应位置仍是占位符）
   * - **多 key**（map 里有但 index 里没有）：记入 `secretsUnknown`，warn 不 fail
   * - **空 map** / **manifest 无 secrets_index**：跳过 fill 阶段（等价 applyBackup）
   */
  secretsMap: Record<string, string>;
}

export interface ApplyBackupWithSecretsResult extends ApplyBackupResult {
  /** 实际成功 fan-out 写入的 location 总数（≤ manifest.secrets_index.total_occurrences） */
  secretsApplied: number;
  /** 用户没填值的 logical_key（map 里 key 不存在 / value === undefined） */
  secretsSkipped: string[];
  /** secretsMap 里有但 manifest.secrets_index 没有的 key（warn 不 fail） */
  secretsUnknown: string[];
  /**
   * secrets fill 阶段的 IO / parse / 寻址 errors（warn 不 fail）。
   * 同时**镜像** push 到 `errors[]` 加前缀 `secrets-fill: `，让 single-error-view caller
   * 直接读 `errors`，细分 caller 读 `secretsErrors`。
   */
  secretsErrors: string[];
}

export async function applyBackupWithSecrets(
  opts: ApplyBackupWithSecretsOptions,
): Promise<ApplyBackupWithSecretsResult> {
  const baseResult = await applyBackup(opts);
  const empty = { secretsApplied: 0, secretsSkipped: [], secretsUnknown: [], secretsErrors: [] };

  if (opts.dryRun) {
    return { ...baseResult, ...empty };
  }

  const idx = opts.parsed.manifest.secrets_index;
  if (!idx || idx.entries.length === 0) {
    return { ...baseResult, ...empty };
  }

  // packPath → hostPath 映射；_meta.json 段排除（双保险：build + resolve 都 check）
  const packToHost = new Map<string, string>();
  for (const ph of baseResult.placeholders) {
    if (!ph.hostPath) continue;
    if (ph.packPath.endsWith("/_meta.json")) continue;
    packToHost.set(ph.packPath, ph.hostPath);
  }
  const resolveHostPath = (packPath: string): string | undefined => {
    if (packPath.endsWith("/_meta.json")) return undefined;
    return packToHost.get(packPath);
  };

  const fillResult = await applyFilledSecrets(idx, opts.secretsMap, resolveHostPath);

  for (const e of fillResult.errors) {
    baseResult.errors.push(`secrets-fill: ${e}`);
  }

  // 让 placeholders[] 反映 fill 后状态：filter 掉真正成功写入的 location（按
  // `${packPath}|${fieldPath}` 复合 key 匹配，因为同 packPath 内可能多个 fieldName 的 placeholder），
  // 剩下的就是「仍待手填」的（含 _meta.json env 段、用户跳过的 logical key、写盘失败的 location）。
  // 不动则 caller 看到的 result.placeholders 是 stale manifest 数据，统计与显示都失真。
  const remainingPlaceholders = baseResult.placeholders.filter(
    (ph) => !fillResult.filledLocations.has(`${ph.packPath}|${ph.fieldPath}`),
  );

  return {
    ...baseResult,
    placeholders: remainingPlaceholders,
    secretsApplied: fillResult.written,
    secretsSkipped: fillResult.skipped,
    secretsUnknown: fillResult.unknown,
    secretsErrors: fillResult.errors,
  };
}
