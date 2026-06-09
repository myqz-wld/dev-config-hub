/**
 * Schema-driven 配置系统的核心类型。
 *
 * 设计宗旨：每个配置字段以 FieldSchema 描述其语义（类型 / 约束 / 描述 / 默认值 / 来源），
 * UI 控件按 FieldSchema 派发对应 widget，写回严禁「全量序列化 parsed」——
 * 必须以「原文 + 字段级 patch」形式落盘，从根本保证 schema 不认识的用户自定义 key 不丢失。
 */

export type FieldType =
  | "boolean"
  | "number"        // 浮点
  | "integer"
  | "string"
  | "enum"
  | "path"
  | "url"
  | "regex"
  | "duration"      // 内部统一 ms，UI 按数值大小自适配显示 ms / s / min
  | "color"
  | "array"
  | "object"
  | "kv-map"        // 动态 key 的 object（如 env / mcp_servers）
  | "markdown"      // 大段 markdown 文本（如 systemPrompt）
  | "code";         // 一段代码（如 hook bash）

export interface DeprecatedInfo {
  reason?: string;
  replacement?: string;
  since?: string;
}

export interface EnumOption {
  value: string | number;
  label?: string;
  description?: string;       // 允许 markdown
  since?: string;             // 该选项自哪个 CLI 版本起支持
  deprecated?: boolean | DeprecatedInfo;
}

/** enum 字段允许写短形式（直接给值数组）或完整 EnumOption 数组。 */
export type EnumValue = EnumOption | string | number;

export interface FieldSchema {
  type: FieldType;
  description?: string;       // 允许 markdown
  required?: boolean;
  sensitive?: boolean;        // 输入框 mask；写到非 .local 文件时 banner 警告
  default?: unknown;
  examples?: unknown[];
  since?: string;
  deprecated?: boolean | DeprecatedInfo;

  // 数值约束（number / integer / duration）
  min?: number;
  max?: number;
  step?: number;
  unit?: string;              // "ms" / "s" / "MB" / "tokens"，仅 UI 显示

  // 字符串约束
  pattern?: string;           // 编译为 RegExp（运行时缓存）
  patternHint?: string;       // 给用户看的人话描述
  minLength?: number;
  maxLength?: number;
  multiline?: boolean;        // text vs textarea

  // enum
  enum?: EnumValue[];
  enumStyle?: "select" | "radio";   // ≤4 项倾向 radio，否则 select；可强制
  enumOpen?: boolean;               // datalist 允许填非 enum 值

  // path
  pathKind?: "file" | "directory" | "either";
  expandHome?: boolean;             // 显示折叠 ~/.. ；保存展开

  // code
  codeLanguage?: "shell" | "json" | "toml" | "yaml" | "ts" | "regex" | "markdown";

  // array
  itemSchema?: FieldSchema;
  uniqueItems?: boolean;
  minItems?: number;
  maxItems?: number;

  // object
  properties?: Record<string, FieldSchema>;
  propertyOrder?: string[];         // 显示顺序；缺省按 properties 定义顺序
  /**
   * - true（默认）: 允许任意未知 key，渲染 UnknownField，**保留可编辑性**
   * - false: 校验时报错（仍可编辑，UI 红色提示）
   * - FieldSchema: 未知 key 用此 schema 渲染（kv-map 场景）
   */
  additionalProperties?: boolean | FieldSchema;

  // kv-map（properties 全部动态的纯 map）
  keyPattern?: string;              // 例：env 用 "^[A-Z_][A-Z0-9_]*$"
  keyHint?: string;
  valueSchema?: FieldSchema;

  // 通用 UX
  hidden?: boolean;                 // 默认折叠
  /**
   * 高级字段：默认在 UI 隐藏，需用户在 SchemaScopeBody 顶部 toggle "显示隐藏字段" 才显示。
   *
   * 用于上游存在但日常少用的字段（如 `experimental_*` / `companyAnnouncements` /
   * `managed_*`），减少 root level 字段列表噪音。reviews/REVIEW_5.md PR-CSv1 引入。
   *
   * **粒度**：仅作用于 root level 字段（与 hide-field feature 一致）。嵌套字段标 advanced
   * 不生效（ObjectField 仅在 root path 时执行 advanced/hidden 过滤）。
   */
  advanced?: boolean;
  readOnly?: boolean;
  helpUrl?: string;                 // 跳转官方文档锚点
}

export type ScopeKind =
  | "claude-settings"
  | "claude-settings-local"
  | "claude-mcp"
  | "claude-md"
  | "codex-config"
  | "shell-rc"
  | "dch-store";

export interface ToolSchema {
  $id: string;            // "claude-settings@1"
  $source: string;        // 上游 URL
  fetchedAt: string;      // ISO 日期，sync.ts 拉上游时刷新
  scopeKind: ScopeKind;
  rootSchema: FieldSchema;   // 顶层 type 一律 "object"
}

/** ajv 校验或字段级实时校验产出的诊断。 */
export interface Diagnostic {
  level: "error" | "warning" | "info";
  message: string;
  path: string;           // dotted path，例如 "permissions.defaultMode" 或 "hooks.PreToolUse.[0].matcher"
}
