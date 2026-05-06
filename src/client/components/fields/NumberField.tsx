import React, { useState, useEffect } from "react";
import type { FieldProps } from "./types.ts";
import { FieldRow } from "./FieldRow.tsx";

/**
 * 数值控件：number / integer / duration 共用。
 *
 * 行为：
 *   - onBlur 提交（避免每次 keystroke 都 patch）；非法值 onBlur 弹回上一个有效值 + 红框
 *   - integer：step 默认 1 + 校验 Number.isInteger
 *   - duration：value 内部统一 ms（schema.unit = "ms" / "s" / "min" / "hour" 仅 UI 显示）
 *   - schema.min / max / step 直接传给 input
 *   - 单位后缀显示在右侧（schema.unit）
 */
export function NumberField({ schema, value, onChange, path, errors, disabled }: FieldProps<number>) {
  const [draft, setDraft] = useState<string>(value != null ? String(value) : "");
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setDraft(value != null ? String(value) : "");
    setInvalid(false);
  }, [value]);

  const isInteger = schema.type === "integer";
  const step = schema.step ?? (isInteger ? 1 : "any");

  const commit = () => {
    if (draft === "") {
      onChange(undefined);
      setInvalid(false);
      return;
    }
    const n = Number(draft);
    if (
      !Number.isFinite(n) ||
      (isInteger && !Number.isInteger(n)) ||
      (schema.min != null && n < schema.min) ||
      (schema.max != null && n > schema.max)
    ) {
      setInvalid(true);
      setDraft(value != null ? String(value) : "");  // 弹回有效值
      return;
    }
    setInvalid(false);
    if (n !== value) onChange(n);
  };

  return (
    <FieldRow schema={schema} path={path} errors={errors}>
      <div className={`field-number${invalid ? " invalid" : ""}`}>
        <input
          type="number"
          value={draft}
          min={schema.min}
          max={schema.max}
          step={step}
          disabled={disabled}
          placeholder={schema.default != null ? String(schema.default) : ""}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        />
        {schema.unit && <span className="field-unit">{schema.unit}</span>}
      </div>
    </FieldRow>
  );
}
