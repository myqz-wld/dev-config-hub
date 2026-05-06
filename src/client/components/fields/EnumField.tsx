import React from "react";
import type { FieldProps } from "./types.ts";
import { FieldRow } from "./FieldRow.tsx";
import { normalizeEnum } from "../../../schemas/helpers.ts";
import type { EnumOption } from "../../../schemas/types.ts";

/**
 * Enum 控件：≤4 项默认 radio，>4 项默认 select；schema.enumStyle 可强制。
 *
 * - schema.enumOpen=true：select 改 datalist 允许填非 enum 值
 * - 每项 hover 显示 description tooltip；deprecated 项灰底删除线
 * - 短形式 ["low", "high"] 与长形式 [{value, label, description}] 都支持（normalizeEnum 升格）
 */
export function EnumField({ schema, value, onChange, path, errors, disabled }: FieldProps<string | number>) {
  const options = normalizeEnum(schema.enum ?? []);
  const style = schema.enumStyle ?? (options.length <= 4 ? "radio" : "select");

  if (style === "radio") {
    return (
      <FieldRow schema={schema} path={path} errors={errors}>
        <div className="field-radio-group">
          {options.map((opt) => (
            <label key={String(opt.value)} className={`field-radio${isDeprecated(opt) ? " deprecated" : ""}`} title={opt.description ?? ""}>
              <input
                type="radio"
                name={path}
                value={String(opt.value)}
                checked={value === opt.value}
                disabled={disabled}
                onChange={() => onChange(opt.value)}
              />
              <span>{opt.label ?? String(opt.value)}</span>
            </label>
          ))}
        </div>
      </FieldRow>
    );
  }

  if (schema.enumOpen) {
    const listId = `${path}-list`;
    return (
      <FieldRow schema={schema} path={path} errors={errors}>
        <input
          type="text"
          className="field-input"
          list={listId}
          value={value != null ? String(value) : ""}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
        <datalist id={listId}>
          {options.map((opt) => (
            <option key={String(opt.value)} value={String(opt.value)}>
              {opt.label ?? String(opt.value)}
            </option>
          ))}
        </datalist>
      </FieldRow>
    );
  }

  return (
    <FieldRow schema={schema} path={path} errors={errors}>
      <select
        className="field-select"
        value={value != null ? String(value) : ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">{schema.default != null ? `（默认：${schema.default}）` : "（未设置）"}</option>
        {options.map((opt) => (
          <option key={String(opt.value)} value={String(opt.value)} disabled={isDeprecated(opt)}>
            {opt.label ?? String(opt.value)}
          </option>
        ))}
      </select>
    </FieldRow>
  );
}

function isDeprecated(opt: EnumOption): boolean {
  return opt.deprecated === true || (typeof opt.deprecated === "object" && opt.deprecated !== null);
}
