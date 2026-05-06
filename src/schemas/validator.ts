import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import type { ToolSchema, Diagnostic } from "./types.ts";
import { toolSchemaToJsonSchema } from "./to-json-schema.ts";

/**
 * ajv runtime 校验（PR-J）。
 *
 * **设计**：每个 ToolSchema compile 一个 ValidateFunction（缓存）。caller 用 useMemo
 * 稳定 toolSchema 引用 → validator 也稳定 → 不重复 compile。
 *
 * **设计取舍**（REVIEW_4 M3）：每个 ToolSchema 新建独立 Ajv 实例。
 *   - 优点：不同 schema 的 $id / $ref 不冲突；切换 scope 时旧实例 GC
 *   - 代价：5 份 schema = 5 个 Ajv 实例（含 addFormats）≈ 5x 初始化开销（~10-20ms × 5）
 *   - 替代方案：共用单实例 + compile 前删 $id —— 节省内存但失去 schema 隔离，且 5 份首次 compile 总耗时不变
 *   - 当前规模（5 schema × 单次 compile ≈ 100ms）可接受；若 schema 增至 20+ 再优化
 *
 * **Diagnostic.path**：dotted string，与 SchemaScopeBody / 字段控件 errors prop 对齐。
 * ajv instancePath（`/permissions/allow/0`）→ 转 dotted（`permissions.allow.0`）。
 *
 * **draft 2020-12 兼容**：ajv@8 默认不识别 `$schema: ".../draft/2020-12/..."` URI；
 * compile 前删 `$schema`（不影响校验语义；codemirror-json-schema 仍能消费 $schema）。
 */

const cache = new WeakMap<ToolSchema, ValidateFunction>();

function getValidator(toolSchema: ToolSchema): ValidateFunction {
  let v = cache.get(toolSchema);
  if (v) return v;
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const std = toolSchemaToJsonSchema(toolSchema);
  const stdNoSchema = { ...std };
  delete (stdNoSchema as Record<string, unknown>).$schema;
  v = ajv.compile(stdNoSchema);
  cache.set(toolSchema, v);
  return v;
}

/**
 * 校验 value（通常是 ConfigScope.parsed）against ToolSchema，返回 Diagnostic 数组。
 * 没有错误返 []。
 */
export function validate(toolSchema: ToolSchema, value: unknown): Diagnostic[] {
  const v = getValidator(toolSchema);
  const ok = v(value);
  if (ok) return [];
  return (v.errors ?? []).map(toDiagnostic);
}

function toDiagnostic(err: ErrorObject): Diagnostic {
  // ajv instancePath: "/permissions/allow/0"  → "permissions.allow.0"
  // 顶层错误（ajv instancePath ""）→ Diagnostic.path "" 与 FieldRow root path "" 直接对齐
  // REVIEW_4 M6：之前 path = dotted || "<root>" 让 FieldRow useFieldErrors("") 永远 miss 根错误
  const path = err.instancePath
    .replace(/^\//, "")
    .replace(/\//g, ".");
  return {
    level: "error",
    message: `${path || "<root>"}: ${err.message ?? ""}${err.params ? ` (${formatParams(err.params)})` : ""}`,
    path,  // 空串保持，FieldRow 用 path="" 直接 lookup 命中
  };
}

function formatParams(p: Record<string, unknown>): string {
  return Object.entries(p)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(", ");
}
