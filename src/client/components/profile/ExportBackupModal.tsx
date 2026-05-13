import React, { useState } from "react";
import { dchProfile, type Profile, type Manifest } from "../../bridge.ts";

/**
 * 导出备份 modal：选 profile / 共享开关 / 明文凭据开关 → 备份。
 *
 * UX：
 * - 默认全选所有 profile
 * - 默认带共享资源（hook 脚本 + ~/.agents）
 * - 明文凭据默认关，开启时显示红色警告
 * - 备份完成显示路径 + 占位符数量；用户可关 modal
 */
export function ExportBackupModal({
  profiles, presetProfileIds, onClose, onToast,
}: {
  profiles: Profile[];
  /** 单 profile 卡片打开时只预选该 profile；不传 = 全选 */
  presetProfileIds?: string[];
  /** 默认 keep 状态（来自调用上下文，如「备份历史 → 备份」可预设 keep=true） */
  presetKeep?: boolean;
  onClose: () => void;
  onToast: (msg: string, ok: boolean) => void;
}) {
  const initial = new Set(presetProfileIds ?? profiles.map((p) => p.id));
  const [selected, setSelected] = useState<Set<string>>(initial);
  const [includeShared, setIncludeShared] = useState(true);
  const [noPlaceholder, setNoPlaceholder] = useState(false);
  const [confirmRaw, setConfirmRaw] = useState(false);
  const [keep, setKeep] = useState(!!presetKeep);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ outFile: string; bytes: number; manifest: Manifest } | null>(null);

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const onStart = async () => {
    if (selected.size === 0) {
      onToast("请至少选一个 profile", false);
      return;
    }
    if (noPlaceholder && !confirmRaw) {
      onToast("请勾选下方明确同意框确认明文凭据", false);
      return;
    }
    setBusy(true);
    try {
      const r = await dchProfile.backup({
        profileIds: Array.from(selected),
        noShared: !includeShared,
        noPlaceholder,
        keep,
        yes: true,
      });
      setResult(r);
      onToast(`已写入 ${r.outFile}`, true);
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>📦 导出备份</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {result ? (
            <div className="form-row form-row-block">
              <p className="form-hint">✓ 备份完成（{formatBytes(result.bytes)}）</p>
              <pre className="raw">{result.outFile}</pre>
              <p className="form-hint">
                {keep ? "已保留为历史副本" : "已覆盖默认位 latest.dchpack"} · 包含 {result.manifest.profiles.length} 个 profile，{result.manifest.placeholders.length} 处脱敏。
                <br />
                还原方式：CLI 跑 <code>dch profile restore &lt;path&gt;</code>，或 ProfilePanel → 📥 导入备份。
              </p>
            </div>
          ) : (
            <>
              <div className="form-row form-row-block">
                <label>选择 profile（{selected.size}/{profiles.length}）</label>
                <div className="form-env-block">
                  {profiles.map((p) => (
                    <label key={p.id} className="form-env-item" style={{ cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggle(p.id)}
                        disabled={busy}
                      />
                      <code>{p.id}</code>
                      <span className="profile-desc"> {p.tool} · {p.configDir}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="form-row">
                <label>包含共享资源</label>
                <label style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={includeShared}
                    onChange={(e) => setIncludeShared(e.target.checked)}
                    disabled={busy}
                  />
                  <span>~/.dch/scripts/* + ~/.agents/**（hook 引用必需）</span>
                </label>
              </div>

              <div className="form-row">
                <label>保留为历史</label>
                <label style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={keep}
                    onChange={(e) => setKeep(e.target.checked)}
                    disabled={busy}
                  />
                  <span>
                    {keep
                      ? <>勾选后 → <code>dch-backup-&lt;TS&gt;.dchpack</code>（不会被下次 backup 覆盖）</>
                      : <>不勾 → 覆盖默认位 <code>latest.dchpack</code>（下次 backup 也覆盖）</>}
                  </span>
                </label>
              </div>

              <div className="form-row">
                <label>明文凭据</label>
                <label style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={noPlaceholder}
                    onChange={(e) => { setNoPlaceholder(e.target.checked); setConfirmRaw(false); }}
                    disabled={busy}
                  />
                  <span>--no-placeholder（保留原始 token / API key）</span>
                </label>
              </div>

              {noPlaceholder && (
                <div className="form-row form-row-block">
                  <p className="form-hint" style={{ color: "#c00", borderLeft: "3px solid #c00", paddingLeft: 12 }}>
                    ⚠️ 备份包将含明文 token / API key。请只通过加密渠道（gpg / age / 1Password / 本地）使用。
                    <br />
                    通过明文邮件 / 公开 git repo 分享 = 凭据泄露。
                  </p>
                  <label style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={confirmRaw}
                      onChange={(e) => setConfirmRaw(e.target.checked)}
                      disabled={busy}
                    />
                    <span>我已了解风险，确认导出含明文凭据的备份包</span>
                  </label>
                </div>
              )}

              <p className="form-hint">
                输出位置：默认 <code>~/.dch/backups/dch-backup-&lt;TS&gt;.dchpack</code>。
                完成后可在 Finder 打开。
              </p>
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            {result ? "关闭" : "取消"}
          </button>
          {!result && (
            <button
              className="btn primary"
              onClick={onStart}
              disabled={busy || selected.size === 0 || (noPlaceholder && !confirmRaw)}
            >
              {busy ? "备份中…" : "开始备份"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
}
