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
  /**
   * 嵌入模式：当前 field 是被父容器（KVMapField 的 value 列 / ArrayItemCard 的 body）渲染的。
   *
   * embedded=true 时，leaf field 必须**跳过 FieldRow 包装**，只渲染裸控件。
   * 否则父容器的 grid 会被 nested FieldRow 的 200px label 列挤掉布局，造成
   * KV row 的 × 按钮被裁切 / 重复显示 path 末段 label（reviews/REVIEW_5.md follow-up）。
   *
   * errors / description / helpUrl 在 embedded 时不显示（外层容器自己包了 FieldRow，
   * 顶层 ajv diagnostics 也会汇总）。
   */
  embedded?: boolean;
  /**
   * 「⋯」菜单 slot（PR-CSv1）。仅 root level 字段会有（ObjectField 给 root 子字段传 `<FieldMenu>`）。
   * 非 root / 嵌套字段不传 → 不渲染菜单按钮。
   */
  menu?: React.ReactNode;
}

export interface ScopeContext {
  /** 当前文件 scope level（user / project / local / global）。SensitiveField 据此判断警告 */
  level: "global" | "user" | "project" | "local";
  /** 当前文件路径（PathField Tauri dialog 起始目录用） */
  filePath: string;
}
