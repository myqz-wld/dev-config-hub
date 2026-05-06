import { describe, expect, it } from "bun:test";
import { patchToml } from "./toml-patcher.ts";
import { parse as parseToml } from "smol-toml";

describe("patchToml", () => {
  it("top-level scalar 改值：注释 + 兄弟字段保留", () => {
    const src = `# 模型配置
model = "claude-opus-4-7"  # 默认 opus
model_reasoning_effort = "high"
`;
    const r = patchToml(src, [{ path: ["model"], value: "claude-sonnet-4-6" }]);
    expect(r.fallback).toBe(false);
    expect(r.patched).toContain('model = "claude-sonnet-4-6"');
    expect(r.patched).toContain("# 模型配置");
    expect(r.patched).toContain('model_reasoning_effort = "high"');
  });

  it("[section] 内 scalar 改值", () => {
    const src = `[network]
timeout = 30
retries = 3

[other]
flag = true
`;
    const r = patchToml(src, [{ path: ["network", "timeout"], value: 60 }]);
    expect(r.fallback).toBe(false);
    expect(r.patched).toContain("timeout = 60");
    expect(r.patched).toContain("retries = 3");
    expect(r.patched).toContain("flag = true");
  });

  it("删 scalar key：行删除（保位置）", () => {
    const src = `model = "opus"
fast = true
extra = 1
`;
    const r = patchToml(src, [{ path: ["fast"], value: undefined }]);
    expect(r.fallback).toBe(false);
    expect(r.patched).not.toContain("fast =");
    expect(r.patched).toContain('model = "opus"');
    expect(r.patched).toContain("extra = 1");
  });

  it("inline-table 触发 fallback", () => {
    // mcp_servers = { foo = { cmd = "bar" } } 这种 inline-table
    const src = `model = "opus"
mcp_servers = { foo = "bar" }
`;
    const r = patchToml(src, [{ path: ["mcp_servers"], value: { foo: "baz" } }]);
    expect(r.fallback).toBe(true);
    expect(r.reason).toMatch(/inline-table|complex|序列化/);
  });

  it("array of tables 触发 fallback", () => {
    const src = `[[providers]]
name = "openai"
url = "https://api.openai.com"

[[providers]]
name = "anthropic"
`;
    const r = patchToml(src, [{ path: ["providers"], value: [] }]);
    expect(r.fallback).toBe(true);
  });

  it("注释保留（top-level scalar 改值）", () => {
    const src = `# 顶部注释
# 多行说明

model = "opus"  # 行尾注释

# 段落间注释
fast = true
`;
    const r = patchToml(src, [{ path: ["model"], value: "sonnet" }]);
    expect(r.fallback).toBe(false);
    expect(r.patched).toContain("# 顶部注释");
    expect(r.patched).toContain("# 多行说明");
    expect(r.patched).toContain("# 段落间注释");
  });

  it("多行字符串触发 fallback", () => {
    const src = `description = """
这是一段多行字符串
across multiple lines
"""
model = "opus"
`;
    const r = patchToml(src, [{ path: ["description"], value: "single" }]);
    expect(r.fallback).toBe(true);
  });

  it("schema 不认识的字段不丢（bridge fallback 也保留）", () => {
    // top-level scalar fast path：未列在 patches 中的 key 完全不动
    const src = `model = "opus"
my_custom_field = "secret"
another_unknown = 42
fast = false
`;
    const r = patchToml(src, [{ path: ["model"], value: "sonnet" }]);
    expect(r.fallback).toBe(false);
    expect(r.patched).toContain('my_custom_field = "secret"');
    expect(r.patched).toContain("another_unknown = 42");
    expect(r.patched).toContain("fast = false");
  });

  it("fallback 路径下未知字段也保留（重新序列化整 obj）", () => {
    // inline-table 触发 fallback；未在 patches 的 my_custom 必须保留
    const src = `model = "opus"
my_custom = "secret"
mcp_servers = { foo = "bar" }
`;
    const r = patchToml(src, [{ path: ["mcp_servers"], value: { foo: "baz" } }]);
    expect(r.fallback).toBe(true);
    // round-trip 后未知 key 保留
    const reparsed = parseToml(r.patched) as Record<string, unknown>;
    expect(reparsed["my_custom"]).toBe("secret");
    expect(reparsed["model"]).toBe("opus");
    expect(reparsed["mcp_servers"]).toEqual({ foo: "baz" });
  });

  it("空 patches → 原样返", () => {
    const src = `model = "opus"\n`;
    const r = patchToml(src, []);
    expect(r.fallback).toBe(false);
    expect(r.patched).toBe(src);
  });

  it("数组 scalar 改值（fast path）", () => {
    const src = `models = ["opus", "sonnet"]
flag = true
`;
    const r = patchToml(src, [{ path: ["models"], value: ["opus", "sonnet", "haiku"] }]);
    expect(r.fallback).toBe(false);
    expect(r.patched).toContain('"haiku"');
    expect(r.patched).toContain("flag = true");
  });
});
