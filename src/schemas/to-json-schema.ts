import type { FieldSchema, ToolSchema } from "./types.ts";

/**
 * 把项目内部 FieldSchema → 标准 JSON Schema（Draft 2020-12）。
 *
 * 用途（PR-G）：
 *   1. ajv compile 实时校验（hook 到字段控件 errors prop）
 *   2. `codemirror-json-schema` 注入 CM6 raw editor → hover schema 描述 / 自动补全 / lint gutter
 *
 * 转换规则（保守映射）：
 *   - boolean / number / integer / string → 同名 JSON Schema type
 *   - enum → enum + 值数组（去掉 EnumOption 包装；description 留在外层 schema 用 oneOf 包装太重，舍弃）
 *   - path / url / regex / color / duration / markdown / code → string + 可选 format
 *   - array → array + items（递归 itemSchema）
 *   - object → object + properties（递归）+ additionalProperties
 *   - kv-map → object + additionalProperties (valueSchema)
 *
 * **不展开**：sensitive 标记 / patternHint / examples / since / deprecated / helpUrl / unit
 *  — 这些是 UI metadata 不属于 JSON Schema validation 关注。
 */

export type StandardJsonSchema = Record<string, unknown>;

export function fieldSchemaToJsonSchema(field: FieldSchema): StandardJsonSchema {
  const out: StandardJsonSchema = {};
  if (field.description) out.description = field.description;
  if (field.default !== undefined) out.default = field.default;

  switch (field.type) {
    case "boolean":
      out.type = "boolean";
      break;
    case "number":
      out.type = "number";
      applyNumeric(out, field);
      break;
    case "integer":
      out.type = "integer";
      applyNumeric(out, field);
      break;
    case "duration":
      // 内部统一 ms（数字）
      out.type = "number";
      applyNumeric(out, field);
      break;
    case "string":
    case "color":
    case "markdown":
    case "code":
      out.type = "string";
      applyString(out, field);
      break;
    case "url":
      out.type = "string";
      out.format = "uri";
      applyString(out, field);
      break;
    case "regex":
      out.type = "string";
      out.format = "regex";
      applyString(out, field);
      break;
    case "path":
      out.type = "string";
      // JSON Schema 没有标准 path format；放说明
      if (field.pathKind) out["x-path-kind"] = field.pathKind;
      applyString(out, field);
      break;
    case "enum":
      // ajv 接受 enum；type 推断（值若全是 string → string，全是 number → number）
      if (field.enum) {
        const values = field.enum.map((v) => (typeof v === "object" ? v.value : v));
        out.enum = values;
        if (values.every((v) => typeof v === "string")) out.type = "string";
        else if (values.every((v) => typeof v === "number")) out.type = "number";
      }
      break;
    case "array": {
      out.type = "array";
      if (field.itemSchema) out.items = fieldSchemaToJsonSchema(field.itemSchema);
      if (field.uniqueItems) out.uniqueItems = true;
      if (field.minItems != null) out.minItems = field.minItems;
      if (field.maxItems != null) out.maxItems = field.maxItems;
      break;
    }
    case "object": {
      out.type = "object";
      if (field.properties) {
        const props: Record<string, StandardJsonSchema> = {};
        for (const [k, v] of Object.entries(field.properties)) {
          props[k] = fieldSchemaToJsonSchema(v);
        }
        out.properties = props;
      }
      if (field.required) {
        // FieldSchema.required 是单字段 boolean；对 object 来说 required 应该是子字段名数组
        // 这里不直接转（PR-D schema 也没用 required: true 的 object 字段）
      }
      if (field.additionalProperties === false) out.additionalProperties = false;
      else if (typeof field.additionalProperties === "object") {
        out.additionalProperties = fieldSchemaToJsonSchema(field.additionalProperties);
      } else {
        // true / undefined 都允许任意未知 key（默认 JSON Schema 行为）
        out.additionalProperties = true;
      }
      break;
    }
    case "kv-map": {
      out.type = "object";
      // REVIEW_4 R_2 R-H2：与上游 schema 行为对齐（Claude Code settings.json env 实际是
      // patternProperties + additionalProperties: valueSchema，keyPattern 仅 hint，
      // 不命中 pattern 的 key 走 additionalProperties 同样接受）。之前 H2' 改 additionalProperties:false
      // 严过上游，让用户合法 lowercase env （如 `http_proxy`）被 ajv 标红。
      // **真正的 keyPattern 守门走 UI 层**：KVMapField onBlur 校验 keyPattern 不命中红框 + manager.ts ENV_KEY_RE CLI 守门
      const valueJs = field.valueSchema ? fieldSchemaToJsonSchema(field.valueSchema) : true;
      out.additionalProperties = valueJs;
      if (field.keyPattern) {
        out.patternProperties = { [field.keyPattern]: valueJs };
      }
      break;
    }
  }
  return out;
}

export function toolSchemaToJsonSchema(tool: ToolSchema): StandardJsonSchema {
  const root = fieldSchemaToJsonSchema(tool.rootSchema);
  root.$schema = "https://json-schema.org/draft/2020-12/schema";
  root.$id = tool.$id;
  return root;
}

function applyNumeric(out: StandardJsonSchema, f: FieldSchema): void {
  if (f.min != null) out.minimum = f.min;
  if (f.max != null) out.maximum = f.max;
  if (f.step != null) out.multipleOf = f.step;
}

function applyString(out: StandardJsonSchema, f: FieldSchema): void {
  if (f.pattern) out.pattern = f.pattern;
  if (f.minLength != null) out.minLength = f.minLength;
  if (f.maxLength != null) out.maxLength = f.maxLength;
}
