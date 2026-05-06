import { describe, expect, it } from "bun:test";
import { buildFieldIndex, resolveFieldAtPath, normalizeEnum, pathToString } from "./helpers.ts";
import type { FieldSchema } from "./types.ts";

const SAMPLE: FieldSchema = {
  type: "object",
  properties: {
    model: { type: "string" },
    permissions: {
      type: "object",
      properties: {
        defaultMode: { type: "enum", enum: ["a", "b"] },
        allow: { type: "array", itemSchema: { type: "string" } },
      },
    },
    env: {
      type: "kv-map",
      keyPattern: "^[A-Z_][A-Z0-9_]*$",
      valueSchema: { type: "string" },
    },
    extra: {
      type: "object",
      additionalProperties: { type: "number" },
    },
  },
};

describe("buildFieldIndex", () => {
  it("展开顶层 properties", () => {
    const idx = buildFieldIndex(SAMPLE);
    expect(idx.has("model")).toBe(true);
    expect(idx.get("model")?.type).toBe("string");
    expect(idx.has("permissions")).toBe(true);
  });

  it("展开嵌套 object 用点连接", () => {
    const idx = buildFieldIndex(SAMPLE);
    expect(idx.get("permissions.defaultMode")?.type).toBe("enum");
  });

  it("数组段用 []", () => {
    const idx = buildFieldIndex(SAMPLE);
    expect(idx.has("permissions.allow")).toBe(true);
    expect(idx.get("permissions.allow.[]")?.type).toBe("string");
  });

  it("kv-map 段用 <key>", () => {
    const idx = buildFieldIndex(SAMPLE);
    expect(idx.has("env")).toBe(true);
    expect(idx.get("env.<key>")?.type).toBe("string");
  });

  it("additionalProperties 为 schema 时用 *", () => {
    const idx = buildFieldIndex(SAMPLE);
    expect(idx.get("extra.*")?.type).toBe("number");
  });

  it("根节点不入索引（prefix 默认空串）", () => {
    const idx = buildFieldIndex(SAMPLE);
    expect(idx.has("")).toBe(false);
  });
});

describe("resolveFieldAtPath", () => {
  it("顶层 key 命中", () => {
    expect(resolveFieldAtPath(SAMPLE, ["model"])?.type).toBe("string");
  });

  it("嵌套 object 命中", () => {
    expect(resolveFieldAtPath(SAMPLE, ["permissions", "defaultMode"])?.type).toBe("enum");
  });

  it("数组下标命中 itemSchema", () => {
    expect(resolveFieldAtPath(SAMPLE, ["permissions", "allow", 2])?.type).toBe("string");
  });

  it("kv-map 任意 key 命中 valueSchema", () => {
    expect(resolveFieldAtPath(SAMPLE, ["env", "HTTP_PROXY"])?.type).toBe("string");
  });

  it("additionalProperties 为 schema 时命中", () => {
    expect(resolveFieldAtPath(SAMPLE, ["extra", "anything"])?.type).toBe("number");
  });

  it("未知 key + additionalProperties: true → null（caller fallback）", () => {
    const root: FieldSchema = {
      type: "object",
      additionalProperties: true,
      properties: { a: { type: "string" } },
    };
    expect(resolveFieldAtPath(root, ["unknown"])).toBeNull();
  });

  it("未知 key + 无 additionalProperties → null", () => {
    expect(resolveFieldAtPath(SAMPLE, ["nope"])).toBeNull();
  });

  it("数组段不接 string → null", () => {
    expect(resolveFieldAtPath(SAMPLE, ["permissions", "allow", "x"])).toBeNull();
  });

  it("空 path → 根节点本身", () => {
    expect(resolveFieldAtPath(SAMPLE, [])?.type).toBe("object");
  });
});

describe("REVIEW_3 R_1·C6 — 循环引用守门", () => {
  it("自引用 schema 不再 stack overflow（visited Set 守门）", () => {
    // 修复前：visit 无 visited 跟踪，self-ref schema 触发 RangeError "Maximum call stack size exceeded"
    // 修复后：节点身份去重，已访问的跳过递归
    const node: FieldSchema = { type: "object", properties: {} };
    (node.properties as Record<string, FieldSchema>)["self"] = node;
    expect(() => buildFieldIndex(node)).not.toThrow();
    const idx = buildFieldIndex(node);
    expect(idx.has("self")).toBe(true);
  });

  it("互引用 schema（A→B→A）不死循环", () => {
    const a: FieldSchema = { type: "object", properties: {} };
    const b: FieldSchema = { type: "object", properties: {} };
    (a.properties as Record<string, FieldSchema>)["b"] = b;
    (b.properties as Record<string, FieldSchema>)["a"] = a;
    expect(() => buildFieldIndex(a)).not.toThrow();
    const idx = buildFieldIndex(a);
    expect(idx.has("b")).toBe(true);
    expect(idx.has("b.a")).toBe(true);
  });

  it("数组 itemSchema 自引用（链表式）不栈溢出", () => {
    const node: FieldSchema = { type: "array" };
    node.itemSchema = node;
    expect(() => buildFieldIndex(node)).not.toThrow();
  });
});

describe("REVIEW_3 R_1 — properties vs additionalProperties 同名优先级", () => {
  it("properties 已声明的 key 不被 additionalProperties: schema 覆盖", () => {
    // codex finding：当 object 同时声明 properties.foo + additionalProperties: schema 时，
    // foo 应走 properties.foo 的 schema（不是 additionalProperties）；其他未知 key 走 additionalProperties
    const root: FieldSchema = {
      type: "object",
      properties: { foo: { type: "number" } },
      additionalProperties: { type: "string" },
    };
    expect(resolveFieldAtPath(root, ["foo"])?.type).toBe("number");
    expect(resolveFieldAtPath(root, ["bar"])?.type).toBe("string");
    const idx = buildFieldIndex(root);
    expect(idx.get("foo")?.type).toBe("number");
    expect(idx.get("*")?.type).toBe("string");
  });
});

describe("REVIEW_3 R_1·C14 — normalizeEnum 升格 helper", () => {
  it("string[] 短形式包成 EnumOption[]", () => {
    expect(normalizeEnum(["low", "high"])).toEqual([{ value: "low" }, { value: "high" }]);
  });

  it("number[] 短形式包成 EnumOption[]", () => {
    expect(normalizeEnum([1, 2])).toEqual([{ value: 1 }, { value: 2 }]);
  });

  it("EnumOption[] 长形式透传", () => {
    const opts = [
      { value: "low", label: "Low", description: "省 token" },
      { value: "high", deprecated: true as const },
    ];
    expect(normalizeEnum(opts)).toEqual(opts);
  });

  it("混合短长形式自动升格", () => {
    expect(
      normalizeEnum(["low", { value: "high", description: "..." }]),
    ).toEqual([{ value: "low" }, { value: "high", description: "..." }]);
  });
});

describe("REVIEW_3 R_1·C15 — pathToString 序列化 helper", () => {
  it("空 path → 空字符串", () => {
    expect(pathToString([])).toBe("");
  });

  it("单段 string", () => {
    expect(pathToString(["model"])).toBe("model");
  });

  it("数字下标段直接展示数字（与 buildFieldIndex 模板段 [] 不同）", () => {
    expect(pathToString(["hooks", "PreToolUse", 0, "matcher"])).toBe(
      "hooks.PreToolUse.0.matcher",
    );
  });
});
