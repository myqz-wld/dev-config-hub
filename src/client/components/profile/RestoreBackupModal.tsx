import React, { useState, useEffect, useRef } from "react";
import {
  dchProfile, type Profile, type Manifest, type AppliedProfile,
  type ApplyBackupResult, type SharedAction, type PlaceholderEntry,
  type ToolKind,
} from "../../bridge.ts";

/**
 * 导入备份 modal：3 步流程
 * 1. 输入 .dchpack 路径 → 读取预览（presetPackPath 时自动触发）
 * 2. 看冲突 / 改名（每个 profile 的 finalId 用户可覆盖）→ 确认还原
 * 3. 看还原报告 + 占位符清单（点击跳转编辑）→ 关闭
 *
 * 撞名处理：dry-run 已经算好 default 后缀（claude-pro → claude-pro-restored-TS），
 * 用户可在 input 改 finalId；UI 端做基础格式校验（^[a-zA-Z0-9_-]+$）+ 撞名实时提示。
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
  const [result, setResult] = useState<ApplyBackupResult | null>(null);
  const [busy, setBusy] = useState(false);

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

  const hasError = preview
    ? preview.plan.appliedProfiles.some((ap) => renameError(ap.originalId, renameMap[ap.originalId] ?? "") !== null)
    : false;

  const onApply = async () => {
    if (!preview || hasError) return;
    setBusy(true);
    try {
      // 把 renameMap 里只跟 dry-run 默认不一样的传给 CLI（其他用 dry-run 的 default suffix）
      // 实际上传整个 map 也 OK，CLI 会按 renameMap 优先
      const r = await dchProfile.restoreApply(packPath.trim(), { renameMap });
      setResult(r);
      if (r.errors.length > 0) {
        onToast(`还原完成但有 ${r.errors.length} 个错误`, false);
      } else {
        onToast(`已还原 ${r.appliedProfiles.length} 个 profile`, true);
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
            <RestorePreviewBody
              manifest={preview.manifest}
              plan={preview.plan}
              renameMap={renameMap}
              renameError={renameError}
              onUpdate={updateName}
              busy={busy}
            />
          ) : (
            <RestoreReportBody
              result={result}
              appliedById={Object.fromEntries(result.appliedProfiles.map((a) => [a.originalId, a]))}
              onReveal={onRevealPlaceholder}
              computeRevealTarget={computeRevealTarget}
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
          {preview && !result && (
            <button className="btn primary" onClick={onApply} disabled={busy || hasError}>
              {busy ? "还原中…" : "确认还原"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RestorePreviewBody({
  manifest, plan, renameMap, renameError, onUpdate, busy,
}: {
  manifest: Manifest;
  plan: ApplyBackupResult;
  renameMap: Record<string, string>;
  renameError: (originalId: string, finalId: string) => string | null;
  onUpdate: (originalId: string, newId: string) => void;
  busy: boolean;
}) {
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
  result, appliedById, onReveal, computeRevealTarget,
}: {
  result: ApplyBackupResult;
  appliedById: Record<string, AppliedProfile>;
  onReveal?: (profileId: string, configFile: string) => void;
  computeRevealTarget: (
    ph: PlaceholderEntry,
    appliedById: Record<string, AppliedProfile>,
  ) => { profileId: string; configFile: string } | null;
}) {
  return (
    <>
      <div className="form-row form-row-block">
        <p className="form-hint">✓ 已还原 {result.appliedProfiles.length} 个 profile（共享资源 {result.sharedActions.length} 项）。</p>
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
