import { describe, expect, it } from "bun:test";
import {
  redactJsonContent, redactTomlContent, redactWholeFile,
  redactProfileEnv, redactByFilename, makePlaceholder, placeholderCount,
} from "./redact.ts";

describe("redactJsonContent", () => {
  it("顶层敏感 key value 替换为占位符", () => {
    const r = redactJsonContent(JSON.stringify({ api_key: "sk-secret", model: "opus" }));
    const obj = JSON.parse(r.content);
    expect(obj.api_key).toBe(makePlaceholder("api_key"));
    expect(obj.model).toBe("opus");
    expect(r.placeholders).toHaveLength(1);
    expect(r.placeholders[0]?.fieldName).toBe("api_key");
    expect(r.placeholders[0]?.fieldPath).toBe("$.api_key");
  });

  it("嵌套敏感 key 也命中（mcp 风格）", () => {
    const input = {
      mcpServers: {
        intern: {
          env: { INTERN_TOKEN: "ghp_xxx", READ_ONLY: "1" },
        },
      },
    };
    const r = redactJsonContent(JSON.stringify(input));
    const obj = JSON.parse(r.content);
    expect(obj.mcpServers.intern.env.INTERN_TOKEN).toBe(makePlaceholder("INTERN_TOKEN"));
    expect(obj.mcpServers.intern.env.READ_ONLY).toBe("1");
    expect(r.placeholders).toHaveLength(1);
    expect(r.placeholders[0]?.fieldPath).toBe("$.mcpServers.intern.env.INTERN_TOKEN");
  });

  it("数组里的敏感 key 命中（带 index）", () => {
    const input = { items: [{ token: "a" }, { token: "b" }] };
    const r = redactJsonContent(JSON.stringify(input));
    expect(r.placeholders).toHaveLength(2);
    expect(r.placeholders[0]?.fieldPath).toBe("$.items[0].token");
    expect(r.placeholders[1]?.fieldPath).toBe("$.items[1].token");
  });

  it("非 string value 不动（数字 / 布尔 / null / 对象）", () => {
    const input = { token_count: 42, has_token: true, token: null, nested_token: { a: 1 } };
    const r = redactJsonContent(JSON.stringify(input));
    const obj = JSON.parse(r.content);
    expect(obj.token_count).toBe(42);
    expect(obj.has_token).toBe(true);
    expect(obj.token).toBeNull();
    expect(obj.nested_token).toEqual({ a: 1 });
    expect(r.placeholders).toHaveLength(0);
  });

  it("非敏感 key 不动（HTTP_PROXY 等）", () => {
    const input = { HTTP_PROXY: "http://proxy", model: "opus" };
    const r = redactJsonContent(JSON.stringify(input));
    expect(r.placeholders).toHaveLength(0);
    const obj = JSON.parse(r.content);
    expect(obj.HTTP_PROXY).toBe("http://proxy");
  });

  it("parse 失败 → 原样返回 + 空 placeholders", () => {
    const broken = "{ invalid json ";
    const r = redactJsonContent(broken);
    expect(r.content).toBe(broken);
    expect(r.placeholders).toHaveLength(0);
  });
});

describe("redactTomlContent", () => {
  it("顶层敏感 key 替换", () => {
    const r = redactTomlContent('experimental_bearer_token = "sk-xxx"\nmodel = "gpt-5.5"\n');
    expect(r.content).toContain(makePlaceholder("experimental_bearer_token"));
    expect(r.content).toContain('model = "gpt-5.5"');
    expect(r.placeholders).toHaveLength(1);
    expect(r.placeholders[0]?.fieldName).toBe("experimental_bearer_token");
  });

  it("section 内的敏感 key 替换", () => {
    const r = redactTomlContent(`
[server.intern]
api_key = "secret"
url = "https://x.com"
`);
    expect(r.content).toContain(makePlaceholder("api_key"));
    expect(r.placeholders[0]?.fieldPath).toBe("server.intern.api_key");
  });
});

describe("redactWholeFile", () => {
  it("整文件替换为 placeholder JSON", () => {
    const r = redactWholeFile('{"OPENAI_API_KEY":"sk-real-token-here"}', "auth.json");
    const obj = JSON.parse(r.content);
    expect(obj.placeholder).toBe(makePlaceholder("AUTH"));
    expect(r.placeholders[0]?.fieldName).toBe("AUTH");
  });
});

describe("redactProfileEnv", () => {
  it("敏感 key value 替换 + 非敏感保留", () => {
    const r = redactProfileEnv({
      ANTHROPIC_API_KEY: "sk-ant-secret",
      HTTP_PROXY: "http://proxy",
    });
    expect(r.env.ANTHROPIC_API_KEY).toBe(makePlaceholder("ANTHROPIC_API_KEY"));
    expect(r.env.HTTP_PROXY).toBe("http://proxy");
    expect(r.placeholders).toHaveLength(1);
    expect(r.placeholders[0]?.fieldPath).toBe("env.ANTHROPIC_API_KEY");
  });

  it("undefined env 返回空", () => {
    const r = redactProfileEnv(undefined);
    expect(r.env).toEqual({});
    expect(r.placeholders).toHaveLength(0);
  });
});

describe("redactByFilename", () => {
  it(".json → JSON 脱敏", () => {
    const r = redactByFilename('{"api_key":"x"}', "settings.json");
    expect(r.placeholders).toHaveLength(1);
  });

  it(".toml → TOML 脱敏", () => {
    const r = redactByFilename('token = "x"', "config.toml");
    expect(r.placeholders).toHaveLength(1);
  });

  it("auth.json → 整文件脱敏（命中 SENSITIVE_FILES）", () => {
    const r = redactByFilename('{"foo":"bar"}', "auth.json");
    expect(r.placeholders[0]?.fieldName).toBe("AUTH");
  });

  it("credentials.json → 整文件脱敏", () => {
    const r = redactByFilename('{"foo":"bar"}', "credentials.json");
    expect(r.placeholders[0]?.fieldName).toBe("CREDENTIALS");
  });

  it("非 JSON / TOML → 不处理", () => {
    const r = redactByFilename("# CLAUDE.md\n\napi_key: secret", "CLAUDE.md");
    expect(r.placeholders).toHaveLength(0);
    expect(r.content).toContain("api_key: secret");
  });
});

describe("placeholderCount", () => {
  it("数 <<DCH_PLACEHOLDER:...>> 出现次数", () => {
    expect(placeholderCount("foo <<DCH_PLACEHOLDER:A>> bar <<DCH_PLACEHOLDER:B>>")).toBe(2);
    expect(placeholderCount("no placeholders here")).toBe(0);
  });
});
