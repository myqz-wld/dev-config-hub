import React from "react";
import type { FieldSchema, Diagnostic, DeprecatedInfo } from "../../../schemas/types.ts";
import { useFieldErrors } from "./errors-context.tsx";

/**
 * 字段通用包装：label + 控件 + description + errors + deprecated/sensitive 提示。
 *
 * 三栏布局对齐 ConfigPanel.tsx 现有 `.item` 视觉（200px label + 1fr control）。
 *
 * **errors 来源**（PR-J follow-up #3）：
 *   1. 显式 props.errors（caller 直接传，最高优先级，向后兼容）
 *   2. useFieldErrors(path) Context 取（SchemaScopeBody 包了 FieldErrorsProvider 时生效）
 *   合并显示。
 */
export function FieldRow({
  schema,
  path,
  errors,
  children,
}: {
  schema: FieldSchema;
  path: string;
  errors?: Diagnostic[];
  children: React.ReactNode;
}) {
  const ctxErrors = useFieldErrors(path);
  const allErrors: Diagnostic[] = [...(errors ?? []), ...(ctxErrors ?? [])];
  const keyLabel = lastSegment(path);
  return (
    <div className="field-row">
      <div className="field-key">
        <code>{keyLabel}</code>
        {schema.description && <span className="field-desc">{schema.description}</span>}
        {schema.since && <span className="field-since">since {schema.since}</span>}
        {schema.deprecated && <DeprecatedBadge value={schema.deprecated} />}
        {schema.sensitive && <span className="field-badge sensitive">sensitive</span>}
      </div>
      <div className="field-control">
        {children}
        {allErrors.length > 0 && (
          <ul className="field-errors">
            {allErrors.map((e, i) => (
              <li key={i} className={`field-error ${e.level}`}>{e.message}</li>
            ))}
          </ul>
        )}
        {schema.helpUrl && (
          <a className="field-help" href={schema.helpUrl} target="_blank" rel="noreferrer">
            官方文档 ↗
          </a>
        )}
      </div>
    </div>
  );
}

function DeprecatedBadge({ value }: { value: boolean | DeprecatedInfo }) {
  if (value === true) return <span className="field-badge deprecated">deprecated</span>;
  if (typeof value === "object") {
    return (
      <span className="field-badge deprecated" title={value.reason ?? ""}>
        deprecated{value.replacement ? ` → ${value.replacement}` : ""}
      </span>
    );
  }
  return null;
}

function lastSegment(path: string): string {
  const i = Math.max(path.lastIndexOf("."), path.lastIndexOf("/"));
  return i >= 0 ? path.slice(i + 1) : path || "(root)";
}
