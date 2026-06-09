import { useState, useEffect, useCallback, useRef } from "react";
import {
  dchProfile, type BackupSummary,
} from "../../bridge.ts";
import { backupCache } from "../../backup-cache.ts";
import { formatBytes } from "../../format-bytes.ts";

/**
 * 备份历史 Modal：列三组（默认位 / 置顶 / 历史），每组每行支持「还原 / 置顶 / 删除」。
 *
 * Cache 行为：
 * - mount 时若 backupCache 有数据 → 立即显示（即时打开，零延迟）+ 后台 silent refresh 拿最新
 * - 无 cache → 显示 spinner + "读取中…" + 阻塞 UI 等首次 fetch
 * - 任何写操作（pin / rm）→ backupCache.clear() + 重 fetch 同步
 * - 用户点「🔄 刷新」按钮 → 强制 fetch 不走 cache
 *
 * 数据流：
 * 1. mount 时调 dchProfile.backups() 拿列表 + 分组（or cache）
 * 2. 任何写操作（pin / rm）后 clear cache + 重新拉一次列表
 * 3. 点「还原此备份」→ 调 onRestoreFile(path) 给上层 ProfilePanel，关 modal + 打开
 *    RestoreBackupModal 预填 packPath
 *
 * 删除走内联 confirm 而非 window.confirm（Tauri 2 webview 不弹原生 confirm，CHANGELOG_5）。
 *
 * REVIEW_9 D-claude LOW 3: 30s 内的 cache 视为 fresh,跳过 mount 时 silent refresh
 * （避免用户连续开关 modal 时反复 spawn dch CLI + tar exec 浪费 IO）。
 * REVIEW_9 D-MED-4: formatBytes 抽 ../../format-bytes.ts 共用。
 * REVIEW_9 D-MED-5: silent refresh + 同时跑 pin/rm 的 reload race —— 用 reloadIdRef 单调
 * 递增 id 标记每次 reload，response 回到时若 id < latest → 丢弃不写 state/cache。这样并发
 * reload 只有最后一次结果生效，旧 stale 请求不会覆盖新数据。
 */
const CACHE_FRESH_TTL_MS = 30_000;
export function BackupHistoryModal({
  onClose, onToast, onRestoreFile,
}: {
  onClose: () => void;
  onToast: (msg: string, ok: boolean) => void;
  /** 用户点「还原此备份」时调；上层关 modal + 打开 RestoreBackupModal 预填 packPath */
  onRestoreFile: (packPath: string) => void;
}) {
  // 初始 state 直接吃 cache，让 modal 立即显示历史（避免每次开 modal 都看 spinner）
  const cached = backupCache.get();
  const [items, setItems] = useState<BackupSummary[] | null>(cached?.items ?? null);
  const [backupDir, setBackupDir] = useState<string>(cached?.backupDir ?? "");
  // initialLoad: 完全没 cache 时 = true（阻塞渲染显示 spinner）；cache hit 时 = false（已显示 stale，后台 silent refresh）
  const [initialLoad, setInitialLoad] = useState(!cached);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  /** REVIEW_9 D-MED-5: reload 单调递增 id，response 回到时只 commit id === latest 的结果 */
  const reloadIdRef = useRef(0);

  const reload = useCallback(async (silent = false) => {
    const myId = ++reloadIdRef.current;
    if (silent) setRefreshing(true);
    else setBusy(true);
    try {
      const r = await dchProfile.backups();
      // REVIEW_9 D-MED-5: 旧请求 / 新请求并发时只允许最后一次结果落 state + cache
      if (reloadIdRef.current !== myId) return;
      setItems(r.items);
      setBackupDir(r.backupDir);
      backupCache.set(r.items, r.backupDir);
    } catch (e) {
      // 旧请求的 error 也应静默丢弃（用户已发更新请求）
      if (reloadIdRef.current !== myId) return;
      // **REVIEW_9 D-MED-2 / D-claude M3**: silent reload 失败仅 console.warn 不 toast
      // (silent reload 是后台同步,toast 暴露给关闭后的 modal 让用户困惑;非 silent 是用户
      // 显式刷新 / pin / rm 后的 reload,toast 让用户看到失败原因)。
      if (silent) {
        console.warn("BackupHistoryModal silent reload failed:", e);
      } else {
        onToast(e instanceof Error ? e.message : String(e), false);
      }
    } finally {
      // 旧请求不重置 spinner（最后一次 reload 还在跑，不要把 refreshing 误清成 false）
      if (reloadIdRef.current === myId) {
        setBusy(false);
        setRefreshing(false);
        setInitialLoad(false);
      }
    }
  }, [onToast]);

  // Mount 时：cache fresh（30s 内）→ 完全跳过 silent refresh（REVIEW_9 D-claude LOW 3）；
  // cache stale（> 30s 但有数据）→ 后台 silent refresh；cache miss → 阻塞 fetch
  useEffect(() => {
    if (cached && Date.now() - cached.fetchedAt < CACHE_FRESH_TTL_MS) {
      // fresh, 初始 state 已吃 cache，无需 fetch
      return;
    }
    void reload(!!cached);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      backupCache.clear();
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
      backupCache.clear();
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

  /** REVIEW_9 D-claude INFO 2: 父封装 onClose() + onRestoreFile(path) 让 BackupGroup 不需要再传两个 prop */
  const onRestoreCloseAndOpen = useCallback((path: string) => {
    onClose();
    onRestoreFile(path);
  }, [onClose, onRestoreFile]);

  /**
   * **REVIEW_9 D-MED-1 / D-codex M2 + D-claude M1 双方独立**: backdrop / X 在 in-flight 时
   * 应拒绝关闭。R1 D-HIGH-2 fix 只覆盖 RestoreBackupModal,本 modal 同款 vulnerable —
   * pin/rm/reload 中点 backdrop 让 modal unmount,IPC 仍 in-flight setState on unmounted。
   * busy 中拒所有关闭路径(refreshing 不阻挡,silent reload 用户应能关 modal)。
   */
  const attemptClose = () => {
    if (busy) return;
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={attemptClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>📚 备份历史 {refreshing && <span style={{ fontSize: "0.7em", opacity: 0.7, marginLeft: 8 }}>同步中…</span>}</h2>
          <button className="modal-close" onClick={attemptClose}>×</button>
        </div>
        <div className="modal-body">
          <p className="form-hint">
            目录：<code>{backupDir || "~/.dch/backups/"}</code>
            <button
              className="btn-sm"
              onClick={() => { backupCache.clear(); void reload(); }}
              disabled={busy || initialLoad}
              style={{ marginLeft: 12 }}
            >
              {busy || refreshing ? "刷新中…" : "🔄 刷新"}
            </button>
          </p>

          {initialLoad ? (
            <div className="empty" style={{ padding: 32, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <div className="spinner" />
              <span>读取备份列表中…</span>
              <span style={{ fontSize: "0.85em", opacity: 0.7 }}>每个备份需解析 manifest 摘要 (~50-100ms)</span>
            </div>
          ) : !items || items.length === 0 ? (
            <div className="empty">
              无备份。点 <code>📦 导出备份</code> 创建第一个。
            </div>
          ) : (
            <>
              <BackupGroup
                title="📌 默认位（每次 backup 覆盖）"
                hint="这是 dch profile backup 默认写入的位置。每次 backup 都会覆盖，最新一次的内容。"
                items={groups!.default}
                busy={busy || refreshing}
                confirmDel={confirmDel}
                setConfirmDel={setConfirmDel}
                onRestore={onRestoreCloseAndOpen}
                onPin={onPin}
                onDelete={onDelete}
              />
              <BackupGroup
                title="⭐ 置顶（不会被覆盖）"
                hint="置顶的备份不会被下次 backup 覆盖，永久保留直到手动删除。"
                items={groups!.pinned}
                busy={busy || refreshing}
                confirmDel={confirmDel}
                setConfirmDel={setConfirmDel}
                onRestore={onRestoreCloseAndOpen}
                onPin={onPin}
                onDelete={onDelete}
              />
              <BackupGroup
                title="📜 历史（--keep 创建）"
                hint="勾选「保留为历史」的备份。可以「置顶」永久保留，或删除清理空间。"
                items={groups!.history}
                busy={busy || refreshing}
                confirmDel={confirmDel}
                setConfirmDel={setConfirmDel}
                onRestore={onRestoreCloseAndOpen}
                onPin={onPin}
                onDelete={onDelete}
              />
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn primary" onClick={attemptClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

function BackupGroup({
  title, hint, items, busy, confirmDel, setConfirmDel,
  onRestore, onPin, onDelete,
}: {
  title: string;
  hint: string;
  items: BackupSummary[];
  busy: boolean;
  confirmDel: string | null;
  setConfirmDel: (p: string | null) => void;
  /** REVIEW_9 D-claude INFO 2: 父封装 onRestoreCloseAndOpen — onClose() + onRestoreFile(path) 一起 */
  onRestore: (path: string) => void;
  onPin: (path: string, pin: boolean) => Promise<void>;
  onDelete: (path: string) => Promise<void>;
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
          onRestore={() => onRestore(x.path)}
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
