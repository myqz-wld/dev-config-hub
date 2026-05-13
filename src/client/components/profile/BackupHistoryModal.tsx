import React, { useState, useEffect, useCallback } from "react";
import {
  dchProfile, type BackupSummary,
} from "../../bridge.ts";

/**
 * 备份历史 Modal：列三组（默认位 / 置顶 / 历史），每组每行支持「还原 / 置顶 / 删除」。
 *
 * 数据流：
 * 1. mount 时调 dchProfile.backups() 拿列表 + 分组
 * 2. 任何写操作（pin / rm）后重新拉一次列表（保持显示一致）
 * 3. 点「还原此备份」→ 调 onRestoreFile(path) 给上层 ProfilePanel，关 modal + 打开
 *    RestoreBackupModal 预填 packPath
 *
 * 删除走内联 confirm 而非 window.confirm（Tauri 2 webview 不弹原生 confirm，CHANGELOG_5）。
 */
export function BackupHistoryModal({
  onClose, onToast, onRestoreFile,
}: {
  onClose: () => void;
  onToast: (msg: string, ok: boolean) => void;
  /** 用户点「还原此备份」时调；上层关 modal + 打开 RestoreBackupModal 预填 packPath */
  onRestoreFile: (packPath: string) => void;
}) {
  const [items, setItems] = useState<BackupSummary[] | null>(null);
  const [backupDir, setBackupDir] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const r = await dchProfile.backups();
      setItems(r.items);
      setBackupDir(r.backupDir);
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), false);
    } finally {
      setBusy(false);
    }
  }, [onToast]);

  useEffect(() => { void reload(); }, [reload]);

  const onPin = async (path: string, pin: boolean) => {
    setBusy(true);
    try {
      const r = await dchProfile.backupPin(path, pin);
      onToast(
        pin
          ? r.copiedFromLatest
            ? `已置顶（默认位 → 复制副本）`
            : `已置顶`
          : `已取消置顶`,
        true,
      );
      await reload();
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), false);
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (path: string) => {
    setBusy(true);
    try {
      await dchProfile.backupRm(path);
      onToast(`已删除`, true);
      setConfirmDel(null);
      await reload();
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), false);
    } finally {
      setBusy(false);
    }
  };

  const groups = items
    ? {
        default: items.filter((x) => x.category === "default"),
        pinned: items.filter((x) => x.category === "pinned"),
        history: items.filter((x) => x.category === "history"),
      }
    : null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>📚 备份历史</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p className="form-hint">
            目录：<code>{backupDir || "~/.dch/backups/"}</code>
            <button
              className="btn-sm"
              onClick={() => void reload()}
              disabled={busy}
              style={{ marginLeft: 12 }}
            >
              {busy ? "刷新中…" : "🔄 刷新"}
            </button>
          </p>

          {!items ? (
            <div className="empty">读取中…</div>
          ) : items.length === 0 ? (
            <div className="empty">
              无备份。点 <code>📦 导出备份</code> 创建第一个。
            </div>
          ) : (
            <>
              <BackupGroup
                title="📌 默认位（每次 backup 覆盖）"
                hint="这是 dch profile backup 默认写入的位置。每次 backup 都会覆盖，最新一次的内容。"
                items={groups!.default}
                busy={busy}
                confirmDel={confirmDel}
                setConfirmDel={setConfirmDel}
                onRestoreFile={onRestoreFile}
                onPin={onPin}
                onDelete={onDelete}
                onClose={onClose}
              />
              <BackupGroup
                title="⭐ 置顶（不会被覆盖）"
                hint="置顶的备份不会被下次 backup 覆盖，永久保留直到手动删除。"
                items={groups!.pinned}
                busy={busy}
                confirmDel={confirmDel}
                setConfirmDel={setConfirmDel}
                onRestoreFile={onRestoreFile}
                onPin={onPin}
                onDelete={onDelete}
                onClose={onClose}
              />
              <BackupGroup
                title="📜 历史（--keep 创建）"
                hint="勾选「保留为历史」的备份。可以「置顶」永久保留，或删除清理空间。"
                items={groups!.history}
                busy={busy}
                confirmDel={confirmDel}
                setConfirmDel={setConfirmDel}
                onRestoreFile={onRestoreFile}
                onPin={onPin}
                onDelete={onDelete}
                onClose={onClose}
              />
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn primary" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

function BackupGroup({
  title, hint, items, busy, confirmDel, setConfirmDel,
  onRestoreFile, onPin, onDelete, onClose,
}: {
  title: string;
  hint: string;
  items: BackupSummary[];
  busy: boolean;
  confirmDel: string | null;
  setConfirmDel: (p: string | null) => void;
  onRestoreFile: (path: string) => void;
  onPin: (path: string, pin: boolean) => Promise<void>;
  onDelete: (path: string) => Promise<void>;
  onClose: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="form-row form-row-block">
      <div className="form-section-title">{title} <span style={{ opacity: 0.6 }}>({items.length})</span></div>
      <p className="form-hint">{hint}</p>
      {items.map((x) => (
        <BackupRow
          key={x.path}
          item={x}
          busy={busy}
          confirming={confirmDel === x.path}
          onConfirmDel={() => setConfirmDel(x.path)}
          onCancelDel={() => setConfirmDel(null)}
          onRestore={() => { onClose(); onRestoreFile(x.path); }}
          onPin={() => void onPin(x.path, !x.pinned)}
          onDelete={() => void onDelete(x.path)}
        />
      ))}
    </div>
  );
}

function BackupRow({
  item, busy, confirming,
  onConfirmDel, onCancelDel, onRestore, onPin, onDelete,
}: {
  item: BackupSummary;
  busy: boolean;
  confirming: boolean;
  onConfirmDel: () => void;
  onCancelDel: () => void;
  onRestore: () => void;
  onPin: () => void;
  onDelete: () => void;
}) {
  const m = item.manifest;
  const ts = new Date(item.mtimeMs).toLocaleString();
  return (
    <div className="profile-card" style={{ marginTop: 8 }}>
      <div className="profile-card-head">
        <div className="profile-card-id">
          <code>{item.filename}</code>
          {item.pinned && <span className="badge env" style={{ marginLeft: 6 }}>📌 置顶</span>}
          {item.category === "default" && <span className="badge default" style={{ marginLeft: 6 }}>默认位</span>}
          {m?.noPlaceholder && <span className="badge env" style={{ marginLeft: 6, color: "#c00" }}>明文凭据</span>}
        </div>
        <div className="profile-card-meta">
          <span className="profile-desc">{formatBytes(item.bytes)} · {ts}</span>
        </div>
      </div>
      <div className="profile-card-body">
        {m ? (
          <>
            <div className="profile-row">
              <span className="profile-row-label">profile</span>
              <span>{m.profileCount} 个：{m.profileIds.join(", ") || "—"}</span>
            </div>
            <div className="profile-row">
              <span className="profile-row-label">占位符</span>
              <span>{m.placeholderCount} 处脱敏</span>
            </div>
            <div className="profile-row">
              <span className="profile-row-label">来源</span>
              <span>{m.sourceUser}@{m.sourceHost} · DCH v{m.dchVersion}</span>
            </div>
          </>
        ) : (
          <div className="profile-row" style={{ color: "#c00" }}>
            ⚠ manifest 解析失败：{item.manifestError ?? "未知"}
          </div>
        )}
        <div className="profile-row">
          <span className="profile-row-label">路径</span>
          <code style={{ fontSize: "0.85em" }}>{item.path}</code>
        </div>
      </div>
      <div className="profile-card-actions">
        <button className="btn primary" disabled={busy || !m} onClick={onRestore}>
          📥 还原此备份
        </button>
        <button className="btn-sm" disabled={busy} onClick={onPin}>
          {item.pinned ? "取消置顶" : item.category === "default" ? "📌 置顶（复制副本）" : "📌 置顶"}
        </button>
        <div className="profile-card-actions-spacer" />
        {!confirming ? (
          <button className="btn-sm danger" disabled={busy} onClick={onConfirmDel}>
            删除
          </button>
        ) : (
          <>
            <span className="profile-confirm-hint">确认删除？此操作不可撤销</span>
            <button className="btn-sm" disabled={busy} onClick={onCancelDel}>
              取消
            </button>
            <button className="btn-sm danger danger-solid" disabled={busy} onClick={onDelete}>
              确认删除
            </button>
          </>
        )}
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
