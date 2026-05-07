import React from "react";
import type { FieldProps } from "./types.ts";
import { FieldRow } from "./FieldRow.tsx";

/**
 * Boolean 三态 toggle：true / false / undefined（继承 default）。
 *
 * iOS 风格切换 + 右侧「重置」按钮把 value 设回 undefined。
 * value=undefined 时 toggle 显示半透明（暗示未设置 / 走 default）。
 */
export function BooleanField({ schema, value, onChange, path, errors, disabled, embedded, menu }: FieldProps<boolean>) {
  const effective = value ?? (schema.default as boolean | undefined);
  const isUnset = value === undefined;

  const inner = (
    <div className="field-bool">
      <button
        type="button"
        role="switch"
        aria-checked={effective ?? false}
        className={`field-toggle${effective ? " on" : ""}${isUnset ? " unset" : ""}`}
        disabled={disabled}
        onClick={() => onChange(!(effective ?? false))}
      >
        <span className="field-toggle-knob" />
      </button>
      <span className="field-bool-label">{String(effective ?? "—")}</span>
      {!isUnset && (
        <button
          type="button"
          className="field-reset"
          disabled={disabled}
          onClick={() => onChange(undefined)}
          title={`重置为默认值（${String(schema.default ?? "未定义")}）`}
        >
          重置
        </button>
      )}
    </div>
  );
  if (embedded) return inner;
  return (
    <FieldRow schema={schema} path={path} errors={errors} menu={menu}>
      {inner}
    </FieldRow>
  );
}
