import React, { useState, useEffect } from "react";
import type { FieldProps } from "./types.ts";
import { FieldRow } from "./FieldRow.tsx";

/**
 * 字符串控件：text / textarea / url / regex / pattern 共用。
 *
 * 行为：
 *   - schema.multiline=true → textarea；否则单行 input
 *   - schema.pattern：onBlur 时 try new RegExp(value)，不匹配红框
 *   - schema.minLength / maxLength：HTML 原生约束
 *   - 类型 url / regex 走相同 input + 自定义校验（regex 是 onChange 即时编译；url 走 ajv）
 */
export function StringField({ schema, value, onChange, path, errors, disabled, embedded, menu }: FieldProps<string>) {
  const [draft, setDraft] = useState<string>(value ?? "");
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setDraft(value ?? "");
    setInvalid(false);
  }, [value]);

  const validate = (s: string): boolean => {
    if (s === "") return true;
    if (schema.pattern) {
      try {
        if (!new RegExp(schema.pattern).test(s)) return false;
      } catch {
        return false;
      }
    }
    if (schema.type === "regex") {
      try { new RegExp(s); } catch { return false; }
    }
    return true;
  };

  const commit = () => {
    if (draft === "") {
      onChange(undefined);
      setInvalid(false);
      return;
    }
    if (!validate(draft)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (draft !== value) onChange(draft);
  };

  const className = `field-input${invalid ? " invalid" : ""}`;

  if (schema.multiline) {
    const inner = (
      <textarea
        className={`${className} field-textarea`}
        value={draft}
        disabled={disabled}
        minLength={schema.minLength}
        maxLength={schema.maxLength}
        placeholder={schema.default != null ? String(schema.default) : (schema.patternHint ?? "")}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
      />
    );
    if (embedded) return inner;
    return (
      <FieldRow schema={schema} path={path} errors={errors} menu={menu}>
        {inner}
        {schema.patternHint && <span className="field-hint">{schema.patternHint}</span>}
      </FieldRow>
    );
  }

  const inner = (
    <input
      type="text"
      className={className}
      value={draft}
      disabled={disabled}
      minLength={schema.minLength}
      maxLength={schema.maxLength}
      placeholder={schema.default != null ? String(schema.default) : (schema.patternHint ?? "")}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
    />
  );
  if (embedded) return inner;
  return (
    <FieldRow schema={schema} path={path} errors={errors} menu={menu}>
      {inner}
      {schema.patternHint && <span className="field-hint">{schema.patternHint}</span>}
    </FieldRow>
  );
}
