import { describe, expect, it } from "bun:test";
import { fieldSchemaToJsonSchema, toolSchemaToJsonSchema } from "./to-json-schema.ts";
import { DCH_STORE } from "./dch-store.ts";

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

  it("kv-map → object + patternProperties + additionalProperties: valueSchema", () => {
    const r = fieldSchemaToJsonSchema({
      type: "kv-map",
      keyPattern: "^[A-Z_][A-Z0-9_]*$",
      valueSchema: { type: "string" },
    });
    expect(r.type).toBe("object");
    expect(r.additionalProperties).toEqual({ type: "string" });
    expect(r.patternProperties).toEqual({ "^[A-Z_][A-Z0-9_]*$": { type: "string" } });
  });

  it("kv-map 无 keyPattern → additionalProperties: valueSchema", () => {
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

describe("toolSchemaToJsonSchema (DCH_STORE round-trip)", () => {
  it("含 $schema + $id 顶层", () => {
    const r = toolSchemaToJsonSchema(DCH_STORE);
    expect(r.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(r.$id).toBe("dch-store@1");
    expect(r.type).toBe("object");
  });

  it("additionalProperties: true 保未知 key", () => {
    const r = toolSchemaToJsonSchema(DCH_STORE);
    expect(r.additionalProperties).toBe(true);
  });

  it("profiles 是 array of object", () => {
    const r = toolSchemaToJsonSchema(DCH_STORE);
    const props = r.properties as Record<string, Record<string, unknown>>;
    expect(props.profiles?.type).toBe("array");
    expect((props.profiles?.items as Record<string, unknown>)?.type).toBe("object");
  });

  it("preferences.hookTimeoutMs 整数 + min/max", () => {
    const r = toolSchemaToJsonSchema(DCH_STORE);
    const props = r.properties as Record<string, Record<string, unknown>>;
    const prefs = props.preferences as Record<string, unknown>;
    const prefsProps = prefs.properties as Record<string, Record<string, unknown>>;
    const t = prefsProps.hookTimeoutMs;
    expect(t?.type).toBe("integer");
    expect(t?.minimum).toBe(1000);
    expect(t?.maximum).toBe(600000);
  });
});
