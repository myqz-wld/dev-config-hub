import React, { useState } from "react";
import type { FieldProps } from "./types.ts";
import { FieldRow } from "./FieldRow.tsx";
import { renderField } from "./index.tsx";

/**
 * 数组控件：
 *   - itemSchema.type=string + 每项 ≤30 字符 → 标签编辑器（chip + Enter 添加）
 *   - 其它（object / 长字符串 / 嵌套数组）→ 卡片列表 + 「+」按钮 + 上移/下移/删除/复制
 *
 * 拖拽重排留 PR-D / PR-I（用 HTML5 drag native + key 保持）。本 PR 提供按钮重排。
 */
export function ArrayField({ schema, value, onChange, path, errors, depth = 0, disabled }: FieldProps<unknown[]>) {
  const arr = value ?? [];
  const itemType = schema.itemSchema?.type;
  const isStringChips = itemType === "string" && (!schema.itemSchema?.maxLength || schema.itemSchema.maxLength <= 30);

  if (isStringChips) {
    return <StringChipEditor schema={schema} value={arr as string[]} onChange={onChange as (v: string[] | undefined) => void} path={path} errors={errors} disabled={disabled} />;
  }

  return (
    <FieldRow schema={schema} path={path} errors={errors}>
      <div className="field-array">
        {arr.length === 0 && <div className="field-empty">空数组</div>}
        {arr.map((item, i) => (
          <ArrayItemCard
            key={i}
            schema={schema.itemSchema!}
            value={item}
            index={i}
            total={arr.length}
            depth={depth + 1}
            disabled={disabled}
            onChange={(next) => {
              const copy = [...arr];
              copy[i] = next;
              onChange(copy);
            }}
            onMove={(delta) => {
              const j = i + delta;
              if (j < 0 || j >= arr.length) return;
              const copy = [...arr];
              [copy[i], copy[j]] = [copy[j] as unknown, copy[i] as unknown];
              onChange(copy);
            }}
            onRemove={() => {
              const copy = arr.filter((_, k) => k !== i);
              onChange(copy.length > 0 ? copy : undefined);
            }}
            onDuplicate={() => {
              const copy = [...arr];
              copy.splice(i + 1, 0, structuredClone(item));
              onChange(copy);
            }}
            childPath={`${path}.${i}`}
          />
        ))}
        <button
          type="button"
          className="field-array-add"
          disabled={disabled || (schema.maxItems != null && arr.length >= schema.maxItems)}
          onClick={() => onChange([...arr, undefined])}
        >
          + 添加
        </button>
      </div>
    </FieldRow>
  );
}

function ArrayItemCard({
  schema,
  value,
  index,
  total,
  depth,
  disabled,
  onChange,
  onMove,
  onRemove,
  onDuplicate,
  childPath,
}: {
  schema: import("../../../schemas/types.ts").FieldSchema;
  value: unknown;
  index: number;
  total: number;
  depth: number;
  disabled?: boolean;
  onChange: (next: unknown) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  childPath: string;
}) {
  return (
    <div className="field-array-card">
      <div className="field-array-card-head">
        <span className="field-array-card-label">[{index}]</span>
        <div className="field-array-card-actions">
          <button type="button" disabled={disabled || index === 0} onClick={() => onMove(-1)} title="上移">↑</button>
          <button type="button" disabled={disabled || index === total - 1} onClick={() => onMove(1)} title="下移">↓</button>
          <button type="button" disabled={disabled} onClick={onDuplicate} title="复制">⧉</button>
          <button type="button" disabled={disabled} className="danger" onClick={onRemove} title="删除">×</button>
        </div>
      </div>
      <div className="field-array-card-body">
        {renderField({ schema, value, onChange, path: childPath, depth, disabled })}
      </div>
    </div>
  );
}

function StringChipEditor({
  schema,
  value,
  onChange,
  path,
  errors,
  disabled,
}: {
  schema: import("../../../schemas/types.ts").FieldSchema;
  value: string[];
  onChange: (next: string[] | undefined) => void;
  path: string;
  errors?: import("../../../schemas/types.ts").Diagnostic[];
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (schema.uniqueItems && value.includes(v)) return;
    onChange([...value, v]);
    setDraft("");
  };
  return (
    <FieldRow schema={schema} path={path} errors={errors}>
      <div className="field-chips">
        {value.map((item, i) => (
          <span key={`${item}-${i}`} className="field-chip">
            <code>{item}</code>
            <button type="button" disabled={disabled} onClick={() => onChange(value.filter((_, k) => k !== i))}>×</button>
          </span>
        ))}
        <input
          type="text"
          className="field-chip-input"
          value={draft}
          disabled={disabled}
          placeholder="+ 添加，回车确认"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); add(); }
            if (e.key === "Backspace" && !draft && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={add}
        />
      </div>
    </FieldRow>
  );
}
