// **REVIEW_9 D-MED-4 / D-claude I1 升**: 从 RestoreBackupModal.tsx 拆出 5 个 sub-component
// (RestorePreviewBody / RestoreReportBody / SharedActionsList / PlaceholdersList /
// CloseConfirm),让 RestoreBackupModal.tsx 顶 500 LOC 护栏。
//
// 各 component 都是无状态展示组件,接收主 modal 算好的 props (renameMap / renameError /
// secretEntries / result / appliedById 等),不持 state 不调 IPC,纯渲染。这样 modal 主文件
// 聚焦状态机 + IPC 调度,展示细节单独维护。
//
// 顺手一并删 RestoreBackupModal.tsx 旧 dead code `type _UnusedToolKind = ToolKind`
// (`ToolKind` import 仅本类型定义引用,删后整个 import 也清理)。

import React from "react";
import type {
  Manifest, AppliedProfile, SharedAction, PlaceholderEntry, ApplyBackupResult,
  SecretLogicalEntry,
} from "../../bridge.ts";
import { UniqueSecretsList } from "./UniqueSecretsList.tsx";

/**
 * REVIEW_9 D-HIGH-2: secrets phase 关 modal 内联 confirm UI。覆盖在 modal-body 顶部，
 * cancel = 留在 modal 继续填；confirm = 清 secretsState + onClose()。
 */
export function CloseConfirm({ filledCount, onCancel, onConfirm }: {
  filledCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="form-row form-row-block"
      style={{
        padding: "12px 16px",
        background: "rgba(227,179,65,.10)",
        borderLeft: "3px solid var(--yellow)",
        borderRadius: 2,
        marginBottom: 12,
      }}
    >
      <p className="form-hint" style={{ color: "var(--yellow)", margin: 0, fontSize: 14 }}>
        ⚠️ 已填 <strong>{filledCount}</strong> 个 secret。关闭将丢弃所有输入，需重头开始。
      </p>
      <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
        <button className="btn-sm" onClick={onCancel}>留下继续填</button>
        <button className="btn-sm danger danger-solid" onClick={onConfirm}>放弃并关闭</button>
      </div>
    </div>
  );
}

export function RestorePreviewBody({
  manifest, plan, renameMap, renameError, onUpdate, busy, secretEntries,
}: {
  manifest: Manifest;
  plan: ApplyBackupResult;
  renameMap: Record<string, string>;
  renameError: (originalId: string, finalId: string) => string | null;
  onUpdate: (originalId: string, newId: string) => void;
  busy: boolean;
  /** null = 旧 pack / no-placeholder，跳过 step 3；非 null = 显示完整清单预告 */
  secretEntries: SecretLogicalEntry[] | null;
}) {
  const hasSecrets = secretEntries !== null && secretEntries.length > 0;
  const totalOcc = hasSecrets ? secretEntries!.reduce((s, e) => s + e.count, 0) : 0;
  return (
    <>
      <div className="form-row">
        <label>来源</label>
        <span>{manifest.source_user}@{manifest.source_host} · {new Date(manifest.created_at).toLocaleString()} · DCH v{manifest.dch_version}</span>
      </div>
      {manifest.options.no_placeholder && (
        <div className="form-row form-row-block">
          <p className="form-hint" style={{ color: "var(--red)" }}>
            ⚠️ 此包含明文凭据（来源 --no-placeholder 模式）
          </p>
        </div>
      )}
      {hasSecrets && (
        <div className="form-row form-row-block">
          <div
            style={{
              padding: "8px 12px",
              background: "rgba(88,166,255,.08)",
              color: "var(--blue)",
              borderLeft: "3px solid var(--blue)",
              borderRadius: 2,
            }}
          >
            <p className="form-hint" style={{ margin: 0, color: "var(--blue)" }}>
              🔑 改名确认后下一步将填写 <strong>{secretEntries!.length}</strong> 个去重 secret（自动 fan-out 到所有 {totalOcc} 处出现位置）
            </p>
            <UniqueSecretsList
              entries={secretEntries!}
              summaryPrefix="🔑 清单"
              footerHint={null}
            />
          </div>
        </div>
      )}

      <div className="form-section-title">待还原 profile（{plan.appliedProfiles.length}）</div>
      {plan.appliedProfiles.map((ap) => {
        const finalId = renameMap[ap.originalId] ?? ap.finalId;
        const errMsg = renameError(ap.originalId, finalId);
        return (
          <div key={ap.originalId} className="form-row form-row-block">
            <label>
              {ap.originalId}
              {ap.conflict !== "none" && <span className="badge env" style={{ marginLeft: 8 }}>{ap.conflict}</span>}
            </label>
            <input
              type="text"
              value={finalId}
              onChange={(e) => onUpdate(ap.originalId, e.target.value)}
              disabled={busy}
              spellCheck={false}
              style={errMsg ? { borderColor: "var(--red)" } : undefined}
            />
            {errMsg && <p className="form-hint" style={{ color: "var(--red)" }}>{errMsg}</p>}
            <p className="form-hint">configDir → <code>{ap.configDir}</code></p>
          </div>
        );
      })}

      {plan.sharedActions.length > 0 && (
        <>
          <div className="form-section-title">共享资源（{plan.sharedActions.length}）</div>
          <div className="form-row form-row-block">
            <SharedActionsList items={plan.sharedActions} />
          </div>
        </>
      )}

      {plan.placeholders.length > 0 && (
        <>
          <div className="form-section-title">待填占位符（{plan.placeholders.length}）</div>
          <div className="form-row form-row-block">
            <PlaceholdersList items={plan.placeholders} />
          </div>
        </>
      )}

      {plan.errors.length > 0 && (
        <div className="form-row form-row-block">
          <p className="form-hint" style={{ color: "var(--red)" }}>错误：</p>
          {plan.errors.map((e, i) => <p key={i} className="form-hint" style={{ color: "var(--red)" }}>• {e}</p>)}
        </div>
      )}
    </>
  );
}

export function RestoreReportBody({
  result, appliedById, onReveal, computeRevealTarget, secretsMetrics,
}: {
  result: ApplyBackupResult;
  appliedById: Record<string, AppliedProfile>;
  onReveal?: (profileId: string, configFile: string) => void;
  computeRevealTarget: (
    ph: PlaceholderEntry,
    appliedById: Record<string, AppliedProfile>,
  ) => { profileId: string; configFile: string } | null;
  /** 仅当本次 restore 走 restoreApplyWithSecrets 时传，控制底部 secrets metrics 段渲染 */
  secretsMetrics?: { applied: number; skipped: string[]; unknown: string[] };
}) {
  return (
    <>
      <div className="form-row form-row-block">
        <p className="form-hint">✓ 已还原 {result.appliedProfiles.length} 个 profile（共享资源 {result.sharedActions.length} 项）。</p>
        {secretsMetrics && (
          <p className="form-hint" style={{ color: secretsMetrics.applied > 0 ? "var(--green)" : "var(--fg2)" }}>
            🔑 填值 {secretsMetrics.applied} 处 · 跳过 {secretsMetrics.skipped.length} 个 logical key
            {secretsMetrics.unknown.length > 0 && ` · 未知 key ${secretsMetrics.unknown.length} 个（已忽略）`}
          </p>
        )}
      </div>

      <div className="form-section-title">已还原 profile</div>
      {result.appliedProfiles.map((ap) => (
        <div key={ap.originalId} className="form-row">
          <code>{ap.originalId}</code>
          <span> → </span>
          <code>{ap.finalId}</code>
          <span className="profile-desc"> ({ap.configDir})</span>
          {ap.conflict !== "none" && <span className="badge env" style={{ marginLeft: 8 }}>{ap.conflict}</span>}
        </div>
      ))}

      {result.placeholders.length > 0 && (
        <>
          <div className="form-section-title">待填占位符（{result.placeholders.length}）</div>
          <p className="form-hint">
            填完真实凭据后跑 <code>dch profile use &lt;id&gt;</code>。
            点占位符旁的「编辑」按钮直接打开对应文件。
          </p>
          {result.placeholders.map((ph, i) => {
            const tgt = computeRevealTarget(ph, appliedById);
            return (
              <div key={i} className="form-row">
                <span><code>{ph.fieldName}</code></span>
                <span className="profile-desc"> {ph.hint}</span>
                <span className="profile-desc"> · {ph.hostPath ?? ph.packPath}</span>
                {tgt && onReveal && (
                  <button
                    className="btn-sm"
                    onClick={() => onReveal(tgt.profileId, tgt.configFile)}
                    style={{ marginLeft: 8 }}
                  >
                    编辑
                  </button>
                )}
              </div>
            );
          })}
        </>
      )}

      {result.errors.length > 0 && (
        <div className="form-row form-row-block">
          <p className="form-hint" style={{ color: "var(--red)" }}>错误（{result.errors.length}）：</p>
          {result.errors.map((e, i) => <p key={i} className="form-hint" style={{ color: "var(--red)" }}>• {e}</p>)}
        </div>
      )}
    </>
  );
}

export function SharedActionsList({ items }: { items: SharedAction[] }) {
  // 按 action 聚合：created N / overwritten M / skipped K
  const grouped = items.reduce<Record<string, number>>((acc, x) => {
    acc[x.action] = (acc[x.action] ?? 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(grouped).map(([k, v]) => `${k}: ${v}`).join(" · ");
  return (
    <details>
      <summary className="form-hint">{summary}</summary>
      {items.map((x, i) => (
        <p key={i} className="form-hint" style={{ marginLeft: 16, marginTop: 4 }}>
          [{x.category}] {x.relPath} → {x.action}
        </p>
      ))}
    </details>
  );
}

export function PlaceholdersList({ items }: { items: PlaceholderEntry[] }) {
  return (
    <details open>
      <summary className="form-hint">点击展开 / 收起</summary>
      {items.map((p, i) => (
        <p key={i} className="form-hint" style={{ marginLeft: 16, marginTop: 4 }}>
          <code>{p.fieldName}</code> — {p.hint}<br />
          <span style={{ color: "var(--fg3)" }}>{p.hostPath ?? p.packPath}</span>
        </p>
      ))}
    </details>
  );
}
