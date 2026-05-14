// 字节数 → 可读字符串(B / KB / MB / GB)。client 端三处共用(ExportBackupModal /
// BackupHistoryModal / 未来扩展),避免每个 modal 自己一份。
//
// REVIEW_9 D-MED-4 (D-claude MED 2 + D-codex LOW 3 双方独立): formatBytes 完全重复定义抽出。
//
// **不**与 cli-shared.ts:formatBytes 合并 — client 是 React webview,cli 是 bun CLI,职责切割
// 避免 cli-shared 误带 React 依赖到 cli bundle。
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
}
