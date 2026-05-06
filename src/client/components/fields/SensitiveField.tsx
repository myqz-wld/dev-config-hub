import React, { useState, useEffect } from "react";
import type { FieldProps } from "./types.ts";
import { FieldRow } from "./FieldRow.tsx";

/**
 * 敏感字段：mask + reveal 按钮 + 写非 .local 文件时 banner 警告。
 *
 * 显示策略：
 *   - 默认 mask：前 4 + `•••` + 后 4
 *   - 点 reveal 按钮切 type="text"，5 秒后自动复原（防止离开屏幕忘关）
 *   - scopeContext.level !== "local" 时顶部 banner 警告（敏感值不该写到 user / global / project 共享文件）
 */
export function SensitiveField({ schema, value, onChange, path, errors, scopeContext, disabled }: FieldProps<string>) {
  const [draft, setDraft] = useState<string>(value ?? "");
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  // reveal 5 秒后自动复原
  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setRevealed(false), 5000);
    return () => clearTimeout(t);
  }, [revealed]);

  const commit = () => {
    if (draft === "") {
      onChange(undefined);
      return;
    }
    if (draft !== value) onChange(draft);
  };

  const showWarning = scopeContext && scopeContext.level !== "local";

  return (
    <FieldRow schema={schema} path={path} errors={errors}>
      {showWarning && (
        <div className="field-warn">
          ⚠️ 敏感值写到 <code>{scopeContext.level}</code> 文件可能被共享 / 入版控；建议用 settings.local.json 或环境变量
        </div>
      )}
      <div className="field-sensitive">
        <input
          type={revealed ? "text" : "password"}
          className="field-input"
          value={revealed ? draft : (value ? maskValue(draft) : "")}
          disabled={disabled || !revealed}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          placeholder={schema.default != null ? "（已设默认）" : ""}
        />
        <button
          type="button"
          className="field-sensitive-toggle"
          disabled={disabled}
          onClick={() => setRevealed(!revealed)}
          title={revealed ? "隐藏（5s 后自动）" : "显示"}
        >
          {revealed ? "🙈" : "👁️"}
        </button>
      </div>
    </FieldRow>
  );
}

function maskValue(v: string): string {
  if (v.length <= 8) return "•".repeat(v.length);
  return v.slice(0, 4) + "•••" + v.slice(-4);
}
