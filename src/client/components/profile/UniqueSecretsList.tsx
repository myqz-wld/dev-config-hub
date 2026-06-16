import React from "react";
import type { SecretLogicalEntry, SecretsIndex } from "../../bridge.ts";
import { CrossFieldBadge } from "./CrossFieldBadge.tsx";

/**
 * 去重后的 unique secret 清单(<details> 包),供 ExportBackupModal 备份完成报告 +
 * RestorePreviewBody step 2 预告 两处共用(原本两处独立维护,字段差一点 → CHANGELOG_20
 * Export 带 ⚡N / Restore 不带,REVIEW_9 D-MED-7)。
 *
 * 抽共用后两处用同一渲染,只通过 props 控制(Export 用 idx 含 total_logical_keys/total_occurrences
 * 字段;Restore 只有 entries[] 自己计算 totalOccurrences)。
 */
export function UniqueSecretsList({
  entries, totalLogicalKeys, totalOccurrences,
  summaryColor, summaryPrefix, footerHint,
}: {
  entries: SecretLogicalEntry[];
  /** 通常 = entries.length;Export 走 SecretsIndex.total_logical_keys 显式传防 entries 与 idx 不一致 */
  totalLogicalKeys?: number;
  /** 通常 = entries.reduce((s,e)=>s+e.count,0);Export 走 SecretsIndex.total_occurrences 显式传 */
  totalOccurrences?: number;
  /** summary 文字色(默认 var(--blue)) */
  summaryColor?: string;
  /** summary 前缀(默认 `🔑 密钥清单`) */
  summaryPrefix?: string;
  /** 列表底部提示行(可选;通常用于 Export 完成报告说明 fan-out) */
  footerHint?: React.ReactNode;
}) {
  const k = totalLogicalKeys ?? entries.length;
  const occ = totalOccurrences ?? entries.reduce((s, e) => s + e.count, 0);
  const color = summaryColor ?? "var(--blue)";
  const prefix = summaryPrefix ?? "🔑 密钥清单";

  return (
    <details open style={{ marginTop: 8 }}>
      <summary className="form-hint" style={{ cursor: "pointer", color }}>
        {prefix}（{k} 个，按名称排序）
      </summary>
      <div style={{ marginTop: 6, paddingLeft: 12, borderLeft: "2px solid rgba(88,166,255,.25)" }}>
        {entries.map((e) => (
          <p key={e.name} className="form-hint" style={{ margin: "4px 0" }}>
            <code>{e.name}</code>
            <span style={{ color: "var(--fg2)" }}> · {e.count} 处使用 · {e.hint}</span>
            <CrossFieldBadge fieldNames={e.fieldNames} size="sm" />
          </p>
        ))}
        {footerHint && (
          <p className="form-hint" style={{ margin: "8px 0 0", color: "var(--fg2)" }}>
            {footerHint}
          </p>
        )}
        {!footerHint && occ > k && (
          <p className="form-hint" style={{ margin: "8px 0 0", color: "var(--fg2)" }}>
            导入时只需填写这 {k} 个值，系统会自动填入所有 {occ} 处使用位置。
          </p>
        )}
      </div>
    </details>
  );
}

/**
 * Export 备份完成报告专用:吃 SecretsIndex 直接渲染。
 */
export function SecretsSummaryList({ idx }: { idx: SecretsIndex }) {
  return (
    <UniqueSecretsList
      entries={idx.entries}
      totalLogicalKeys={idx.total_logical_keys}
      totalOccurrences={idx.total_occurrences}
      footerHint={
        <>
          导入时只需填写这 {idx.total_logical_keys} 个值，系统会自动填入所有 {idx.total_occurrences} 处使用位置。
        </>
      }
    />
  );
}
