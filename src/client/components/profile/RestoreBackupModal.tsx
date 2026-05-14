import React, { useState, useEffect, useRef } from "react";
import {
  dchProfile, type Profile, type Manifest, type AppliedProfile,
  type ApplyBackupResult, type SharedAction, type PlaceholderEntry,
  type SecretLogicalEntry, type ApplyBackupWithSecretsResult,
  type ToolKind,
} from "../../bridge.ts";
import { RestoreSecretsBody, computeSecretsButton, type SecretsState } from "./RestoreSecretsBody.tsx";

/**
 * 导入备份 modal：3-4 步流程（CHANGELOG_18 / Step 7）
 * 1. 输入 .dchpack 路径 → 读取预览（presetPackPath 时自动触发）
 * 2. 看冲突 / 改名（每个 profile 的 finalId 用户可覆盖）→ Next
 * 3. **填 K 个 secret**（仅 manifest.secrets_index.entries 非空时） → Restore
 * 4. 看还原报告 + 占位符清单（点击跳转编辑）→ 关闭
 *
 * step 3 跳过条件：旧 dchpack（无 secrets_index） / 新 pack 但 entries 为空 → 直接 step 2 → 4，
 * 走 dchProfile.restoreApply（占位符原样保留，与 fall back 行为一致）。
 *
 * 撞名处理：dry-run 已经算好 default 后缀（claude-pro → claude-pro-restored-TS），
 * 用户可在 input 改 finalId；UI 端做基础格式校验（^[a-zA-Z0-9_-]+$）+ 撞名实时提示。
 *
 * secret 安全：用户填的 realValue 仅在 secretsState 内存里，最后通过 dchProfile
 * .restoreApplyWithSecrets 一次性走 Rust tempfile route（mode 0600 + drop guard），
 * 不写 console / localStorage / 任何旁路 IPC。
 */
export function RestoreBackupModal({
  profiles, presetPackPath, onClose, onToast, onReloadProfile, onRevealPlaceholder,
}: {
  profiles: Profile[];
  /** 预填 packPath（来自 BackupHistoryModal 还原跳转），mount 后自动 preview */
  presetPackPath?: string;
  onClose: () => void;
  onToast: (msg: string, ok: boolean) => void;
  onReloadProfile: (silent?: boolean) => Promise<void>;
  /** 跳转到 profile + configFile 的编辑器；configFile 是相对 configDir 的路径 */
  onRevealPlaceholder?: (profileId: string, configFile: string) => void;
}) {
  const [packPath, setPackPath] = useState(presetPackPath ?? "");
  const [preview, setPreview] = useState<{ manifest: Manifest; plan: ApplyBackupResult } | null>(null);
  const [renameMap, setRenameMap] = useState<Record<string, string>>({});
  /** 来自 manifest.secrets_index.entries；null = 旧 pack / 新 pack 但 entries 为空 → 跳过 step 3 */
  const [secretEntries, setSecretEntries] = useState<SecretLogicalEntry[] | null>(null);
  const [secretsState, setSecretsState] = useState<SecretsState>({ secretsMap: {}, skipMap: {} });
  /** 仅当 hasSecrets 时有意义：rename = step 2，secrets = step 3。无 secrets 时 phase 始终 rename */
  const [phase, setPhase] = useState<"rename" | "secrets">("rename");
  const [result, setResult] = useState<ApplyBackupResult | (ApplyBackupWithSecretsResult & { manifest: Manifest }) | null>(null);
  const [busy, setBusy] = useState(false);

  const hasSecrets = secretEntries !== null && secretEntries.length > 0;

  const onPreview = async () => {
    if (!packPath.trim()) {
      onToast("请输入 .dchpack 文件路径", false);
      return;
    }
    setBusy(true);
    try {
      const r = await dchProfile.restorePreview(packPath.trim());
      setPreview({ manifest: r.manifest, plan: r.plan });
      // 初始化 renameMap：dry-run 的 finalId 作为默认值
      const map: Record<string, string> = {};
      for (const ap of r.plan.appliedProfiles) {
        map[ap.originalId] = ap.finalId;
      }
      setRenameMap(map);
      // 提取 secrets_index entries（直接从 preview 的 manifest 拿，不做第二次 IPC）
      const entries = r.manifest.secrets_index?.entries;
      setSecretEntries(entries && entries.length > 0 ? entries : null);
      // 重置 secretsState（避免重 preview 时残留旧值）
      setSecretsState({ secretsMap: {}, skipMap: {} });
      setPhase("rename");
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), false);
    } finally {
      setBusy(false);
    }
  };

  // mount 时若有 presetPackPath，自动触发 preview（来自 BackupHistoryModal 还原跳转）
  // 用 ref 防 React 19 StrictMode 双 mount 重复 preview。
  const autoPreviewedRef = useRef(false);
  useEffect(() => {
    if (presetPackPath && !autoPreviewedRef.current) {
      autoPreviewedRef.current = true;
      void onPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateName = (originalId: string, newId: string) => {
    setRenameMap((m) => ({ ...m, [originalId]: newId }));
  };

  const renameError = (originalId: string, finalId: string): string | null => {
    if (!finalId) return "id 不能为空";
    if (!/^[a-zA-Z0-9_-]+$/.test(finalId)) return "只允许字母 / 数字 / _ / -";
    // 跟现有 profile 撞名（除了被还原的同名 profile 自身 — 还原是新建非覆盖）
    if (profiles.some((p) => p.id === finalId)) return `撞名（已存在 profile ${finalId}）`;
    // 跟同批其他还原 profile 撞名
    const others = Object.entries(renameMap).filter(([k]) => k !== originalId).map(([, v]) => v);
    if (others.includes(finalId)) return `跟同批另一个还原 profile 重名`;
    return null;
  };

  // step 2 rename 阶段错误：每个 profile 改名校验
  const renameHasError = preview
    ? preview.plan.appliedProfiles.some((ap) => renameError(ap.originalId, renameMap[ap.originalId] ?? "") !== null)
    : false;

  // step 3 secrets 阶段错误：未填且未跳过的 entry
  const secretsButton = hasSecrets ? computeSecretsButton(secretEntries!, secretsState) : { label: "", hasError: false };

  // 当前 step 是否阻塞 Next 按钮
  const hasError = phase === "rename" ? renameHasError : secretsButton.hasError;

  const onApply = async () => {
    if (!preview || hasError) return;

    // phase rename + 有 secrets：仅切到 step 3，不调 IPC
    if (phase === "rename" && hasSecrets) {
      setPhase("secrets");
      return;
    }

    setBusy(true);
    try {
      // phase rename + 无 secrets（旧 pack 或新 pack 但 entries 空）→ 走原 restoreApply
      if (phase === "rename") {
        const r = await dchProfile.restoreApply(packPath.trim(), { renameMap });
        setResult(r);
        if (r.errors.length > 0) {
          onToast(`还原完成但有 ${r.errors.length} 个错误`, false);
        } else {
          onToast(`已还原 ${r.appliedProfiles.length} 个 profile`, true);
        }
      } else {
        // phase secrets：调 restoreApplyWithSecrets。skip 项不入 secretsMap，让 CLI 走 user-skip 语义
        const filledMap: Record<string, string> = {};
        for (const e of secretEntries ?? []) {
          if (secretsState.skipMap[e.name]) continue;
          const v = secretsState.secretsMap[e.name];
          if (v && v.length > 0) filledMap[e.name] = v;
        }
        const r = await dchProfile.restoreApplyWithSecrets(packPath.trim(), {
          renameMap,
          secretsMap: filledMap,
        });
        setResult(r);
        if (r.errors.length > 0) {
          onToast(`还原完成但有 ${r.errors.length} 个错误`, false);
        } else {
          onToast(`已还原 ${r.appliedProfiles.length} 个 profile · 填值 ${r.secretsApplied} 处`, true);
        }
      }
      await onReloadProfile();
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), false);
    } finally {
      setBusy(false);
    }
  };

  // 把 placeholder.hostPath 拆成 (profileId, relativeConfigFile) 给 onRevealPlaceholder
  const computeRevealTarget = (
    ph: PlaceholderEntry,
    appliedById: Record<string, AppliedProfile>,
  ): { profileId: string; configFile: string } | null => {
    // packPath 形如 profiles/<originalId>/configDir/<rel> 或 profiles/<originalId>/_meta.json
    const m = ph.packPath.match(/^profiles\/([^/]+)\/(?:configDir\/(.+)|_meta\.json)$/);
    if (!m) return null;
    const originalId = m[1]!;
    const ap = appliedById[originalId];
    if (!ap) return null;
    if (m[2]) return { profileId: ap.finalId, configFile: m[2] };
    return null; // _meta.json 不在 ConfigPanel 里编辑（要用编辑 store）
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>📥 导入备份</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {!preview ? (
            <>
              <div className="form-row form-row-block">
                <label>.dchpack 文件路径</label>
                <input
                  type="text"
                  value={packPath}
                  onChange={(e) => setPackPath(e.target.value)}
                  placeholder="~/.dch/backups/dch-backup-20260513-143025.dchpack 或 /tmp/x.dchpack"
                  spellCheck={false}
                  disabled={busy}
                />
                <p className="form-hint">
                  支持 <code>~/...</code> / 绝对路径。读取预览不会写文件。
                </p>
              </div>
            </>
          ) : !result ? (
            phase === "rename" ? (
              <RestorePreviewBody
                manifest={preview.manifest}
                plan={preview.plan}
                renameMap={renameMap}
                renameError={renameError}
                onUpdate={updateName}
                busy={busy}
                secretEntries={secretEntries}
              />
            ) : (
              <RestoreSecretsBody
                entries={secretEntries!}
                state={secretsState}
                onChange={setSecretsState}
                busy={busy}
              />
            )
          ) : (
            <RestoreReportBody
              result={result}
              appliedById={Object.fromEntries(result.appliedProfiles.map((a) => [a.originalId, a]))}
              onReveal={onRevealPlaceholder}
              computeRevealTarget={computeRevealTarget}
              secretsMetrics={"secretsApplied" in result ? {
                applied: result.secretsApplied,
                skipped: result.secretsSkipped,
                unknown: result.secretsUnknown,
              } : undefined}
            />
          )}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            {result ? "关闭" : "取消"}
          </button>
          {!preview && (
            <button className="btn primary" onClick={onPreview} disabled={busy || !packPath.trim()}>
              {busy ? "读取中…" : "读取预览"}
            </button>
          )}
          {preview && !result && phase === "secrets" && (
            <button className="btn ghost" onClick={() => setPhase("rename")} disabled={busy}>
              ← 上一步
            </button>
          )}
          {preview && !result && (
            <button className="btn primary" onClick={onApply} disabled={busy || hasError}>
              {busy
                ? "还原中…"
                : phase === "rename"
                  ? hasSecrets
                    ? `下一步：填 ${secretEntries!.length} 个 secret`
                    : "确认还原"
                  : secretsButton.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RestorePreviewBody({
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
          <p className="form-hint" style={{ color: "#c00" }}>
            ⚠️ 此包含明文凭据（来源 --no-placeholder 模式）
          </p>
        </div>
      )}
      {hasSecrets && (
        <div className="form-row form-row-block">
          <div
            style={{
              padding: "8px 12px",
              background: "#dbeafe",
              color: "#1e3a8a",
              borderLeft: "3px solid #3b82f6",
              borderRadius: 2,
            }}
          >
            <p className="form-hint" style={{ margin: 0, color: "#1e3a8a" }}>
              🔑 改名确认后下一步将填写 <strong>{secretEntries!.length}</strong> 个去重 secret（自动 fan-out 到所有 {totalOcc} 处出现位置）
            </p>
            <details open style={{ marginTop: 6 }}>
              <summary className="form-hint" style={{ cursor: "pointer", color: "#1e3a8a" }}>
                清单（{secretEntries!.length} 个 logical key，按字段名排序）
              </summary>
              <div style={{ marginTop: 6, paddingLeft: 12, borderLeft: "2px solid #93c5fd" }}>
                {secretEntries!.map((e) => (
                  <p key={e.name} className="form-hint" style={{ margin: "4px 0", color: "#1e3a8a" }}>
                    <code>{e.name}</code>
                    <span style={{ color: "#475569" }}> · count={e.count} · {e.hint}</span>
                  </p>
                ))}
              </div>
            </details>
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
              style={errMsg ? { borderColor: "#c00" } : undefined}
            />
            {errMsg && <p className="form-hint" style={{ color: "#c00" }}>{errMsg}</p>}
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
          <p className="form-hint" style={{ color: "#c00" }}>错误：</p>
          {plan.errors.map((e, i) => <p key={i} className="form-hint" style={{ color: "#c00" }}>• {e}</p>)}
        </div>
      )}
    </>
  );
}

function RestoreReportBody({
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
          <p className="form-hint" style={{ color: secretsMetrics.applied > 0 ? "#059669" : "#6b7280" }}>
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
          <p className="form-hint" style={{ color: "#c00" }}>错误（{result.errors.length}）：</p>
          {result.errors.map((e, i) => <p key={i} className="form-hint" style={{ color: "#c00" }}>• {e}</p>)}
        </div>
      )}
    </>
  );
}

function SharedActionsList({ items }: { items: SharedAction[] }) {
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

function PlaceholdersList({ items }: { items: PlaceholderEntry[] }) {
  return (
    <details open>
      <summary className="form-hint">点击展开 / 收起</summary>
      {items.map((p, i) => (
        <p key={i} className="form-hint" style={{ marginLeft: 16, marginTop: 4 }}>
          <code>{p.fieldName}</code> — {p.hint}<br />
          <span style={{ color: "#888" }}>{p.hostPath ?? p.packPath}</span>
        </p>
      ))}
    </details>
  );
}

// 类型 helper
type _UnusedToolKind = ToolKind;
