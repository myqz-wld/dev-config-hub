import React, { useState, useEffect, useRef } from "react";
import { dchProfile, type Profile, type Manifest, type SecretsIndex } from "../../bridge.ts";
import { backupCache } from "../../backup-cache.ts";

/**
 * 导出备份 modal：选 profile / 共享开关 / 明文凭据开关 → 备份。
 *
 * UX：
 * - 默认全选所有 profile
 * - 默认带共享资源（hook 脚本 + ~/.agents）
 * - 明文凭据默认关，开启时显示红色警告
 * - 备份过程中显示 spinner + 阶段提示 + 已耗时 + 预期时间（让用户知道「不是卡死」）
 * - 备份完成后 backupCache.clear()，让「📚 备份历史」拿到最新数据
 */
export function ExportBackupModal({
  profiles, presetProfileIds, presetKeep, onClose, onToast,
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
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<{ outFile: string; bytes: number; manifest: Manifest } | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 备份开始后启动 elapsed 计时器，每 100ms 更新一次（让用户看到时间在走）
  useEffect(() => {
    if (busy) {
      const startedAt = Date.now();
      setElapsedMs(0);
      elapsedTimerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startedAt);
      }, 100);
    } else if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
    return () => {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    };
  }, [busy]);

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
      backupCache.clear(); // 让「📚 备份历史」拿到最新（latest.dchpack 或新历史副本）
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
          {busy ? (
            <BackupProgress
              elapsedMs={elapsedMs}
              profileCount={selected.size}
              keep={keep}
            />
          ) : result ? (
            <div className="form-row form-row-block">
              <p className="form-hint">✓ 备份完成（{formatBytes(result.bytes)}）</p>
              <pre className="raw">{result.outFile}</pre>
              <p className="form-hint">
                {keep ? "已保留为历史副本" : "已覆盖默认位 latest.dchpack"} · 包含 {result.manifest.profiles.length} 个 profile
                {result.manifest.secrets_index && result.manifest.secrets_index.entries.length > 0
                  ? <> · 🔑 <strong>{result.manifest.secrets_index.total_logical_keys}</strong> 个 unique secret（合并自 {result.manifest.secrets_index.total_occurrences} 处占位符）</>
                  : <>，{result.manifest.placeholders.length} 处脱敏</>}
                。
                <br />
                还原方式：CLI 跑 <code>dch profile restore &lt;path&gt;</code>，或 ProfilePanel → 📥 导入备份。
              </p>
              {result.manifest.secrets_index && result.manifest.secrets_index.entries.length > 0 && (
                <SecretsSummaryList idx={result.manifest.secrets_index} />
              )}
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
                  <p className="form-hint" style={{ color: "var(--red)", borderLeft: "3px solid var(--red)", paddingLeft: 12 }}>
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
            {result ? "关闭" : busy ? "备份中…" : "取消"}
          </button>
          {!result && (
            <button
              className="btn primary"
              onClick={onStart}
              disabled={busy || selected.size === 0 || (noPlaceholder && !confirmRaw)}
            >
              {busy
                ? <><span className="spinner-inline" /> 备份中… {(elapsedMs / 1000).toFixed(1)}s</>
                : "开始备份"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 备份进行中的进度区。后端 createBackup 是一次性 IPC 不分阶段上报，前端按 elapsedMs 估算
 * 文字阶段（粗粒度但有反馈）。让用户知道「不是卡死，正在做事 + 还要多久」。
 *
 * 阶段时间粗估（4 profile 80MB 配置 → gzip -1 ~2-3s 总计；单 profile ~1s）：
 *   0-300ms: 扫描 profile 与共享资源
 *   300ms-3s: 脱敏凭据 + 写临时目录
 *   3s+: 压缩归档（gzip -1）
 */
function BackupProgress({ elapsedMs, profileCount, keep }: {
  elapsedMs: number;
  profileCount: number;
  keep: boolean;
}) {
  const stage =
    elapsedMs < 300 ? "扫描 profile 与共享资源…" :
    elapsedMs < 3000 ? "脱敏凭据 + 写临时目录…" :
    "压缩归档（gzip -1）…";
  const eta = profileCount === 1 ? "约 1-3 秒" : profileCount <= 2 ? "约 2-5 秒" : "约 3-15 秒";
  const target = keep ? "历史副本 dch-backup-<TS>.dchpack" : "默认位 latest.dchpack";
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: 16, padding: "32px 16px",
    }}>
      <div className="spinner" />
      <div style={{ fontSize: 16, fontWeight: 500 }}>{stage}</div>
      <div style={{ fontSize: 13, opacity: 0.7, textAlign: "center", lineHeight: 1.6 }}>
        正在备份 {profileCount} 个 profile + 共享资源到{target}<br />
        预计{eta} · 已耗时 <code>{(elapsedMs / 1000).toFixed(1)}s</code>
      </div>
      <div style={{ fontSize: 12, opacity: 0.5, textAlign: "center" }}>
        请稍候，不要关闭窗口
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

/**
 * 备份完展示去重后的 unique secret 清单（CHANGELOG_19）。让用户立刻知道
 * 还原时只需填 K 次（而不是 placeholders.length 次），且每个 logical key
 * 是哪个字段、聚合了多少处、跨几个 profile。
 *
 * CHANGELOG_20: cross-fieldName dedup 后,多 fieldName entry 加「跨 N 字段名」标签。
 */
function SecretsSummaryList({ idx }: { idx: SecretsIndex }) {
  return (
    <details open style={{ marginTop: 8 }}>
      <summary className="form-hint" style={{ cursor: "pointer", color: "var(--blue)" }}>
        🔑 unique secret 清单（{idx.total_logical_keys} 个，按字段名排序）
      </summary>
      <div style={{ marginTop: 6, paddingLeft: 12, borderLeft: "2px solid rgba(88,166,255,.25)" }}>
        {idx.entries.map((e) => (
          <p key={e.name} className="form-hint" style={{ margin: "4px 0" }}>
            <code>{e.name}</code>
            <span style={{ color: "var(--fg2)" }}> · count={e.count} · {e.hint}</span>
            {e.fieldNames && e.fieldNames.length > 1 && (
              <span
                title={`同一 secret 在 ${e.fieldNames.length} 个不同字段名下出现：${e.fieldNames.join(" / ")}`}
                style={{
                  marginLeft: 6,
                  fontSize: 10,
                  padding: "0 5px",
                  borderRadius: 8,
                  background: "rgba(227,179,65,.12)",
                  color: "var(--yellow)",
                  border: "1px solid rgba(227,179,65,.35)",
                }}
              >
                ⚡{e.fieldNames.length}
              </span>
            )}
          </p>
        ))}
        <p className="form-hint" style={{ margin: "8px 0 0", color: "var(--fg2)" }}>
          还原时只需填这 {idx.total_logical_keys} 个值（自动 fan-out 到所有 {idx.total_occurrences} 处出现位置）。
        </p>
      </div>
    </details>
  );
}
