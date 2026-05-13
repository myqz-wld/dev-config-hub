import type { BackupSummary } from "./bridge.ts";

/**
 * 模块级单例：备份历史 modal 跨 mount/unmount 持久化 cache。
 *
 * 用途：用户来回开关「📚 备份历史」modal 时不重 spawn dch CLI（cold start ~500ms）+
 * tar exec（每个备份 ~50-100ms 提 manifest）。第一次 fetch 后 cache 保留，后续打开立即
 * 显示 + 后台 silent refresh 拿最新。
 *
 * 失效时机（必须显式 clear）：
 * - 完成 backup（latest.dchpack 更新或新历史副本）
 * - pin / unpin（sidecar 文件变了 + 默认位 pin 复制了新副本）
 * - 删除备份（fs 少了文件）
 * - 用户手动点「🔄 刷新」按钮（用 fresh fetch 强制覆盖）
 *
 * 不失效（cache 仍可用）：
 * - 还原 .dchpack（fs 没动 backup dir）
 * - 切 active profile / 改 profile 元数据
 *
 * 模块级单例 vs Context vs ref：
 * - module-level 最简单（无 React 配合）
 * - HMR 时 cache 可能保留 stale（开发场景，刷新页面解决）
 * - 多 ProfilePanel mount 共享同一份（实际只有 1 个 panel mount）
 */

interface BackupCacheData {
  items: BackupSummary[];
  backupDir: string;
  fetchedAt: number;
}

let _cache: BackupCacheData | null = null;

export const backupCache = {
  get(): BackupCacheData | null {
    return _cache;
  },
  set(items: BackupSummary[], backupDir: string): void {
    _cache = { items, backupDir, fetchedAt: Date.now() };
  },
  clear(): void {
    _cache = null;
  },
};
