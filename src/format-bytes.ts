// 字节数 → 可读字符串(B / KB / MB / GB)。
//
// **REVIEW_9 D-LOW-3 / D-claude L1**: 项目根中立位置,client (ExportBackupModal /
// BackupHistoryModal / RestoreBackupModal) + CLI (cli-shared.ts) 都 import from 此处。
// 旧实现两份完全重复定义(client/format-bytes.ts + cli-shared.ts:237)分别维护,后续公式
// 微调(如改 1024 → 1000 / 加 TB 档)需同步两处易遗漏。
//
// 纯函数无 React 依赖,放项目根级 src/ 让 cli + client bundle 都安全引用(client 端
// re-export 保持原 caller import 路径不变)。
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
}
