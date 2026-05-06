import { jsonSchema } from "codemirror-json-schema";
import type { Extension } from "@codemirror/state";
import type { ToolSchema } from "../../../schemas/types.ts";
import { toolSchemaToJsonSchema } from "../../../schemas/to-json-schema.ts";

/**
 * 把 ToolSchema 转换为 codemirror-json-schema 可消费的 extension（PR-G）。
 *
 * 一次 `jsonSchema(schema)` 调用产出包含 **lint + hover + completion** 的 CM6 extension，
 * 注入 CMEditor 的 extraExtensions 即可激活：
 *   - **lint**：错误的 type / 缺失 required key / enum 值不在范围内 → gutter 红点 + tooltip
 *   - **hover**：hover key / value 显示 schema description（FieldSchema.description 透传）
 *   - **completion**：Ctrl+Space 触发，按 properties / enum 自动补全
 *
 * **caller 必须 useMemo 稳定引用**（REVIEW_3 R_2 D3 已警告）：
 * 本工厂内部 toolSchemaToJsonSchema 每次调用产新 object，CMEditor extraCompartment
 * useEffect deps 引用比对，每次新对象会触发 reconfigure dispatch。useMemo 稳定 toolSchema
 * 引用即可让本工厂返回值也稳定。
 */
export function buildSchemaExtensions(toolSchema: ToolSchema | null): Extension[] {
  if (!toolSchema) return [];
  const stdSchema = toolSchemaToJsonSchema(toolSchema);
  return [jsonSchema(stdSchema as Parameters<typeof jsonSchema>[0])];
}
