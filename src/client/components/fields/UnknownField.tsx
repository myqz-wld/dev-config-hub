import React, { useState } from "react";
import type { FieldProps } from "./types.ts";
import { FieldRow } from "./FieldRow.tsx";

/**
 * 未知字段：schema 不认识的 key 走这个 fallback。
 *
 * - 顶部「unknown」橙色 badge
 * - 按 typeof 推断显示控件（boolean → toggle / number → input / string → input / object → readonly JSON pre）
 * - **保留可编辑性**（数据完整性铁律：schema 不认识不代表不能改）
 * - 删除按钮二次确认
 */
export function UnknownField({ schema, value, onChange, path, errors, disabled }: FieldProps) {
  const [confirmDel, setConfirmDel] = useState(false);
  const typeofVal = typeof value;
  const isObject = value !== null && typeofVal === "object";

  return (
    <FieldRow schema={schema} path={path} errors={errors}>
      <div className="field-unknown">
        <span className="field-badge unknown">unknown</span>
        {typeofVal === "boolean" && (
          <button
            type="button"
            role="switch"
            aria-checked={value as boolean}
            className={`field-toggle${value ? " on" : ""}`}
            disabled={disabled}
            onClick={() => onChange(!value)}
          >
            <span className="field-toggle-knob" />
          </button>
        )}
        {(typeofVal === "number" || typeofVal === "string") && !isObject && (
          <input
            type={typeofVal === "number" ? "number" : "text"}
            className="field-input"
            value={value != null ? String(value) : ""}
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") onChange(undefined);
              else onChange(typeofVal === "number" ? Number(v) : v);
            }}
          />
        )}
        {isObject && (
          <pre className="field-unknown-json">{JSON.stringify(value, null, 2)}</pre>
        )}
        {value === null && <span className="field-null">null</span>}
        {!confirmDel ? (
          <button type="button" className="field-reset" disabled={disabled} onClick={() => setConfirmDel(true)}>删除</button>
        ) : (
          <>
            <span className="field-confirm-hint">确认？</span>
            <button type="button" className="field-reset danger" disabled={disabled} onClick={() => { onChange(undefined); setConfirmDel(false); }}>是</button>
            <button type="button" className="field-reset" disabled={disabled} onClick={() => setConfirmDel(false)}>否</button>
          </>
        )}
      </div>
    </FieldRow>
  );
}
