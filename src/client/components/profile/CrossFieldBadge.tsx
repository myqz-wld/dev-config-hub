import React from "react";

/**
 * 「⚡N 字段名」标签 — secret 跨多个 fieldName 出现时的标识(CHANGELOG_20)。
 *
 * REVIEW_9 D-MED-7 (D-claude MED 4): secret 清单 UI 跨 modal 不一致 —
 * Export 带 ⚡N / RestorePreviewBody 不带 / SecretEntryRow 又带。抽共用组件让三处
 * 渲染一致(避免一处改 style 另两处忘改)。
 *
 * caller:
 * - ExportBackupModal SecretsSummaryList → size="sm"
 * - RestoreSecretsBody SecretEntryRow → size="md"
 * - RestoreBackupModal RestorePreviewBody UniqueSecretsList → size="md"(原本不带,补上)
 */
export function CrossFieldBadge({
  fieldNames, size = "md",
}: {
  /** 同一 secret 出现的所有 fieldName(>= 2 才渲染,1 个 / 空 → null) */
  fieldNames: string[] | undefined;
  /** sm = compact `⚡N`(ExportBackupModal 列表场景);md = `⚡ 跨 N 字段名`(SecretEntryRow 详情场景) */
  size?: "sm" | "md";
}) {
  if (!fieldNames || fieldNames.length <= 1) return null;
  const sm = size === "sm";
  return (
    <span
      title={`同一 secret 在 ${fieldNames.length} 个不同字段名下出现:${fieldNames.join(" / ")}`}
      style={{
        marginLeft: sm ? 6 : 0,
        fontSize: sm ? 10 : 11,
        padding: sm ? "0 5px" : "1px 6px",
        borderRadius: 8,
        background: "rgba(227,179,65,.12)",
        color: "var(--yellow)",
        border: "1px solid rgba(227,179,65,.35)",
      }}
    >
      {sm ? `⚡${fieldNames.length}` : `⚡ 跨 ${fieldNames.length} 字段名`}
    </span>
  );
}
