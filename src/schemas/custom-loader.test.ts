import { describe, it, expect } from "bun:test";
import { mergeSchemas } from "./custom-loader.ts";
import type { ToolSchema } from "./types.ts";

/**
 * mergeSchemas 单测（PR-CSv1）。
 *
 * loadCustomSchemas 本身依赖 Tauri IPC（readDir / read_file），单测里不能跑；
 * 留给端到端冒烟（README 的「自定义 schema」示例）。
 */

const BUILTIN: ToolSchema = {
  $id: "claude-settings@1",
  $source: "https://example.com/upstream",
  fetchedAt: "2026-01-01",
  scopeKind: "claude-settings",
  rootSchema: {
    type: "object",
    description: "内置描述",
    additionalProperties: true,
    properties: {
      a: { type: "string", description: "字段 A 内置" },
      b: { type: "number", description: "字段 B 内置" },
      c: { type: "boolean", description: "字段 C 内置" },
    },
    propertyOrder: ["a", "b", "c"],
  },
};

describe("mergeSchemas", () => {
  it("override 覆盖内置同 key 字段（字段级整体替换）", () => {
    const result = mergeSchemas(BUILTIN, {
      rootSchema: {
        type: "object",
        properties: {
          a: { type: "string", description: "（override）字段 A" },
        },
      },
    });
    const props = result.rootSchema.properties as Record<string, { description: string }>;
    expect(props.a.description).toBe("（override）字段 A");
    // 未在 override 的字段保留
    expect(props.b.description).toBe("字段 B 内置");
    expect(props.c.description).toBe("字段 C 内置");
  });

  it("override 加新字段", () => {
    const result = mergeSchemas(BUILTIN, {
      rootSchema: {
        type: "object",
        properties: {
          newKey: { type: "string", description: "新字段" },
        },
      },
    });
    const props = result.rootSchema.properties as Record<string, { description: string }>;
    expect(props.newKey?.description).toBe("新字段");
    // 内置字段都还在
    expect(Object.keys(props).sort()).toEqual(["a", "b", "c", "newKey"]);
  });

  it("propertyOrder：override 在前，剩余 builtin 追加", () => {
    const result = mergeSchemas(BUILTIN, {
      rootSchema: {
        type: "object",
        propertyOrder: ["c", "newKey"],
        properties: {
          newKey: { type: "string" },
        },
      },
    });
    expect(result.rootSchema.propertyOrder).toEqual(["c", "newKey", "a", "b"]);
  });

  it("propertyOrder：未声明则按 properties keys 顺序", () => {
    const result = mergeSchemas(BUILTIN, {
      rootSchema: {
        type: "object",
        properties: {
          newKey: { type: "string" },
        },
      },
    });
    // 内置 propertyOrder=[a, b, c]，新 newKey 追加
    expect(result.rootSchema.propertyOrder).toEqual(["a", "b", "c", "newKey"]);
  });

  it("$id / scopeKind 不被 override（即使 partial 里有也忽略）", () => {
    const result = mergeSchemas(BUILTIN, {
      $id: "fake@99",
      scopeKind: "codex-config",
      rootSchema: { type: "object" },
    } as Partial<ToolSchema>);
    expect(result.$id).toBe("claude-settings@1");
    expect(result.scopeKind).toBe("claude-settings");
  });

  it("$source / fetchedAt：override 优先", () => {
    const result = mergeSchemas(BUILTIN, {
      $source: "本地 override",
      fetchedAt: "2026-05-07",
      rootSchema: { type: "object" },
    });
    expect(result.$source).toBe("本地 override");
    expect(result.fetchedAt).toBe("2026-05-07");
  });

  it("additionalProperties 强制 true（数据完整性铁律）", () => {
    const result = mergeSchemas(BUILTIN, {
      rootSchema: {
        type: "object",
        additionalProperties: false,  // 用户写 false 也要被强制改回 true
      },
    });
    expect(result.rootSchema.additionalProperties).toBe(true);
  });

  it("不修改 builtin 入参对象（产生新对象，避免 ajv WeakMap stale cache）", () => {
    const before = JSON.stringify(BUILTIN);
    mergeSchemas(BUILTIN, {
      rootSchema: {
        type: "object",
        properties: { a: { type: "number" } },
      },
    });
    const after = JSON.stringify(BUILTIN);
    expect(after).toBe(before);
  });

  it("不递归深合并：嵌套 properties 也是整体替换", () => {
    const builtinNested: ToolSchema = {
      ...BUILTIN,
      rootSchema: {
        type: "object",
        additionalProperties: true,
        properties: {
          nested: {
            type: "object",
            properties: {
              inner1: { type: "string", description: "内层 1 内置" },
              inner2: { type: "string", description: "内层 2 内置" },
            },
          },
        },
      },
    };
    const result = mergeSchemas(builtinNested, {
      rootSchema: {
        type: "object",
        properties: {
          nested: {
            type: "object",
            properties: {
              inner1: { type: "string", description: "（override）只改 inner1" },
            },
          },
        },
      },
    });
    const nested = (result.rootSchema.properties as Record<string, { properties: Record<string, { description: string }> }>).nested;
    // 整体替换：inner2 丢失（这是 plan 已确认的行为，避免 merge 复杂度爆炸）
    expect(nested.properties.inner1.description).toBe("（override）只改 inner1");
    expect(nested.properties.inner2).toBeUndefined();
  });
});
