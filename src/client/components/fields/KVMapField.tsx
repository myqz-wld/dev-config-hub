import React, { useState } from "react";
import type { FieldProps } from "./types.ts";
import { FieldRow } from "./FieldRow.tsx";
import { renderField } from "./index.tsx";

/**
 * KV-map 控件：动态 key 的 object（如 env / mcp_servers）。
 *
 * - 行级编辑器：key 输入 + valueSchema 控件 + 删除按钮
 * - schema.keyPattern：key onBlur 校验，不匹配红框
 * - schema.keyHint：人话描述
 * - 重复 key 红框（key 改完聚焦移开时）
 * - 空 key 自动丢弃
 * - 「+」按钮加新行
 */
export function KVMapField({ schema, value, onChange, path, errors, depth = 0, disabled, embedded, menu }: FieldProps<Record<string, unknown>>) {
  const obj = value ?? {};
  const entries = Object.entries(obj);

  const valueSchema = schema.valueSchema ?? { type: "string" as const };

  const inner = (
    <div className="field-kv">
      {entries.length === 0 && <div className="field-empty">无条目</div>}
      {entries.map(([k, v], i) => (
        <KVRow
          key={`${k}-${i}`}
          schema={schema}
          entryKey={k}
          entryValue={v}
          existingKeys={entries.map(([key]) => key)}
          depth={depth + 1}
          disabled={disabled}
          onKeyChange={(newKey) => {
            if (!newKey || newKey === k) return;
            const copy: Record<string, unknown> = {};
            for (const [oldK, oldV] of entries) {
              copy[oldK === k ? newKey : oldK] = oldV;
            }
            onChange(copy);
          }}
          onValueChange={(newV) => {
            const copy = { ...obj };
            if (newV === undefined) delete copy[k];
            else copy[k] = newV;
            onChange(Object.keys(copy).length > 0 ? copy : undefined);
          }}
          onRemove={() => {
            const copy = { ...obj };
            delete copy[k];
            onChange(Object.keys(copy).length > 0 ? copy : undefined);
          }}
          renderValueField={(onValueChange) =>
            renderField({
              schema: valueSchema,
              value: v,
              onChange: onValueChange,
              path: `${path}.${k}`,
              depth: depth + 1,
              disabled,
              embedded: true,  // KV value 列禁止 nested FieldRow（reviews/REVIEW_5.md follow-up）
            })
          }
        />
      ))}
      <button
        type="button"
        className="field-kv-add"
        disabled={disabled}
        onClick={() => {
          // 临时添加一个空 key 行让用户填
          // REVIEW_4 L3 fix：之前 ++n 先增后用让 NEW_KEY_1 永远跳过；改 n++ 后用先增
          let n = 0;
          let placeholder = "NEW_KEY";
          while (placeholder in obj) {
            n++;
            placeholder = `NEW_KEY_${n}`;
          }
          onChange({ ...obj, [placeholder]: valueSchema.default ?? "" });
        }}
      >
        + 添加
      </button>
      {schema.keyHint && <span className="field-hint">key 格式：{schema.keyHint}</span>}
    </div>
  );
  if (embedded) return inner;
  return (
    <FieldRow schema={schema} path={path} errors={errors} menu={menu}>
      {inner}
    </FieldRow>
  );
}

function KVRow({
  schema,
  entryKey,
  existingKeys,
  disabled,
  onKeyChange,
  onRemove,
  renderValueField,
  onValueChange,
  entryValue: _entryValue,
  depth: _depth,
}: {
  schema: import("../../../schemas/types.ts").FieldSchema;
  entryKey: string;
  entryValue: unknown;
  existingKeys: string[];
  depth: number;
  disabled?: boolean;
  onKeyChange: (next: string) => void;
  onValueChange: (next: unknown) => void;
  onRemove: () => void;
  renderValueField: (onValueChange: (next: unknown) => void) => React.ReactNode;
}) {
  const [keyDraft, setKeyDraft] = useState(entryKey);
  const keyValid =
    (!schema.keyPattern || (() => {
      try { return new RegExp(schema.keyPattern!).test(keyDraft); } catch { return false; }
    })()) &&
    !(existingKeys.filter((k) => k === keyDraft).length > 1);

  return (
    <div className="field-kv-row">
      <input
        type="text"
        className={`field-kv-key${keyValid ? "" : " invalid"}`}
        value={keyDraft}
        disabled={disabled}
        onChange={(e) => setKeyDraft(e.target.value)}
        onBlur={() => keyValid && keyDraft && onKeyChange(keyDraft)}
      />
      <div className="field-kv-value">{renderValueField(onValueChange)}</div>
      <button type="button" className="field-kv-del" disabled={disabled} onClick={onRemove}>×</button>
    </div>
  );
}
