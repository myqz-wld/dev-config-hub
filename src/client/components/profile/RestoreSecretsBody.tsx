// CHANGELOG_18 / Step 7：restore 4-step UI 第三步「填 K 个 secret」。
//
// 仅当 manifest.secrets_index 存在且 entries 非空时渲染（caller RestoreBackupModal 控制）。
// 用户填入的 realValue 与 skip 标记由 caller 用 secretsMap / skipMap 持有，本组件纯受控。
//
// 安全约定：
// - input 默认 type=password，eye 图标 toggle 到 type=text
// - secretsMap 内的 realValue **绝不**写到 console / localStorage / 任何 IPC 旁路；只在
//   caller 调 dchProfile.restoreApplyWithSecrets 时一次性走 Rust tempfile route
// - 不渲染任何 redact 后真值的预览（hint 字段是脱敏 fieldName + 出现次数，安全）

import React, { useState } from "react";
import type { SecretLogicalEntry } from "../../bridge.ts";

export interface SecretsState {
  /** logical_key → realValue */
  secretsMap: Record<string, string>;
  /** logical_key → true 表示用户主动跳过（保留占位符） */
  skipMap: Record<string, boolean>;
}

export function RestoreSecretsBody({
  entries, state, onChange, busy,
}: {
  entries: SecretLogicalEntry[];
  state: SecretsState;
  onChange: (next: SecretsState) => void;
  busy: boolean;
}) {
  const total = entries.length;
  const filledCount = entries.filter((e) => !state.skipMap[e.name] && (state.secretsMap[e.name] ?? "").length > 0).length;
  const skippedCount = entries.filter((e) => state.skipMap[e.name]).length;
  const totalOccurrences = entries.reduce((sum, e) => sum + e.count, 0);

  const banner = computeBanner(total, filledCount, skippedCount, totalOccurrences);

  const updateValue = (name: string, value: string) => {
    onChange({ ...state, secretsMap: { ...state.secretsMap, [name]: value } });
  };
  const toggleSkip = (name: string, skip: boolean) => {
    const nextSkip = { ...state.skipMap, [name]: skip };
    // skip 时清空 input value（避免 user 取消 skip 后留旧值）
    const nextMap = { ...state.secretsMap };
    if (skip) delete nextMap[name];
    onChange({ secretsMap: nextMap, skipMap: nextSkip });
  };

  return (
    <>
      <div className="form-row form-row-block">
        <div
          className="form-hint"
          style={{
            padding: "8px 12px",
            borderLeft: `3px solid ${banner.color}`,
            background: banner.bg,
            color: banner.fg,
            borderRadius: 2,
          }}
        >
          {banner.text}
        </div>
      </div>

      <div className="form-section-title">
        填 {total} 个去重 secret（共 {totalOccurrences} 处占位符将被 fan-out）
      </div>

      {entries.map((entry) => (
        <SecretEntryRow
          key={entry.name}
          entry={entry}
          value={state.secretsMap[entry.name] ?? ""}
          skipped={state.skipMap[entry.name] === true}
          onValueChange={(v) => updateValue(entry.name, v)}
          onSkipChange={(s) => toggleSkip(entry.name, s)}
          busy={busy}
        />
      ))}
    </>
  );
}

function SecretEntryRow({
  entry, value, skipped, onValueChange, onSkipChange, busy,
}: {
  entry: SecretLogicalEntry;
  value: string;
  skipped: boolean;
  onValueChange: (v: string) => void;
  onSkipChange: (s: boolean) => void;
  busy: boolean;
}) {
  const [reveal, setReveal] = useState(false);
  const [showAllLocations, setShowAllLocations] = useState(false);

  const empty = !skipped && value.length === 0;
  const previewLocations = showAllLocations ? entry.locations : entry.locations.slice(0, 3);
  const hasMore = entry.locations.length > 3;

  return (
    <div className="form-row form-row-block" style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <code style={{ fontSize: 13 }}>{entry.name}</code>
        <span className="profile-desc">{entry.count} 处 · {entry.hint}</span>
        {entry.fieldNames && entry.fieldNames.length > 1 && (
          <span
            title={`同一 secret 在 ${entry.fieldNames.length} 个不同字段名下出现：${entry.fieldNames.join(" / ")}`}
            style={{
              fontSize: 11,
              padding: "1px 6px",
              borderRadius: 8,
              background: "rgba(227,179,65,.12)",
              color: "var(--yellow)",
              border: "1px solid rgba(227,179,65,.35)",
            }}
          >
            ⚡ 跨 {entry.fieldNames.length} 字段名
          </span>
        )}
      </label>

      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type={reveal ? "text" : "password"}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder={skipped ? "(已跳过 — 占位符保留)" : "粘贴真实凭据"}
          spellCheck={false}
          autoComplete="off"
          disabled={busy || skipped}
          style={{
            flex: 1,
            opacity: skipped ? 0.5 : 1,
            // 不显示 empty 红边：99 entries 全空时整屏全红视觉污染。footer 主按钮 disabled +
            // 灰色「待填」hint 已经表达「未填」状态，不需要红边二次强化（红色是「错误」语义，
            // 但「未填」是「待操作」语义，应该用中性灰）。
          }}
        />
        <button
          type="button"
          className="btn-sm"
          onClick={() => setReveal((r) => !r)}
          disabled={busy || skipped}
          title={reveal ? "隐藏" : "显示明文（注意旁观者）"}
        >
          {reveal ? "🙈" : "👁"}
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={skipped}
            onChange={(e) => onSkipChange(e.target.checked)}
            disabled={busy}
          />
          跳过
        </label>
      </div>

      {empty && (
        <p className="form-hint" style={{ color: "var(--fg2)", marginTop: 4 }}>
          ⏳ 待填（或勾选「跳过」保留占位符）
        </p>
      )}

      <details style={{ marginTop: 4 }}>
        <summary className="form-hint" style={{ cursor: "pointer" }}>
          出现位置（{entry.locations.length}）
        </summary>
        {previewLocations.map((loc, i) => (
          <p key={i} className="form-hint" style={{ marginLeft: 16, marginTop: 2, fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
            {loc.packPath}
            <span style={{ color: "var(--fg3)" }}> · {loc.fieldPath}</span>
          </p>
        ))}
        {hasMore && (
          <p style={{ marginLeft: 16, marginTop: 4 }}>
            <button
              type="button"
              onClick={() => setShowAllLocations((v) => !v)}
              style={{
                fontSize: 11,
                background: "none",
                border: "none",
                color: "var(--blue)",
                cursor: "pointer",
                padding: 0,
              }}
            >
              {showAllLocations
                ? "收起 ▲"
                : `+${entry.locations.length - 3} 处，点击展开全部 ▼`}
            </button>
          </p>
        )}
      </details>
    </div>
  );
}

// ─── derived banner / button helpers ────────────────────────────

interface BannerSpec {
  text: string;
  color: string;
  bg: string;
  fg: string;
}

function computeBanner(total: number, filled: number, skipped: number, totalOccurrences: number): BannerSpec {
  // dark theme 友好色：用 styles.css 的 --yellow/--green/--blue/--fg* token + 半透明 wash
  if (skipped === total) {
    return {
      text: `所有 ${total} 个 secret 都将跳过 — 占位符保留，restore 后请按 README 清单手改`,
      color: "var(--yellow)",
      bg: "rgba(227,179,65,.10)",
      fg: "var(--yellow)",
    };
  }
  if (filled === total) {
    return {
      text: `${total} 个 secret 已就绪 · 还原后将自动 fan-out 到 ${totalOccurrences} 处`,
      color: "var(--green)",
      bg: "rgba(63,185,80,.10)",
      fg: "var(--green)",
    };
  }
  const pending = total - filled - skipped;
  if (pending === 0) {
    // 部分填 + 部分 skip，无 pending
    return {
      text: `已填 ${filled} 个 · 跳过 ${skipped} 个 · 跳过项的占位符将保留`,
      color: "var(--fg2)",
      bg: "var(--bg2)",
      fg: "var(--fg1)",
    };
  }
  // 还有未填未 skip 的
  return {
    text: `已填 ${filled} / ${total} · 还有 ${pending} 个待处理`,
    color: "var(--blue)",
    bg: "rgba(88,166,255,.08)",
    fg: "var(--blue)",
  };
}

/**
 * 还原按钮文案 + disable 判定。caller 决定 disabled 用 hasError，文案用 buttonLabel。
 * 与 banner 保持一致状态分类。
 */
export function computeSecretsButton(entries: SecretLogicalEntry[], state: SecretsState): {
  label: string;
  hasError: boolean;
} {
  const total = entries.length;
  const filled = entries.filter((e) => !state.skipMap[e.name] && (state.secretsMap[e.name] ?? "").length > 0).length;
  const skipped = entries.filter((e) => state.skipMap[e.name]).length;
  const pending = total - filled - skipped;

  if (pending > 0) return { label: `还有 ${pending} 个待处理`, hasError: true };
  if (skipped === total) return { label: "保留占位符还原", hasError: false };
  if (filled === total) return { label: "填值还原", hasError: false };
  return { label: `还原（${filled} 填 / ${skipped} 跳过）`, hasError: false };
}
