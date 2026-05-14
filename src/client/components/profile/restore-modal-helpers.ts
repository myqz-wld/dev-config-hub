// REVIEW_9 G12 / D-MED-3: G5/G6 关键修法的 pure decide helper 抽出,让 invariant test
// 不需要 RTL render 整个 component。
//
// 5 个 invariant test 中的 3 个走本文件 helper(decideAttemptClose / decideRaceResolution /
// nextSecretsStateAfterIPC);其余 2 个 (consumeRestoreResult / buildRestoreArgs) 已 export
// 自 bridge-backup.ts 同款方式。

import type { SecretLogicalEntry } from "../../bridge.ts";

// ─── REVIEW_9 D-HIGH-2: attemptClose 决策 ──────────────────────────────────

/**
 * 决策结果:
 * - "noop"     → busy 中拒绝任何关闭路径(防 setState on unmounted,D-codex M4 同根)
 * - "confirm"  → secrets phase 已填值时弹内联 confirm(CHANGELOG_5 不能用 window.confirm)
 * - "close"    → 直接 onClose()
 */
export type AttemptCloseDecision = "noop" | "confirm" | "close";

export function decideAttemptClose(args: {
  busy: boolean;
  phase: "rename" | "secrets";
  hasSecrets: boolean;
  filledCount: number;
}): AttemptCloseDecision {
  if (args.busy) return "noop";
  if (args.phase === "secrets" && args.hasSecrets && args.filledCount > 0) {
    return "confirm";
  }
  return "close";
}

/**
 * 计算"待 fill secrets phase 已填值数量"。skip 优先(skip 即便 value 存在不算 filled);
 * 空字符串 value 也不算(length === 0 短路)。与 RestoreBackupModal.tsx attemptClose 内
 * 内联计算口径一致。
 */
export function countFilledSecrets(
  entries: SecretLogicalEntry[],
  state: { secretsMap: Record<string, string>; skipMap: Record<string, boolean> },
): number {
  return entries.filter(
    (e) => !state.skipMap[e.name] && (state.secretsMap[e.name] ?? "").length > 0,
  ).length;
}

// ─── REVIEW_9 D-MED-5: reload race resolution(reloadIdRef 模式 pure 抽出) ─────

/**
 * 决策当前 reload response 是否应该 commit 到 state。
 *
 * 模式:每次 reload 自增 id (myId);多个 reload 并发时,response 回到检查 currentId
 * (latest 已发起的 myId)是否仍 === 自己 myId。一致 → commit;不一致 → 旧请求被新请求
 * 取代,丢弃响应不污染 state。
 */
export function shouldCommitReloadResponse(args: {
  myId: number;
  currentId: number;
}): boolean {
  return args.currentId === args.myId;
}

// ─── REVIEW_9 D-MED-1: secret state hygiene reset ──────────────────────────

/**
 * IPC 完成后(成功 / 失败 / partial)立即清 secretsState 把明文残留窗口最小化到 IPC
 * in-flight 那 N 秒。返回新 state(空 secretsMap + 空 skipMap),caller 直接调
 * setSecretsState(nextSecretsStateAfterIPC()) 即可。
 */
export function nextSecretsStateAfterIPC(): {
  secretsMap: Record<string, string>;
  skipMap: Record<string, boolean>;
} {
  return { secretsMap: {}, skipMap: {} };
}
