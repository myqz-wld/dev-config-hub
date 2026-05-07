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
export function ArrayField({ schema, value, onChange, path, errors, depth = 0, disabled, embedded, menu }: FieldProps<unknown[]>) {
  // 类型守卫：用户的实际 JSON / TOML 配置可能与 schema 期望的 array 不一致
  // （手写错 / 旧版本不同 schema / 外部工具改过），如果直接 `value ?? []` 当成数组渲染，
  // value 是 string / number / object 时会在 `value.map(...)` / 子组件里 throw，整个
  // React tree crash → App 白屏卡 raw "Loading..."（用户视角无法恢复，因为没 ErrorBoundary
  // 时的 unmount 让 root 回到 index.html 默认 HTML）。这里把非数组渲染成可见的「类型不匹配」
  // 警告 + 转换按钮，让用户能看到问题并自助修复，而不是静默 crash。reviews/REVIEW_9.md。
  if (value !== undefined && value !== null && !Array.isArray(value)) {
    const warn = (
      <div className="field-warn">
        ⚠ 期望数组类型，实际为 <code>{typeof value}</code>：
        <code style={{ marginLeft: 6 }}>{JSON.stringify(value)}</code>
        <button
          type="button"
          className="field-array-add"
          style={{ marginTop: 8 }}
          disabled={disabled}
          onClick={() => onChange([value])}
        >
          转为单元素数组
        </button>
      </div>
    );
    if (embedded) return warn;
    return (
      <FieldRow schema={schema} path={path} errors={errors} menu={menu}>
        {warn}
      </FieldRow>
    );
  }
  const arr: unknown[] = Array.isArray(value) ? value : [];
  const itemType = schema.itemSchema?.type;
  // 双重门：schema 声明 string + maxLength ≤ 30 + **数据实际全是 string**。
  // 用户实际写的 array 可能元素是 object（如 permissions 旧格式）；纯走 schema 判断
  // 让 StringChipEditor 内 `<code>{item}</code>` 渲染 object 直接 React throw
  // "Objects are not valid as a React child"（reviews/REVIEW_5.md follow-up #2）。
  const isStringChips = itemType === "string"
    && (!schema.itemSchema?.maxLength || schema.itemSchema.maxLength <= 30)
    && arr.every((x) => typeof x === "string");

  if (isStringChips) {
    return <StringChipEditor schema={schema} value={arr as string[]} onChange={onChange as (v: string[] | undefined) => void} path={path} errors={errors} disabled={disabled} embedded={embedded} menu={menu} />;
  }

  const inner = (
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
  );
  if (embedded) return inner;
  return (
    <FieldRow schema={schema} path={path} errors={errors} menu={menu}>
      {inner}
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
        {renderField({ schema, value, onChange, path: childPath, depth, disabled, embedded: true })}
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
  embedded,
  menu,
}: {
  schema: import("../../../schemas/types.ts").FieldSchema;
  value: string[];
  onChange: (next: string[] | undefined) => void;
  path: string;
  errors?: import("../../../schemas/types.ts").Diagnostic[];
  disabled?: boolean;
  embedded?: boolean;
  menu?: React.ReactNode;
}) {
  const [draft, setDraft] = useState("");
  // 防御深度：caller 已在 ArrayField 守卫非数组（reviews/REVIEW_9.md），
  // 这里再守一次，避免未来其他 caller 直接调 StringChipEditor 时再次 crash。
  const items: string[] = Array.isArray(value) ? value : [];
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (schema.uniqueItems && items.includes(v)) return;
    onChange([...items, v]);
    setDraft("");
  };
  const inner = (
    <div className="field-chips">
      {items.map((item, i) => {
        // 双重防护：caller ArrayField 已守卫「全 string 才走 chip」（reviews/REVIEW_5.md follow-up #2），
        // 这里再 typeof 守一次 — 否则未来 caller 直接调 StringChipEditor 传非 string array，
        // `<code>{item}</code>` 渲染 plain object 会 React throw "Objects are not valid as a React child"。
        const display = typeof item === "string" ? item : JSON.stringify(item);
        return (
          <span key={`${display}-${i}`} className="field-chip">
            <code>{display}</code>
            <button type="button" disabled={disabled} onClick={() => onChange(items.filter((_, k) => k !== i))}>×</button>
          </span>
        );
      })}
      <input
        type="text"
        className="field-chip-input"
        value={draft}
        disabled={disabled}
        placeholder="+ 添加，回车确认"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); add(); }
          if (e.key === "Backspace" && !draft && items.length > 0) {
            onChange(items.slice(0, -1));
          }
        }}
        onBlur={add}
      />
    </div>
  );
  if (embedded) return inner;
  return (
    <FieldRow schema={schema} path={path} errors={errors} menu={menu}>
      {inner}
    </FieldRow>
  );
}
