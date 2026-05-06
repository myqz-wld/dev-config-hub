import type { FieldSchema, Diagnostic } from "../../../schemas/types.ts";

/**
 * 字段控件统一 props 形状（PR-C）。
 *
 * 所有 fields/*Field.tsx 接受同样形状，让 fields/index.tsx 的 renderField
 * 调度器能按 schema.type 派发到对应控件。
 *
 * **value === undefined 语义**：表示「字段未设置」（应用 schema.default）。
 * **onChange(undefined) 语义**：删除该 key（schema-driven 写回时调 patchJson value=undefined）。
 *
 * scopeContext 给 SensitiveField 判断「写到非 .local 文件警告」+ PathField 判断
 * Tauri dialog 起始目录。PR-D 集成时填充。
 */
export interface FieldProps<T = unknown> {
  schema: FieldSchema;
  value: T | undefined;
  onChange: (next: T | undefined) => void;
  /** dotted path，例如 "permissions.allow.0"。用于 React key + Diagnostic 匹配 */
  path: string;
  errors?: Diagnostic[];
  scopeContext?: ScopeContext;
  /** 嵌套层级。用于 ObjectField 折叠决策（≤2 直接展开） */
  depth?: number;
  disabled?: boolean;
}

export interface ScopeContext {
  /** 当前文件 scope level（user / project / local / global）。SensitiveField 据此判断警告 */
  level: "global" | "user" | "project" | "local";
  /** 当前文件路径（PathField Tauri dialog 起始目录用） */
  filePath: string;
}
