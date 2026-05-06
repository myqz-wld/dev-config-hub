import { describe, expect, it } from "bun:test";
import { fieldSchemaToJsonSchema, toolSchemaToJsonSchema } from "./to-json-schema.ts";
import { CLAUDE_SETTINGS } from "./claude-settings.ts";
import type { FieldSchema } from "./types.ts";

describe("fieldSchemaToJsonSchema", () => {
  it("boolean", () => {
    const r = fieldSchemaToJsonSchema({ type: "boolean", default: true });
    expect(r).toEqual({ type: "boolean", default: true });
  });

  it("integer with min/max", () => {
    const r = fieldSchemaToJsonSchema({ type: "integer", min: 1, max: 100, default: 30 });
    expect(r).toEqual({ type: "integer", minimum: 1, maximum: 100, default: 30 });
  });

  it("enum string 推断 type=string", () => {
    const r = fieldSchemaToJsonSchema({
      type: "enum",
      enum: ["low", "medium", "high"],
    });
    expect(r.type).toBe("string");
    expect(r.enum).toEqual(["low", "medium", "high"]);
  });

  it("enum 长形式（EnumOption）只取 value", () => {
    const r = fieldSchemaToJsonSchema({
      type: "enum",
      enum: [{ value: "a", label: "A" }, { value: "b", description: "..." }],
    });
    expect(r.enum).toEqual(["a", "b"]);
  });

  it("url 格式映射", () => {
    const r = fieldSchemaToJsonSchema({ type: "url" });
    expect(r).toEqual({ type: "string", format: "uri" });
  });

  it("array of strings + uniqueItems", () => {
    const r = fieldSchemaToJsonSchema({
      type: "array",
      itemSchema: { type: "string" },
      uniqueItems: true,
    });
    expect(r).toEqual({ type: "array", items: { type: "string" }, uniqueItems: true });
  });

  it("nested object 递归", () => {
    const r = fieldSchemaToJsonSchema({
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "object", properties: { c: { type: "boolean" } } },
      },
    });
    expect(r.properties).toBeDefined();
    expect((r.properties as Record<string, unknown>).a).toEqual({ type: "string" });
    const bSchema = (r.properties as Record<string, unknown>).b as Record<string, unknown>;
    expect(bSchema.type).toBe("object");
    expect((bSchema.properties as Record<string, unknown>).c).toEqual({ type: "boolean" });
  });

  it("kv-map → object + patternProperties + additionalProperties: valueSchema（REVIEW_4 R_2 R-H2 与上游 env 行为对齐）", () => {
    // 上游 Claude Code env 是 `patternProperties + additionalProperties: { type: string }`，keyPattern 仅 hint
    // UI 层 KVMapField 用 keyPattern 做 onBlur 红框校验；ajv 不严拒避免合法 lowercase env 标红
    const r = fieldSchemaToJsonSchema({
      type: "kv-map",
      keyPattern: "^[A-Z_][A-Z0-9_]*$",
      valueSchema: { type: "string" },
    });
    expect(r.type).toBe("object");
    expect(r.additionalProperties).toEqual({ type: "string" });  // 接受任意 key
    expect(r.patternProperties).toEqual({ "^[A-Z_][A-Z0-9_]*$": { type: "string" } });  // hint
  });

  it("kv-map 无 keyPattern → additionalProperties: valueSchema（保 kv-map 全动态语义）", () => {
    const r = fieldSchemaToJsonSchema({
      type: "kv-map",
      valueSchema: { type: "string" },
    });
    expect(r.additionalProperties).toEqual({ type: "string" });
    expect(r.patternProperties).toBeUndefined();
  });

  it("path 加 x-path-kind 标注", () => {
    const r = fieldSchemaToJsonSchema({ type: "path", pathKind: "directory" });
    expect(r.type).toBe("string");
    expect(r["x-path-kind"]).toBe("directory");
  });

  it("regex 格式", () => {
    const r = fieldSchemaToJsonSchema({ type: "regex" });
    expect(r.format).toBe("regex");
  });
});

describe("toolSchemaToJsonSchema (CLAUDE_SETTINGS round-trip)", () => {
  it("含 $schema + $id 顶层", () => {
    const r = toolSchemaToJsonSchema(CLAUDE_SETTINGS);
    expect(r.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(r.$id).toBe("claude-settings@1");
    expect(r.type).toBe("object");
  });

  it("effortLevel enum 5 档（不丢 xhigh/max）", () => {
    const r = toolSchemaToJsonSchema(CLAUDE_SETTINGS);
    const effortLevel = (r.properties as Record<string, FieldSchema>).effortLevel as unknown as Record<string, unknown>;
    expect(effortLevel.enum).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("env keyPattern → patternProperties", () => {
    const r = toolSchemaToJsonSchema(CLAUDE_SETTINGS);
    const env = (r.properties as Record<string, FieldSchema>).env as unknown as Record<string, unknown>;
    expect(env.patternProperties).toBeDefined();
    expect(Object.keys(env.patternProperties as Record<string, unknown>)).toContain("^[A-Z_][A-Z0-9_]*$");
  });

  it("additionalProperties: true 保未知 key", () => {
    const r = toolSchemaToJsonSchema(CLAUDE_SETTINGS);
    expect(r.additionalProperties).toBe(true);
  });
});
