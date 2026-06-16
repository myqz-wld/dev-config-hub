import { useState, useEffect, useRef } from "react";
import { dchProfile, type Profile, type Manifest } from "../../bridge.ts";
import { backupCache } from "../../backup-cache.ts";
import { formatBytes } from "../../format-bytes.ts";
import { SecretsSummaryList } from "./UniqueSecretsList.tsx";

/**
 * 导出备份 modal:选 profile / 共享开关 / 明文凭据开关 → 备份。
 *
 * UX:
 * - 默认全选所有 profile
 * - 默认带共享资源(hook 脚本 + ~/.agents)
 * - 明文凭据默认关,开启时显示红色警告
 * - 备份过程中显示 spinner + 阶段提示 + 已耗时 + 预期时间(让用户知道「不是卡死」)
 * - 备份完成后 backupCache.clear(),让「📚 备份历史」拿到最新数据
 *
 * REVIEW_9 D-claude LOW 1: useState lazy init,避免每次 render 重建 Set。
 * REVIEW_9 D-claude LOW 2: elapsed timer 250ms 而非 100ms(3s 备份原本 30 次 re-render →
 * 12 次足够给用户「时间在走」反馈,显著降低 React reconciliation overhead)。
 * REVIEW_9 D-MED-4: formatBytes 抽 ../../format-bytes.ts 共用。
 * REVIEW_9 D-MED-7: SecretsSummaryList 抽 UniqueSecretsList.tsx 共用 + ⚡N 标签走 CrossFieldBadge。
 */
export function ExportBackupModal({
  profiles, presetProfileIds, presetKeep, onClose, onToast,
}: {
  profiles: Profile[];
  /** 单 profile 卡片打开时只预选该 profile;不传 = 全选 */
  presetProfileIds?: string[];
  /** 默认 keep 状态(来自调用上下文,如「备份历史 → 备份」可预设 keep=true) */
  presetKeep?: boolean;
  onClose: () => void;
  onToast: (msg: string, ok: boolean) => void;
}) {
  // REVIEW_9 D-claude LOW 1: lazy init,避免每次 render 重建 Set / iterate profiles
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(presetProfileIds ?? profiles.map((p) => p.id)),
  );
  const [includeShared, setIncludeShared] = useState(true);
  const [noPlaceholder, setNoPlaceholder] = useState(false);
  const [confirmRaw, setConfirmRaw] = useState(false);
  const [keep, setKeep] = useState(!!presetKeep);
  const [busy, setBusy] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<{ outFile: string; bytes: number; manifest: Manifest } | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 备份开始后启动 elapsed 计时器,每 250ms 更新一次(REVIEW_9 D-claude LOW 2:从 100ms 降到 250ms,
  // 3s 备份从 30 次 re-render 降到 12 次,仍给用户「时间在走」反馈)
  useEffect(() => {
    if (busy) {
      const startedAt = Date.now();
      setElapsedMs(0);
      elapsedTimerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startedAt);
      }, 250);
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

  /**
   * **REVIEW_9 D-MED-1 / D-codex M2 + D-claude M1 双方独立**: backdrop / X 在 in-flight 时
   * 应拒绝关闭。R1 D-HIGH-2 fix 只覆盖 RestoreBackupModal,本 modal 同款 vulnerable —
   * 备份过程中点 backdrop / × 触发 onClose 让 React unmount 而 IPC 仍 in-flight,setState
   * on unmounted warn / state 紊乱。同款 attemptClose:busy 中直接 no-op(进度区已显示
   * spinner + 阶段提示让用户知道不能关)。
   */
  const attemptClose = () => {
    if (busy) return;
    onClose();
  };

  /**
   * **REVIEW_9 D-INFO-1 / D-claude I2**: functional setSelected 替代闭包捕获。旧实现直接用
   * `selected` 闭包,React batched render 之间用旧 selected 让连续点击丢中间状态(虽然
   * onChange 不会触发 batched 但仍是反模式 + future risk)。functional update 让 React 总
   * 拿最新 prev state。
   */
  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const onStart = async () => {
    if (selected.size === 0) {
      onToast("请至少选择一个配置方案", false);
      return;
    }
    if (noPlaceholder && !confirmRaw) {
      onToast("请先勾选风险确认，再导出含明文密钥的备份", false);
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
      backupCache.clear(); // 让「📚 备份历史」拿到最新(latest.dchpack 或新历史副本)
      onToast(`已写入 ${r.outFile}`, true);
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={attemptClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>📦 导出备份</h2>
          <button className="modal-close" onClick={attemptClose}>×</button>
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
              <p className="form-hint">✓ 备份完成({formatBytes(result.bytes)})</p>
              <pre className="raw">{result.outFile}</pre>
              <p className="form-hint">
                {keep ? "已保留为历史备份" : "已覆盖默认备份 latest.dchpack"} · 包含 {result.manifest.profiles.length} 个配置方案
                {result.manifest.secrets_index && result.manifest.secrets_index.entries.length > 0
                  ? <> · 🔑 <strong>{result.manifest.secrets_index.total_logical_keys}</strong> 个不同密钥项，来自 {result.manifest.secrets_index.total_occurrences} 处脱敏位置</>
                  : <>，{result.manifest.placeholders.length} 处已脱敏</>}
                。
                <br />
                导入方式：使用 <code>dch profile restore &lt;path&gt;</code>，或回到配置方案页点「📥 导入备份」。
              </p>
              {result.manifest.secrets_index && result.manifest.secrets_index.entries.length > 0 && (
                <SecretsSummaryList idx={result.manifest.secrets_index} />
              )}
            </div>
          ) : (
            <>
              <div className="form-row form-row-block">
                <label>选择配置方案 ({selected.size}/{profiles.length})</label>
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
                      <span className="profile-desc"> {p.tool} · 配置目录 {p.configDir}</span>
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
                  <span>包含 ~/.dch/scripts/* 和 ~/.agents/**（切换脚本可能会用到）</span>
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
                      ? <>保存为 <code>dch-backup-&lt;时间&gt;.dchpack</code>，不会被下次备份覆盖</>
                      : <>写入默认备份 <code>latest.dchpack</code>，下次备份会覆盖它</>}
                  </span>
                </label>
              </div>

              <div className="form-row">
                <label>密钥处理</label>
                <label style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={noPlaceholder}
                    onChange={(e) => { setNoPlaceholder(e.target.checked); setConfirmRaw(false); }}
                    disabled={busy}
                  />
                  <span>保留原始密钥，不做脱敏</span>
                </label>
              </div>

              {noPlaceholder && (
                <div className="form-row form-row-block">
                  <p className="form-hint" style={{ color: "var(--red)", borderLeft: "3px solid var(--red)", paddingLeft: 12 }}>
                    ⚠️ 备份包将包含未脱敏的密钥或令牌。请只通过加密工具、密码管理器或本机保存。
                    <br />
                    不要通过明文邮件、聊天窗口或公开仓库分享。
                  </p>
                  <label style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={confirmRaw}
                      onChange={(e) => setConfirmRaw(e.target.checked)}
                      disabled={busy}
                    />
                    <span>我已了解风险，确认导出含明文密钥的备份包</span>
                  </label>
                </div>
              )}

              <p className="form-hint">
                备份保存在 <code>~/.dch/backups/</code>。完成后可在 Finder 打开。
              </p>
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={attemptClose} disabled={busy}>
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
 * 备份进行中的进度区。后端 createBackup 是一次性 IPC 不分阶段上报,前端按 elapsedMs 估算
 * 文字阶段(粗粒度但有反馈)。让用户知道「不是卡死,正在做事 + 还要多久」。
 *
 * 阶段时间粗估(4 profile 80MB 配置 → gzip -1 ~2-3s 总计;单 profile ~1s):
 *   0-300ms: 扫描 profile 与共享资源
 *   300ms-3s: 脱敏凭据 + 写临时目录
 *   3s+: 压缩归档(gzip -1)
 */
function BackupProgress({ elapsedMs, profileCount, keep }: {
  elapsedMs: number;
  profileCount: number;
  keep: boolean;
}) {
  const stage =
    elapsedMs < 300 ? "收集配置方案和共享资源…" :
    elapsedMs < 3000 ? "脱敏密钥并准备文件…" :
    "压缩备份包…";
  const eta = profileCount === 1 ? "约 1-3 秒" : profileCount <= 2 ? "约 2-5 秒" : "约 3-15 秒";
  const target = keep ? "历史备份 dch-backup-<时间>.dchpack" : "默认备份 latest.dchpack";
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: 16, padding: "32px 16px",
    }}>
      <div className="spinner" />
      <div style={{ fontSize: 16, fontWeight: 500 }}>{stage}</div>
      <div style={{ fontSize: 13, opacity: 0.7, textAlign: "center", lineHeight: 1.6 }}>
        正在备份 {profileCount} 个配置方案和共享资源到 {target}<br />
        预计{eta} · 已耗时 <code>{(elapsedMs / 1000).toFixed(1)}s</code>
      </div>
      <div style={{ fontSize: 12, opacity: 0.5, textAlign: "center" }}>
        请稍候,不要关闭窗口
      </div>
    </div>
  );
}
